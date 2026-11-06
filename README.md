# Web Hero Shooter

Prototype de hero shooter 2D en vue de dessus, jouable dans le navigateur.
Vite + TypeScript + Canvas 2D, sans backend pour l'instant.

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

Galerie des sprites pixel art (pour travailler les designs) : http://localhost:5173/sprites.html

| Commande            | Rôle                                          |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Serveur de développement (rechargement auto)  |
| `npm run build`     | Vérification TypeScript + build dans `dist/`  |
| `npm run preview`   | Sert le build de production                   |
| `npm run typecheck` | Vérification TypeScript seule                 |

## Modes de jeu

Le menu principal propose deux modes :

- **Champ de tir** : sélection du héros, puis entraînement sur des cibles, des patrouilles,
  des tourelles qui tirent quand elles voient le joueur et des alliés blessés (stats de DPS).
- **Deathmatch** (chacun pour soi) : 1 à 7 bots, match de 1, 3 ou 5 minutes.
  - Tout le monde est l'ennemi de tout le monde (contour rouge).
  - 1 élimination = 1 point.
  - Réapparition au bout de 3 s sur un point aléatoire, loin des adversaires,
    avec PV et compétences remis à zéro.
  - Pendant la partie : chrono, nombre d'éliminations, position et fil des éliminations.
  - À la fin du chrono : tableau des scores, puis « Rejouer » ou retour au menu.

Commun aux deux modes :

- **3 héros** : Rempart (tank), Flux (dégâts), Tempo (soutien).
- **Ligne de vue** : les murs bloquent la vision (raycasting + brouillard de guerre).
- **Zone de vision 16:9** identique pour tous les écrans ; caméra verrouillée sur le joueur.
- **Interface bilingue** FR / EN.

## IA des bots héros

Les héros ne lisent jamais le clavier directement : ils lisent des **commandes**
(`src/core/Controls.ts`). Le clavier remplit celles du joueur, l'IA celles des bots.
Un bot joue donc exactement les mêmes héros que le joueur, avec les mêmes règles.

L'IA (`src/ai/`) est une machine à états simple :

- **ROAM** : patrouille vers des points aléatoires. Les murs et la zone de dégâts sont
  évités par raycasts de hitbox (pas de pathfinding). Un bot coincé repart dans une direction libre.
- **ATTACK** : dès qu'il voit un adversaire (même test de vue que le joueur) ou qu'il est touché.
  - Il garde la distance idéale de son héros et se déplace en latéral.
  - Il vise avec un temps de réaction et une rotation limitée.
  - S'il perd sa cible de vue, il va voir à sa dernière position, puis repasse en ROAM après 3 s.

Comportements par héros :

| Héros   | Comportement |
| ------- | ------------ |
| Flux    | Distance moyenne, tire dès qu'il a la cible en vue. Sous 40 % de PV : Rappel, sinon Transfert pour fuir. Esquive parfois en Transfert latéral. |
| Rempart | Fonce au corps à corps. Lève le bouclier s'il est touché de loin. Onde de feu à distance. Charge si la ligne est dégagée. |
| Tempo   | Aura de Vitesse en patrouille, de Soin dès qu'il perd des PV. Tir continu, Onde de choc au contact, Surrégime quand il est en danger. |

## Commandes

| Touche            | Action                              |
| ----------------- | ----------------------------------- |
| ZQSD / WASD       | Se déplacer                         |
| Souris            | Viser                               |
| Clic gauche       | Arme principale                     |
| Clic droit        | Compétence 1                        |
| Espace / Maj      | Compétences 2 et 3                  |
| Clic molette      | Mêlée rapide (sauf Rempart)         |
| R                 | Recharger                           |
| H                 | Aide                                |
| X                 | Afficher les hitbox                 |
| B / T             | Tourelles on/off · reset des stats (champ de tir) |
| Échap             | Champ de tir : sélection du héros · Deathmatch : quitter la partie |

Dans les menus : touches 1, 2, 3… pour choisir, Entrée pour valider, Échap pour revenir.

## Structure

```
src/
  Game.ts          scènes (menu → config → sélection → partie → scores) et boucle
  config.ts        valeurs globales (map, bots, vision, couleurs)
  i18n.ts          traductions FR / EN
  game/World.ts    simulation commune : héros, bots, projectiles, dégâts, vision, rendu
  modes/           règles : champ de tir, Deathmatch
  ai/              IA des bots héros (machine à états, déplacement par raycasts)
  core/            entrées, commandes joueur / IA, caméra, maths
  heroes/          classe Hero + un fichier par héros + registre
  entities/        bots du champ de tir, projectiles, interface Combatant
  world/           map, ligne de vue, brouillard
  ui/              HUD, HUD du Deathmatch, écrans HTML (menus, sélection, scores)
```
