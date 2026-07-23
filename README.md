# Révision CDA — jeu PWA « Merise, UML & CI/CD »

Application web installable (PWA) pour réviser la soutenance CDA sur le principe de Duolingo —
**sans système de vies** : une mauvaise réponse ne fait jamais perdre la partie, la question
revient simplement plus tard dans la leçon, puis dans l’onglet **Renforcer**.

Tout le contenu provient des deux fiches de [../docs/](../docs/) :

- _MCD · MLD · MPD — Petit Rayon de Soleil_
- _Merise, UML et CI/CD — révision orale_

## Lancer le jeu

```bash
node server.js          # puis ouvrir http://localhost:4173
```

Sous Windows, double-cliquer sur **`lancer.cmd`** fait la même chose et ouvre le navigateur.

> Passer par un serveur est nécessaire : un service worker (mode hors ligne + installation)
> ne fonctionne pas depuis `file://`.

### Installer sur téléphone ou bureau

Une fois la page ouverte, le navigateur propose « Installer l’application » (ou bouton ⬇️ dans
l’en-tête ; sur iOS : _Partager → Sur l’écran d’accueil_). L’application fonctionne ensuite
**hors ligne**, la progression est stockée sur l’appareil.

## Contenu

| Élément | Quantité |
| --- | --- |
| Unités | 10 |
| Leçons | 22 |
| Questions | 158 |
| Types d’exercice | 6 |

Unités : Merise (la méthode) · La démarche dans l’ordre · Le MCD · Le MLD · Le MPD ·
Les règles de passage · UML cas d’utilisation · UML séquence · CI/CD · Chiffres & pièges.

Types d’exercice : QCM, choix multiples, vrai/faux, remise en ordre, association de paires,
saisie libre (réponse tolérante aux accents, à la casse et à la ponctuation).

## Mécaniques

- **Parcours débloqué pas à pas** : une leçon s’ouvre quand la précédente est terminée.
- **Pas de vies.** Une erreur remet la question à la fin de la file : la leçon ne se termine
  que lorsque toutes les questions sont tombées justes.
- **Feedback immédiat** avec l’explication issue de la fiche, y compris quand la réponse est bonne.
- **XP** : 2 par question + 10 en fin de leçon + 5 si aucune erreur.
- **Série** : un jour de plus par journée de révision consécutive.
- **Couronnes** : jusqu’à 5 par leçon, une par passage réussi.
- **Renforcer** : les questions ratées reviennent tant qu’elles ne sont pas réussies **du premier coup**.
- **Clavier** : `1`–`9` pour choisir, `Entrée` pour valider/continuer, `Échap` pour quitter.

## Structure

```
jeu/
├── index.html                    coquille de l’application
├── css/style.css                 thème clair/sombre, mobile first
├── js/data.js                    banque de questions (source unique du contenu)
├── js/app.js                     moteur : parcours, session, progression, PWA
├── sw.js                         service worker (cache hors ligne)
├── manifest.webmanifest          manifeste PWA
├── icons/                        icônes 192, 512 et maskable
├── server.js                     serveur statique local sans dépendance
├── lancer.cmd                    raccourci Windows
└── tools/verifier-questions.js   contrôle de cohérence de la banque
```

## Ajouter ou corriger une question

Tout se passe dans [js/data.js](js/data.js). Chaque question porte une explication (`exp`)
affichée après la réponse. Formats :

```js
{ t: 'qcm',    q: '…', a: ['…', '…'], c: 1, exp: '…' }
{ t: 'multi',  q: '…', a: ['…', '…', '…'], c: [0, 2], exp: '…' }
{ t: 'vf',     q: '…', c: true, exp: '…' }
{ t: 'ordre',  q: '…', items: ['1er', '2e', '3e'], exp: '…' }
{ t: 'paires', q: '…', pairs: [['gauche', 'droite'], …], exp: '…' }
{ t: 'saisie', q: '…', accept: ['réponse', 'variante'], exp: '…' }
```

Champ optionnel `code:` pour afficher un extrait SQL ou JavaScript sous l’intitulé.

Après modification :

```bash
node tools/verifier-questions.js     # vérifie index, doublons, explications manquantes
```

Puis incrémenter `CACHE_VERSION` dans [sw.js](sw.js) pour que les appareils déjà installés
récupèrent la nouvelle version.

## Point de contenu à connaître

Les fiches tranchent la contradiction signalée dans `CLAUDE.md` sur le nombre de tests :
**15 tests — 8 d’intégration et 7 unitaires**. C’est ce chiffre qui est enseigné par le jeu.
