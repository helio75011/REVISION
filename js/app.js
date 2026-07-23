/* =========================================================================
   Révision CDA — moteur de jeu
   Principe Duolingo : parcours de leçons débloquées une à une, feedback
   immédiat, XP, série quotidienne, couronnes, renforcement des erreurs.
   PAS de système de vies : une mauvaise réponse ne fait jamais perdre la
   partie, la question revient simplement plus tard dans la leçon.
   ========================================================================= */

/* ----------------------------- Persistance ----------------------------- */

const STORE_KEY = 'cda-revision-quiz-v1';
const MAX_CROWNS = 5;

const DEFAULT_STATE = {
  xp: 0,
  streak: 0,
  lastDay: null,
  days: [],
  crowns: {}, // lessonId -> nombre de couronnes
  plays: {}, // lessonId -> { plays, best }
  missed: {}, // "lessonId#index" -> nombre d'erreurs
  answers: { ok: 0, total: 0 },
  sound: true,
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return Object.assign(structuredClone(DEFAULT_STATE), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(S));
  } catch {
    /* stockage indisponible : le jeu reste jouable, sans mémoire */
  }
}

let S = load();

/* ------------------------------- Utilitaires ------------------------------- */

const $ = (sel) => document.querySelector(sel);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9\-_. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function qkey(lessonId, index) {
  return `${lessonId}#${index}`;
}

/* --------------------------------- Son --------------------------------- */

let audioCtx = null;

function beep(kind) {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes =
      kind === 'ok' ? [660, 880] : kind === 'ko' ? [200, 150] : kind === 'win' ? [523, 659, 784] : [440];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = kind === 'ko' ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch {
    /* audio indisponible : sans conséquence */
  }
}

/* ------------------------------ Progression ------------------------------ */

function crownsOf(lessonId) {
  return S.crowns[lessonId] || 0;
}

function isUnlocked(index) {
  if (index === 0) return true;
  return crownsOf(FLAT_LESSONS[index - 1].id) > 0;
}

function firstLockedIndex() {
  for (let i = 0; i < FLAT_LESSONS.length; i++) {
    if (crownsOf(FLAT_LESSONS[i].id) === 0) return i;
  }
  return FLAT_LESSONS.length - 1;
}

function totalCrowns() {
  return FLAT_LESSONS.reduce((n, l) => n + crownsOf(l.id), 0);
}

function missedList() {
  return Object.entries(S.missed)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

function refreshTopbar() {
  $('#stat-streak').textContent = S.streak;
  $('#stat-xp').textContent = S.xp;
  $('#stat-crowns').textContent = totalCrowns();
  $('#btn-sound').textContent = S.sound ? '🔊' : '🔇';
  $('#btn-sound').classList.toggle('is-off', !S.sound);
}

function bumpStreak() {
  const t = today();
  if (S.lastDay === t) return;
  S.streak = S.lastDay === yesterday() ? S.streak + 1 : 1;
  S.lastDay = t;
  if (!S.days.includes(t)) S.days.push(t);
}

/* ================================ VUES ================================ */

let currentView = 'path';

function render(view) {
  currentView = view || currentView;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === currentView));
  const app = $('#app');
  app.scrollTop = 0;
  if (currentView === 'path') app.innerHTML = viewPath();
  else if (currentView === 'review') app.innerHTML = viewReview();
  else app.innerHTML = viewStats();
  wireView();
  refreshTopbar();
}

/* ------------------------------- Parcours ------------------------------- */

function viewPath() {
  const nextIdx = firstLockedIndex();
  let html = `
    <h1 class="screen-title">${esc(COURSE.title)}</h1>
    <p class="screen-sub">${esc(COURSE.subtitle)} · ${TOTAL_QUESTIONS} questions · sans système de vies</p>`;

  let idx = 0;
  COURSE.units.forEach((unit) => {
    const done = unit.lessons.filter((l) => crownsOf(l.id) > 0).length;
    html += `
      <section class="unit">
        <div class="unit-head" style="background:${unit.color}">
          <span class="unit-emoji">${unit.icon}</span>
          <div>
            <h2>${esc(unit.title)}</h2>
            <p>${esc(unit.subtitle)}</p>
          </div>
          <span class="unit-done">${done}/${unit.lessons.length}</span>
        </div>
        <div class="path">`;

    unit.lessons.forEach((lesson) => {
      const i = idx++;
      const unlocked = isUnlocked(i);
      const c = crownsOf(lesson.id);
      const dark = shade(unit.color, -0.28);
      html += `
        <div class="node-wrap">
          <button class="node ${unlocked ? '' : 'is-locked'} ${i === nextIdx && unlocked ? 'is-current' : ''}"
                  style="--node-color:${unit.color};--node-shadow:${dark}"
                  data-lesson="${lesson.id}" ${unlocked ? '' : 'disabled'}
                  aria-label="${esc(lesson.title)}">
            ${unlocked ? lesson.icon : '🔒'}
          </button>
          <div class="node-label">${esc(lesson.title)}</div>
          <div class="node-crowns">${c ? '👑'.repeat(Math.min(c, MAX_CROWNS)) : '&nbsp;'}</div>
        </div>`;
    });

    html += `</div></section>`;
  });

  return html;
}

/* Assombrit une couleur hexadécimale pour l’ombre portée des pastilles. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* ------------------------------ Renforcement ------------------------------ */

function viewReview() {
  const missed = missedList();
  let html = `
    <h1 class="screen-title">Renforcer</h1>
    <p class="screen-sub">Les questions que tu as ratées reviennent ici jusqu’à ce qu’elles soient acquises.</p>`;

  if (!missed.length) {
    html += `
      <div class="empty">
        <div class="big">🌤️</div>
        <p><b>Rien à revoir pour l’instant.</b><br />Termine des leçons : les questions ratées atterriront ici.</p>
      </div>`;
    return html;
  }

  const byUnit = {};
  missed.forEach((k) => {
    const lid = k.split('#')[0];
    const l = LESSON_BY_ID[lid];
    if (!l) return;
    byUnit[l.unitTitle] = (byUnit[l.unitTitle] || 0) + 1;
  });

  html += `
    <div class="card">
      <h3>${missed.length} question${missed.length > 1 ? 's' : ''} à revoir</h3>
      <p>Une session de renforcement pioche jusqu’à 15 questions, en commençant par celles que tu rates le plus.</p>
      <div style="height:14px"></div>
      <button class="btn btn-primary" id="btn-review">Lancer le renforcement</button>
    </div>
    <div class="card">
      <h3>Répartition</h3>`;

  Object.entries(byUnit)
    .sort((a, b) => b[1] - a[1])
    .forEach(([unit, n]) => {
      const color = (COURSE.units.find((u) => u.title === unit) || {}).color || '#888';
      html += `<div class="list-row"><span class="dot" style="background:${color}"></span>${esc(unit)}<b>${n}</b></div>`;
    });

  html += `</div>`;
  return html;
}

/* --------------------------------- Stats --------------------------------- */

function viewStats() {
  const done = FLAT_LESSONS.filter((l) => crownsOf(l.id) > 0).length;
  const pct = Math.round((done / FLAT_LESSONS.length) * 100);
  const acc = S.answers.total ? Math.round((S.answers.ok / S.answers.total) * 100) : 0;
  const maxCrowns = FLAT_LESSONS.length * MAX_CROWNS;

  let html = `
    <h1 class="screen-title">Statistiques</h1>
    <p class="screen-sub">Ta progression sur les deux fiches de révision.</p>

    <div class="kpis">
      <div class="kpi"><b>${S.xp}</b><span>XP</span></div>
      <div class="kpi"><b>${S.streak}</b><span>Jours de série</span></div>
      <div class="kpi"><b>${totalCrowns()}/${maxCrowns}</b><span>Couronnes</span></div>
      <div class="kpi"><b>${acc}%</b><span>Réponses justes</span></div>
    </div>

    <div class="card">
      <h3>Leçons terminées — ${done}/${FLAT_LESSONS.length}</h3>
      <div class="progress-line"><i style="width:${pct}%"></i></div>
      <p>${pct}% du parcours débloqué.</p>
    </div>

    <div class="card">
      <h3>Par unité</h3>`;

  COURSE.units.forEach((u) => {
    const d = u.lessons.filter((l) => crownsOf(l.id) > 0).length;
    html += `<div class="list-row"><span class="dot" style="background:${u.color}"></span>${esc(u.title)}<b>${d}/${u.lessons.length}</b></div>`;
  });

  html += `
    </div>

    <div class="card">
      <h3>Questions répondues</h3>
      <div class="list-row">Total<b>${S.answers.total}</b></div>
      <div class="list-row">Justes<b>${S.answers.ok}</b></div>
      <div class="list-row">À revoir<b>${missedList().length}</b></div>
    </div>

    <div class="card">
      <h3>Sources</h3>
      <p>Toutes les questions proviennent des fiches <i>« MCD · MLD · MPD — Petit Rayon de Soleil »</i> et
      <i>« Merise, UML et CI/CD — révision orale »</i> du dossier <code>docs/</code>.</p>
    </div>

    <button class="btn btn-ghost" id="btn-reset">Réinitialiser ma progression</button>
    <p class="hint">Efface XP, série, couronnes et historique d’erreurs sur cet appareil.</p>`;

  return html;
}

function wireView() {
  document.querySelectorAll('[data-lesson]').forEach((b) => {
    b.addEventListener('click', () => startLesson(b.dataset.lesson));
  });
  const rev = $('#btn-review');
  if (rev) rev.addEventListener('click', startReview);
  const reset = $('#btn-reset');
  if (reset) {
    reset.addEventListener('click', () => {
      if (!confirm('Effacer toute ta progression ?')) return;
      S = structuredClone(DEFAULT_STATE);
      save();
      render('path');
    });
  }
}

/* ============================== SESSION DE JEU ============================== */

let session = null;
let ctrl = null; // contrôleur de la question affichée
let phase = 'answer'; // 'answer' | 'feedback' | 'done'

function buildItems(lesson) {
  return lesson.questions.map((q, i) => ({ q, key: qkey(lesson.id, i), lessonId: lesson.id }));
}

function startLesson(lessonId) {
  const lesson = LESSON_BY_ID[lessonId];
  if (!lesson) return;
  const items = shuffle(buildItems(lesson));
  openSession({
    title: lesson.title,
    lessonId: lesson.id,
    isReview: false,
    items,
  });
}

function startReview() {
  const keys = missedList().slice(0, 15);
  const items = [];
  keys.forEach((k) => {
    const [lid, i] = k.split('#');
    const lesson = LESSON_BY_ID[lid];
    const q = lesson && lesson.questions[Number(i)];
    if (q) items.push({ q, key: k, lessonId: lid });
  });
  if (!items.length) return;
  openSession({ title: 'Renforcement', lessonId: null, isReview: true, items: shuffle(items) });
}

function openSession(cfg) {
  session = {
    ...cfg,
    total: cfg.items.length,
    queue: cfg.items.slice(),
    cleared: 0,
    combo: 0,
    bestCombo: 0,
    firstTryOk: 0,
    errors: 0,
    startedAt: Date.now(),
    seen: new Set(),
  };
  $('#lesson').hidden = false;
  $('#topbar').style.display = 'none';
  $('#tabbar').style.display = 'none';
  document.body.style.overflow = 'hidden';
  nextQuestion();
}

function closeSession() {
  session = null;
  ctrl = null;
  $('#lesson').hidden = true;
  $('#topbar').style.display = '';
  $('#tabbar').style.display = '';
  document.body.style.overflow = '';
  render();
}

function updateProgress() {
  const pct = session.total ? (session.cleared / session.total) * 100 : 0;
  $('#lesson-progress').style.width = `${pct}%`;
  $('#lesson-combo').textContent = session.combo >= 2 ? `🔥${session.combo}` : '';
}

function nextQuestion() {
  updateProgress();
  if (!session.queue.length) return finishSession();

  phase = 'answer';
  const item = session.queue[0];
  const fb = $('#feedback');
  fb.className = 'feedback';
  fb.innerHTML = '';
  const btn = $('#btn-check');
  btn.className = 'btn btn-primary';
  btn.textContent = 'Vérifier';
  btn.disabled = true;

  const body = $('#lesson-body');
  body.innerHTML = '';
  body.scrollTop = 0;

  ctrl = mountQuestion(body, item.q);
}

const KIND_LABEL = {
  qcm: 'Une seule bonne réponse',
  multi: 'Plusieurs bonnes réponses',
  vf: 'Vrai ou faux',
  ordre: 'Remets dans l’ordre',
  paires: 'Associe les paires',
  saisie: 'Écris la réponse',
};

function mountQuestion(root, q) {
  const head = document.createElement('div');
  head.innerHTML = `
    <div class="q-kind">${KIND_LABEL[q.t] || ''}</div>
    <h2 class="q-text">${esc(q.q)}</h2>
    ${q.code ? `<pre class="q-code mono">${esc(q.code)}</pre>` : ''}`;
  root.appendChild(head);

  const zone = document.createElement('div');
  root.appendChild(zone);

  switch (q.t) {
    case 'qcm':
      return mountChoice(zone, q, false);
    case 'multi':
      return mountChoice(zone, q, true);
    case 'vf':
      return mountVF(zone, q);
    case 'ordre':
      return mountOrder(zone, q);
    case 'paires':
      return mountPairs(zone, q);
    case 'saisie':
      return mountInput(zone, q);
    default:
      return { validate: () => true, solution: '' };
  }
}

function setReady(ok) {
  $('#btn-check').disabled = !ok;
}

/* ------------------------- QCM et choix multiples ------------------------- */

function mountChoice(zone, q, multiple) {
  const opts = shuffle(q.a.map((text, i) => ({ text, ok: multiple ? q.c.includes(i) : q.c === i })));
  const selected = new Set();

  zone.className = 'opts';
  opts.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.type = 'button';
    b.innerHTML = `<span class="key">${i + 1}</span><span>${esc(o.text)}</span>`;
    b.addEventListener('click', () => {
      if (phase !== 'answer') return;
      if (multiple) {
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
      } else {
        selected.clear();
        selected.add(i);
      }
      zone.querySelectorAll('.opt').forEach((el, j) => el.classList.toggle('is-sel', selected.has(j)));
      setReady(selected.size > 0);
    });
    zone.appendChild(b);
  });

  return {
    pick(n) {
      const el = zone.querySelectorAll('.opt')[n];
      if (el) el.click();
    },
    validate() {
      let ok = true;
      opts.forEach((o, i) => {
        const el = zone.querySelectorAll('.opt')[i];
        el.disabled = true;
        if (o.ok) el.classList.add('is-ok');
        if (selected.has(i) && !o.ok) el.classList.add('is-ko');
        if (o.ok !== selected.has(i)) ok = false;
      });
      return ok;
    },
    solution: opts
      .filter((o) => o.ok)
      .map((o) => o.text)
      .join(' · '),
  };
}

/* ------------------------------ Vrai / Faux ------------------------------ */

function mountVF(zone, q) {
  let choice = null;
  zone.className = 'vf';
  [
    ['Vrai', true],
    ['Faux', false],
  ].forEach(([label, val]) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (phase !== 'answer') return;
      choice = val;
      zone.querySelectorAll('.opt').forEach((el) => el.classList.remove('is-sel'));
      b.classList.add('is-sel');
      setReady(true);
    });
    zone.appendChild(b);
  });

  return {
    pick(n) {
      const el = zone.querySelectorAll('.opt')[n];
      if (el) el.click();
    },
    validate() {
      const els = zone.querySelectorAll('.opt');
      els.forEach((el, i) => {
        el.disabled = true;
        const val = i === 0;
        if (val === q.c) el.classList.add('is-ok');
        if (val === choice && choice !== q.c) el.classList.add('is-ko');
      });
      return choice === q.c;
    },
    solution: q.c ? 'Vrai' : 'Faux',
  };
}

/* ---------------------------- Remise en ordre ---------------------------- */

function mountOrder(zone, q) {
  const order = [];
  zone.innerHTML = '<div class="order-slots"></div><div class="order-pool"></div>';
  const slots = zone.querySelector('.order-slots');
  const pool = zone.querySelector('.order-pool');
  const shuffled = shuffle(q.items.map((text, i) => ({ text, i })));

  function redraw() {
    slots.innerHTML = '';
    order.forEach((item, pos) => {
      const c = document.createElement('button');
      c.className = 'chip num';
      c.type = 'button';
      c.innerHTML = `<i>${pos + 1}</i><span>${esc(item.text)}</span>`;
      c.addEventListener('click', () => {
        if (phase !== 'answer') return;
        order.splice(pos, 1);
        redraw();
      });
      slots.appendChild(c);
    });
    pool.querySelectorAll('.chip').forEach((el, i) => {
      el.classList.toggle('is-used', order.some((o) => o.i === shuffled[i].i));
    });
    setReady(order.length === q.items.length);
  }

  shuffled.forEach((item) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.type = 'button';
    c.textContent = item.text;
    c.addEventListener('click', () => {
      if (phase !== 'answer') return;
      order.push(item);
      redraw();
    });
    pool.appendChild(c);
  });
  redraw();

  return {
    validate() {
      let ok = true;
      slots.querySelectorAll('.chip').forEach((el, pos) => {
        const good = order[pos].i === pos;
        el.classList.add(good ? 'is-ok' : 'is-ko');
        if (!good) ok = false;
      });
      pool.querySelectorAll('.chip').forEach((el) => (el.style.pointerEvents = 'none'));
      return ok;
    },
    solution: q.items.map((t, i) => `${i + 1}. ${t}`).join('  →  '),
  };
}

/* ------------------------------- Paires ------------------------------- */

function mountPairs(zone, q) {
  const ownItem = session ? session.queue[0] : null; // garde-fou pour la validation différée
  const left = shuffle(q.pairs.map(([a], i) => ({ text: a, i })));
  const right = shuffle(q.pairs.map(([, b], i) => ({ text: b, i })));
  let selL = null;
  let mistakes = 0;
  let matched = 0;

  zone.className = 'pairs';
  const colL = document.createElement('div');
  const colR = document.createElement('div');
  colL.style.display = colR.style.display = 'flex';
  colL.style.flexDirection = colR.style.flexDirection = 'column';
  colL.style.gap = colR.style.gap = '10px';
  zone.append(colL, colR);

  function flashKo(el) {
    el.classList.add('flash-ko');
    setTimeout(() => el.classList.remove('flash-ko'), 340);
  }

  left.forEach((item) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = item.text;
    b.addEventListener('click', () => {
      if (phase !== 'answer') return;
      colL.querySelectorAll('.chip').forEach((el) => {
        el.classList.remove('is-sel');
        el.style.borderColor = '';
      });
      b.classList.add('is-sel');
      b.style.borderColor = 'var(--accent)';
      selL = { item, el: b };
    });
    colL.appendChild(b);
  });

  right.forEach((item) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = item.text;
    b.addEventListener('click', () => {
      if (phase !== 'answer' || !selL) return;
      // Plusieurs paires peuvent partager le même libellé à droite
      // (CASCADE, « Automatisé »…) : on compare les textes, pas les index.
      if (q.pairs[selL.item.i][1] === q.pairs[item.i][1]) {
        selL.el.style.borderColor = '';
        selL.el.classList.remove('is-sel');
        selL.el.classList.add('is-done');
        b.classList.add('is-done');
        matched++;
        beep('ok');
        selL = null;
        if (matched === q.pairs.length) {
          setReady(true);
          setTimeout(() => {
            // Ne valider que si l’on est toujours sur cette même question :
            // l’utilisateur a pu appuyer sur « Vérifier » entre-temps.
            if (phase === 'answer' && session && session.queue[0] === ownItem) onCheck();
          }, 260);
        }
      } else {
        mistakes++;
        flashKo(b);
        flashKo(selL.el);
        selL.el.style.borderColor = '';
        selL.el.classList.remove('is-sel');
        selL = null;
        beep('ko');
      }
    });
    colR.appendChild(b);
  });

  return {
    validate() {
      zone.querySelectorAll('.chip').forEach((el) => (el.disabled = true));
      return mistakes === 0;
    },
    solution: q.pairs.map(([a, b]) => `${a} → ${b}`).join(' · '),
  };
}

/* ------------------------------ Saisie libre ------------------------------ */

function mountInput(zone, q) {
  const input = document.createElement('input');
  input.className = 'input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.placeholder = 'Ta réponse…';
  input.addEventListener('input', () => setReady(input.value.trim().length > 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#btn-check').disabled) {
      e.preventDefault();
      onCheck();
    }
  });
  zone.appendChild(input);
  setTimeout(() => input.focus(), 60);

  return {
    validate() {
      const ok = q.accept.some((a) => normalize(a) === normalize(input.value));
      input.disabled = true;
      input.classList.add(ok ? 'is-ok' : 'is-ko');
      return ok;
    },
    solution: q.accept[0],
  };
}

/* ------------------------------ Vérification ------------------------------ */

function onCheck() {
  if (!session) return;

  if (phase === 'feedback') {
    nextQuestion();
    return;
  }
  if (phase !== 'answer' || !ctrl) return;

  const item = session.queue[0];
  const ok = ctrl.validate();
  phase = 'feedback';

  S.answers.total++;
  if (ok) S.answers.ok++;

  const firstTime = !session.seen.has(item.key);
  session.seen.add(item.key);

  if (ok) {
    session.combo++;
    session.bestCombo = Math.max(session.bestCombo, session.combo);
    if (firstTime) session.firstTryOk++;
    session.queue.shift();
    session.cleared++;
    // Une question n’est acquise que si elle tombe juste du premier coup :
    // corrigée après coup, elle reste dans le renforcement.
    if (firstTime) delete S.missed[item.key];
    beep('ok');
  } else {
    session.combo = 0;
    session.errors++;
    S.missed[item.key] = (S.missed[item.key] || 0) + 1;
    // Pas de vie perdue : la question repart simplement à la fin de la file.
    session.queue.push(session.queue.shift());
    beep('ko');
  }

  save();
  updateProgress();

  const fb = $('#feedback');
  fb.className = `feedback show ${ok ? 'ok' : 'ko'}`;
  fb.innerHTML = ok
    ? `<b>Bien vu ✅</b>${esc(item.q.exp || '')}`
    : `<b>À revoir 🔁</b>${item.q.t === 'paires' ? '' : `<u>Réponse</u> : ${esc(ctrl.solution)}<br />`}${esc(item.q.exp || '')}`;

  const btn = $('#btn-check');
  btn.disabled = false;
  btn.className = `btn ${ok ? 'btn-primary' : 'btn-wrong'}`;
  btn.textContent = session.queue.length ? 'Continuer' : 'Terminer';
  btn.focus();
}

/* ---------------------------- Fin de la session ---------------------------- */

function finishSession() {
  phase = 'done';
  const secs = Math.round((Date.now() - session.startedAt) / 1000);
  const perfect = session.errors === 0;
  const xpGained = session.total * 2 + 10 + (perfect ? 5 : 0);

  S.xp += xpGained;
  bumpStreak();

  let newCrown = false;
  if (session.lessonId) {
    const c = crownsOf(session.lessonId);
    if (c < MAX_CROWNS) {
      S.crowns[session.lessonId] = c + 1;
      newCrown = true;
    }
    const p = S.plays[session.lessonId] || { plays: 0, best: 0 };
    p.plays++;
    p.best = Math.max(p.best, Math.round((session.firstTryOk / session.total) * 100));
    S.plays[session.lessonId] = p;
  }
  save();
  beep('win');

  const accuracy = Math.round((session.firstTryOk / session.total) * 100);
  $('#lesson-progress').style.width = '100%';
  $('#lesson-combo').textContent = '';
  $('#feedback').className = 'feedback';
  $('#feedback').innerHTML = '';

  $('#lesson-body').innerHTML = `
    <div class="done">
      <div class="big">${perfect ? '🌟' : '🎉'}</div>
      <h2>${perfect ? 'Sans faute !' : 'Leçon terminée'}</h2>
      <p>${esc(session.title)}${newCrown ? ' · nouvelle couronne 👑' : ''}</p>
      <div class="done-grid">
        <div><b>+${xpGained}</b><span>XP</span></div>
        <div><b>${accuracy}%</b><span>Du 1<sup>er</sup> coup</span></div>
        <div><b>${secs}s</b><span>Durée</span></div>
      </div>
      <p class="hint">${
        session.errors
          ? `${session.errors} erreur${session.errors > 1 ? 's' : ''} — ces questions t’attendent dans l’onglet Renforcer.`
          : 'Aucune erreur : rien n’a été ajouté au renforcement.'
      }</p>
    </div>`;

  const btn = $('#btn-check');
  btn.disabled = false;
  btn.className = 'btn btn-primary';
  btn.textContent = 'Continuer';
}

/* ------------------------------- Événements ------------------------------- */

$('#btn-check').addEventListener('click', () => {
  if (phase === 'done') closeSession();
  else onCheck();
});

$('#btn-quit').addEventListener('click', () => {
  if (phase === 'done' || confirm('Quitter la leçon ? Ta progression dans cette leçon sera perdue.')) closeSession();
});

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => render(t.dataset.view));
});

$('#btn-sound').addEventListener('click', () => {
  S.sound = !S.sound;
  save();
  refreshTopbar();
});

document.addEventListener('keydown', (e) => {
  if ($('#lesson').hidden) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (phase === 'done') closeSession();
    else if (!$('#btn-check').disabled) onCheck();
    return;
  }
  if (e.key === 'Escape') {
    $('#btn-quit').click();
    return;
  }
  if (/^[1-9]$/.test(e.key) && phase === 'answer' && ctrl && ctrl.pick) {
    ctrl.pick(Number(e.key) - 1);
  }
});

/* --------------------------------- PWA --------------------------------- */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').hidden = false;
});

$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* hors ligne indisponible : le jeu fonctionne quand même */
    });
  });
}

/* --------------------------------- Départ --------------------------------- */

render('path');
