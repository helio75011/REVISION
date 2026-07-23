/* Vérificateur de la banque de questions — aucune dépendance.
   Usage : node tools/verifier-questions.js
   Contrôle la cohérence de js/data.js avant de compter sur le jeu pour réviser. */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'js', 'data.js');
const src = fs.readFileSync(file, 'utf8');
(0, eval)(src + ';globalThis.COURSE=COURSE;globalThis.FLAT_LESSONS=FLAT_LESSONS;globalThis.TOTAL_QUESTIONS=TOTAL_QUESTIONS;');

const TYPES = ['qcm', 'multi', 'vf', 'ordre', 'paires', 'saisie'];
const errs = [];
const types = {};
let n = 0;

COURSE.units.forEach((u) =>
  u.lessons.forEach((l) =>
    l.questions.forEach((q, i) => {
      n++;
      types[q.t] = (types[q.t] || 0) + 1;
      const at = `${l.id}#${i}`;
      if (!q.q) errs.push(`${at} : intitulé vide`);
      if (!q.exp) errs.push(`${at} : explication manquante`);
      if (!TYPES.includes(q.t)) errs.push(`${at} : type inconnu « ${q.t} »`);

      if (q.t === 'qcm') {
        if (!Array.isArray(q.a) || q.a.length < 2) errs.push(`${at} : au moins deux options attendues`);
        else {
          if (typeof q.c !== 'number' || q.c < 0 || q.c >= q.a.length) errs.push(`${at} : index de bonne réponse invalide`);
          if (new Set(q.a).size !== q.a.length) errs.push(`${at} : options dupliquées`);
        }
      }
      if (q.t === 'multi') {
        if (!Array.isArray(q.c) || !q.c.length) errs.push(`${at} : « c » doit être un tableau d’index`);
        else {
          q.c.forEach((c) => {
            if (c < 0 || c >= q.a.length) errs.push(`${at} : index ${c} hors bornes`);
          });
          if (q.c.length === q.a.length) errs.push(`${at} : toutes les options sont bonnes`);
        }
      }
      if (q.t === 'vf' && typeof q.c !== 'boolean') errs.push(`${at} : « c » doit être un booléen`);
      if (q.t === 'ordre') {
        if (!Array.isArray(q.items) || q.items.length < 3) errs.push(`${at} : au moins trois éléments attendus`);
        else if (new Set(q.items).size !== q.items.length) errs.push(`${at} : éléments dupliqués`);
      }
      if (q.t === 'paires') {
        if (!Array.isArray(q.pairs) || q.pairs.length < 2) errs.push(`${at} : au moins deux paires attendues`);
        else if (new Set(q.pairs.map((p) => p[0])).size !== q.pairs.length)
          errs.push(`${at} : colonne de gauche dupliquée (l’appariement deviendrait ambigu)`);
      }
      if (q.t === 'saisie' && (!Array.isArray(q.accept) || !q.accept.length))
        errs.push(`${at} : aucune réponse acceptée`);
    })
  )
);

const ids = FLAT_LESSONS.map((l) => l.id);
if (new Set(ids).size !== ids.length) errs.push('identifiants de leçon dupliqués');
if (TOTAL_QUESTIONS !== n) errs.push('TOTAL_QUESTIONS incohérent');

console.log(`Unités : ${COURSE.units.length} · Leçons : ${FLAT_LESSONS.length} · Questions : ${n}`);
console.log('Types :', JSON.stringify(types));
console.log(errs.length ? `\n❌ ${errs.length} problème(s) :\n` + errs.join('\n') : '\n✅ Banque de questions valide');
process.exit(errs.length ? 1 : 0);
