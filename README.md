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

Le menu principal propose trois modes. En **Partie rapide**, c'est la carte qui décide du mode.

- **Partie rapide → Route 66 (Escorte)**, en 2 contre 2 asymétrique.
  - Rôles : bleus et rouges sont tirés au sort en **attaque** ou en **défense**.
  - Le convoi :
    - Il suit un parcours A → checkpoint → B. C'est un obstacle : on se cache derrière, il arrête les tirs.
    - Au moins un attaquant dans sa zone et aucun défenseur : il avance (*Poussée*).
    - Attaquants et défenseurs dans la zone : il s'arrête net (*Contesté*).
    - Aucun attaquant : il s'arrête (*Arrêté*), puis recule à 1/4 de vitesse au bout de 3 s (*Recul*).
      Il ne recule jamais sous le checkpoint.
  - Le temps :
    - 3:00 pour atteindre le checkpoint, puis le chrono repart à 3:00 pour atteindre B.
    - À 0:00, si un attaquant touche le convoi : **prolongations** jusqu'à ce qu'il soit repoussé.
  - Spawns qui avancent :
    - Phase 1 : attaque au départ, défense au milieu.
    - Phase 2 : attaque au milieu, défense à l'arrivée.
    - Le spawn du milieu est caché derrière le virage, ses portes tournées à l'opposé du pont.
- **Partie rapide → Sanctuaire (Contrôle)**, en 2 contre 2.
  - Équipes :
    - **Bleue** : toi + 1 bot. **Rouge** : 2 bots.
    - Aucun héros en double dans une même équipe.
  - Le point :
    - Une équipe seule sur le point le capture (8 s, plus vite à deux).
    - Les deux équipes dessus : le point est **contesté**.
    - L'équipe qui possède le point gagne 1 % par seconde. À 100 %, elle remporte la manche.
    - **Prolongations** : impossible de gagner tant que l'adversaire conteste le point.
  - Les manches :
    - Match en 2 manches gagnantes, avec une transition de 3 s entre chaque.
    - À chaque manche, tout le monde repart du spawn avec PV et compétences à neuf.
  - **Spawn protégé** : dans le spawn de ton équipe, tu es invincible, soigné à 100 % et
    tu peux changer de héros (touche **C**). L'équipe adverse ne peut pas y entrer.
  - **Packs de soin** : +200 PV, réapparition au bout de 10 s.

- **Champ de tir** : sélection du héros, puis entraînement sur des cibles, des patrouilles,
  des tourelles qui tirent quand elles voient le joueur et des alliés blessés (stats de DPS).
- **Deathmatch** (chacun pour soi) : 1 à 7 bots, match de 1, 3 ou 5 minutes.
  - Tout le monde est l'ennemi de tout le monde (contour rouge).
  - 1 élimination = 1 point.
  - Réapparition au bout de 3 s sur un point aléatoire, loin des adversaires,
    avec PV et compétences remis à zéro.
  - Pendant la partie : chrono, nombre d'éliminations, position et fil des éliminations.
  - À la fin du chrono : tableau des scores, puis « Rejouer » ou retour au menu.

Départ de partie :
- **Compte à rebours de 10 s** dans tous les modes.
  - Champ de tir et Deathmatch : tout est figé pendant ce temps.
  - Contrôle et Escorte : les portes des spawns sont fermées. On peut bouger dans son spawn et changer de héros.
- **Escorte** : la défense sort au bout de 10 s, l'attaque au bout de 30 s.
  La défense a donc 20 s pour se placer, et le chrono de 3:00 ne démarre qu'à la sortie de l'attaque.
- **Réapparition** : 8 s en Partie rapide (Contrôle, Escorte), 3 s ailleurs.

Commun aux deux modes :

- **3 héros** : Rempart (tank), Flux (dégâts), Tempo (soutien).
- **Ligne de vue** : les murs bloquent la vision (raycasting + brouillard de guerre).
- **Zone de vision 16:9** identique pour tous les écrans ; caméra verrouillée sur le joueur.
- **Interface bilingue** FR / EN.

## Carte Route 66

Carte originale :
- Le convoi part du sud-ouest, longe une place et traverse le canal par un pont (passage obligé).
- Il passe le checkpoint, puis tourne dans les rues jusqu'au nord-est.
- On peut contourner par une passerelle à l'ouest, ou par une rue et un passage étroit à l'est.
- L'eau bloque les déplacements mais pas la vue ni les tirs.

## Carte Sanctuaire

Carte originale (`src/world/maps.ts`), symétrique par rotation de 180° pour que les deux
équipes aient exactement le même terrain.

- Les murs sont décrits pour une moitié, l'autre moitié est générée par symétrie.
- Chaque spawn s'ouvre par deux portes (traits jaunes au sol).
- Trois voies mènent à la salle centrale, qui abrite le point (cercle de 170 px de rayon).
- Six packs de soin sont répartis sur la carte.

Les cartes se décrivent avec des `MapDef` :
- murs, spawns par équipe, zones protégées, point de contrôle, packs de soin ;
- points de navigation pour l'IA (les liaisons entre eux sont calculées automatiquement).

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

En mode Contrôle, une couche **macro** décide où aller, au-dessus de ce combat :

- **Point pas à nous** : le bot y va et attaque les ennemis croisés en chemin ou sur le point.
- **Point à nous** : il patrouille dans le point ou tout près, et ne poursuit pas un ennemi
  qui s'éloigne trop.
- **Moins de 50 % de PV** : il fait un détour par un pack de soin proche.

Les longs trajets suivent un petit graphe de navigation (Dijkstra sur une cinquantaine de
points), et le bot coupe les virages dès qu'il voit plus loin sur le chemin.

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
| C                 | Changer de héros (Contrôle, dans ton spawn) |
| Échap             | Champ de tir : sélection du héros · autres modes : quitter la partie |

Dans les menus : touches 1, 2, 3… pour choisir, Entrée pour valider, Échap pour revenir.

## Structure

```
src/
  Game.ts          scènes (menu → carte / config → sélection → partie → scores) et boucle
  config.ts        valeurs globales (map, bots, vision, couleurs)
  i18n.ts          traductions FR / EN
  game/            simulation commune (World), convoi (Payload), packs de soin
  modes/           règles : champ de tir, Deathmatch, Contrôle, Escorte (bases MatchMode / TeamMatchMode)
  ai/              IA des bots héros (machine à états, objectif, navigation)
  core/            entrées, commandes joueur / IA, caméra, maths
  heroes/          classe Hero + un fichier par héros + registre
  entities/        bots du champ de tir, projectiles, interface Combatant
  world/           cartes (maps.ts), arène, ligne de vue, brouillard
  ui/              HUD, HUD du Deathmatch, écrans HTML (menus, sélection, scores)
```
