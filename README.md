# Web Hero Shooter

Prototype de hero shooter 2D en vue de dessus, jouable dans le navigateur.
Vite + TypeScript + Canvas 2D, sans backend pour l'instant.

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

Galerie des personnages (pour travailler les designs) : http://localhost:5173/sprites.html

| Commande            | Rôle                                          |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Serveur de développement (rechargement auto)  |
| `npm run build`     | Vérification TypeScript + build dans `dist/`  |
| `npm run preview`   | Sert le build de production                   |
| `npm run typecheck` | Vérification TypeScript seule                 |

## Version en ligne (GitHub Pages)

À chaque push sur `main`, le workflow `.github/workflows/deploy.yml` compile le jeu et le publie sur
https://azuure-dot.github.io/web-hero-shooter/ (galerie : `…/sprites.html`). Le build utilise des chemins
relatifs (`base: './'` dans `vite.config.ts`), il marche donc dans ce sous-dossier.

À faire une fois sur GitHub : Settings → Pages → Source : **GitHub Actions**. GitHub Pages demande un dépôt
public (ou un abonnement payant pour un dépôt privé). Le suivi des déploiements est dans l'onglet Actions.

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
- **Partie rapide → Sanctuaire ou Volcan (Contrôle)**, en 2 contre 2.
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
- **Compte à rebours** :
  - Champ de tir : aucun, on joue tout de suite.
  - Deathmatch : 3 s.
  - Partie rapide : 10 s. En Contrôle, il revient au début de chaque manche.
  - Deathmatch : tout est figé pendant ce temps.
  - Contrôle et Escorte : les portes des spawns sont fermées. On peut bouger dans son spawn et changer de héros.
- **Escorte** : la défense sort au bout de 10 s, l'attaque au bout de 30 s.
  La défense a donc 20 s pour se placer, et le chrono de 3:00 ne démarre qu'à la sortie de l'attaque.
- **Réapparition** : 8 s en Partie rapide (Contrôle, Escorte), 3 s ailleurs.

Commun à tous les modes :

- **Soin passif** : après 5 s sans subir de dégâts, chaque héros récupère 15 PV/s (0,5 s sur l'eau de Turty, voir plus bas). Il ne se cumule pas avec les autres soins (aura de Skater ou de Tempo, zone de soin) : seul le plus fort des deux s'applique.
- **Vitesse de marche** : celle de chaque héros est réduite de 30 % puis encore de 15 % (×0,6 au total,
  `MOVE_SPEED_SCALE` dans `src/heroes/Hero.ts`) ;
  les compétences de déplacement sont ralenties d'autant (Charge, course du trick, carapace ; distance du Transfert).
- **Bots héros** : ils infligent 30 % de dégâts en moins que le joueur.
- **Charge de Rempart contre un mur** : 250 dégâts et 2 s d'étourdissement pour la cible.
  Rempart lui-même reste bloqué 0,5 s après le plaquage.
- **6 héros** : Rempart (tank), Thor (tank), Flux (dégâts), Turty (dégâts), Tempo (soutien), Skater (soutien).
- **Thor** : tank de mêlée au marteau de foudre, pensé pour remplacer Rempart (600 PV, même vitesse, même poids).
  - Clic G : coup de marteau en arc (75 dégâts, même portée que Rempart), de droite à gauche puis de gauche
    à droite au coup suivant. Marteau lancé : petits coups de poing (25 dégâts).
  - Clic D maintenu : mur de foudre droit, face à Thor (1200 PV, bloque les tirs ennemis, ralentit comme le bouclier de Rempart).
  - Espace : ruée en avant sur la distance du Transfert de Flux, coup de marteau au bout ou sur le premier ennemi
    percuté (70 dégâts, gros recul). Marteau lancé : il fonce vers le marteau (même s'il revient), le ramasse
    et déclenche une décharge de 70 dégâts autour de lui. Recharge 6 s.
  - Maj : il lance son marteau vers le point visé (460 px max, arrêté par le premier mur). À l'impact, la foudre
    tombe : 80 dégâts au centre → 40 au bord. Le marteau reste planté au sol. Maj à nouveau : il revient à Thor
    à travers les murs (45 dégâts aux ennemis traversés). Recharge 6 s à partir du moment où il l'a récupéré.
  - Démarche lourde : il se dandine (le corps se décale et penche vers le pied posé, rebondit et s'écrase
    un peu à chaque pas, poussière sous le pied ; le marteau balance au rythme des pas).
- **Skater** : il se déplace sur sa planche, un peu plus vite que les autres.
  - Clic G : combo de 3 coups de planche (35, 35 puis 60 dégâts), le 3e repousse ; puis 1,5 s de recharge.
  - Clic D : il lance son équipement dans l'ordre (casque, genouillère, coudière, protège-poignet), 75 dégâts, toutes les secondes.
    On le voit armer puis lancer de la main droite.
  - Espace : trick (3 charges, rechargées une par une en 6 s) sur le joueur le plus proche dans la zone de l'aura.
    - Aura en mode Vitesse : sur un ennemi. Il fonce dessus (75 dégâts), rebondit, et gagne un palier de vitesse.
    - Aura en mode Soin : sur un allié, +75 PV, et un palier de son aura de soin.
    - Paliers enchaînés : 3 s après 1 trick, 5 s après 2, 8 s après 3 (chaque trick relance le chrono).
    - Un trick dans les 2 s qui suivent le précédent vise forcément quelqu'un d'autre. Personne à portée : il se pousse
      en avant sur sa planche (direction du déplacement, sinon de la visée) sur la distance du Transfert de Flux,
      en un quart de seconde, et garde son coup de boost.
  - Maj : mode d'aura Vitesse / Soin. L'aura bénéficie au Skater et à ses alliés proches (comme Tempo) : active de base, puis 3 paliers selon les tricks enchaînés.
    - Vitesse des alliés : +8 % de base, puis +11 / +16 / +22 %. Soin : 9,6 PV/s de base, puis 12 / 15,6 / 21,6 PV/s.
    - Vitesse du Skater lui-même avec les paliers de tricks sur des ennemis : +15 / +26 / +37 %.
- **Turty** : deux formes, humaine (vitesse moyenne) pour se battre, tortue pour se déplacer.
  - Clic G : pistolet à eau façon lanceur de base de Splatoon, 90 gouttes, 20 dégâts, 9 tirs/s. Tir peu précis
    (dispersion 24°, 30° en marchant) ; chaque goutte sème des taches et des éclaboussures le long de sa course,
    fines près de Turty et de plus en plus larges au loin : en rafale, l'eau forme un V ouvert devant elle.
    Les gouttes touchent aussi loin que le pistolet de Flux, mais ne mouillent le sol que jusqu'à 340 px
    (2 × l'aura du Skater). Le sol reste mouillé 15 s.
  - Sur l'eau (dans les deux formes), son soin passif démarre après 0,5 s sans dégâts au lieu de 5 s.
    Ses alliés aussi, sur l'eau de leur équipe : chaque case retient l'équipe qui l'a mouillée en dernier.
  - Clic D maintenu : forme tortue (relâché : forme humaine). En tortue : ×0,5 sur le sec, ×1,8 sur l'eau ;
    0,5 s sans compétence après la transformation. Clic G en tortue : elle se relève et tire aussitôt.
  - Espace : elle rentre dans sa carapace, la fait tourner (on peut encore viser) puis se lance ; 2 rebonds max sur les murs
    (les bords de lave font aussi rebondir), 75 dégâts à chaque ennemi touché. Recharge 12 s.
  - Maj : bombe à eau lancée en l'air jusqu'au point visé (560 px max), au-dessus des murs et des joueurs.
    Une zone d'ombre montre l'impact pendant tout le vol. 120 dégâts au centre → 60 au bord, et une grande flaque. Recharge 8 s.
- **Personnages vus de dessus, façon Bopz.io** (`src/render/topdown.ts`, poses dans chaque fichier de `src/heroes/`) :
  - la caméra est juste au-dessus des têtes : chaque héros est une boule (sa tête vue d'en haut) qu'on reconnaît
    à ses cheveux ou à son couvre-chef, avec deux mains rondes qui tiennent l'arme et l'animent (recul au tir,
    arcs de marteau, coups de poing, lancers) ; tout le personnage tourne avec la souris ;
  - Rempart : casque de chevalier, grand marteau · Thor : cheveux bleus, barbe tressée, mains bandées, marteau
    à runes lumineuses · Flux : cheveux roux en pointes, lunettes, deux blasters · Tempo : casque audio aux couleurs
    de l'aura, canon sonique · Turty : afro bouclée et bandana orange, peau verte, carapace à autocollants sur le dos,
    pistolet à eau-bouteille ; en tortue, carapace ronde avec tête et pattes · Skater : bonnet violet à pompon (qui
    cache ses cheveux), casque audio au cou, planche (qui tourne pendant les tricks, et sert d'arme à pied) ;
  - liseré aux couleurs de l'équipe autour de la tête, ombre au sol décalée, lumière fixe à l'écran ;
  - chaque tête, arme et main est dessinée une seule fois en haute résolution puis recopiée (≈ 0,1 ms par héros
    et par image) ;
  - les robots d'entraînement, tourelles et projectiles (équipement du Skater, bombe de Turty) sont encore en pixel art ;
  - galerie : `sprites.html` (chaque héros au repos, en action, et une version animée qui tourne et marche) ;
    croquis de référence dans `concept/` (Turty, Skater, Thor).
- **Ligne de vue** : les murs bloquent la vision (raycasting + brouillard de guerre).
  L'ombre des murs est calculée en quart de résolution puis agrandie avec lissage : bords doux sans filtre
  de flou, qui coûtait cher à chaque image sur une carte graphique intégrée.
- **Zone de vision 16:9** identique pour tous les écrans (985 × 554 unités), caméra verrouillée sur le joueur.
  Elle remplit exactement un écran 16:9 ; sur un écran plus large (ou 4:3), le surplus est dans l'ombre :
  personne ne voit plus de terrain qu'un autre. Les bots voient la même zone que le joueur.
  Le rapprochement de la caméra (×1,95 par rapport à 1920 × 1080) est `CAMERA_ZOOM` dans `src/config.ts`.
- **Interface bilingue** FR / EN.

## Carte Route 66

Carte originale :
- Le convoi part du sud-ouest, longe une place et traverse le canal par un pont (passage obligé).
- Il passe le checkpoint, puis tourne dans les rues jusqu'au nord-est.
- On peut contourner par une passerelle à l'ouest, ou par une rue et un passage étroit à l'est.
- L'eau bloque les déplacements mais pas la vue ni les tirs.

## Carte Volcan

Carte de contrôle dessinée par le joueur : un camp scientifique installé dans un volcan.
Elle est symétrique par rotation de 180°, comme Sanctuaire.

- **Spawns** : des laboratoires d'analyse avec paillasses et console.
  Chacun s'ouvre par deux portes sur une cour avec un héliport.
- **Accès au point** : un couloir longe les bâtiments du camp jusqu'à l'entrée nord ;
  un autre descend vers une grande salle latérale, avec une cuve de magma comme couvert.
- **Le point** : il est posé sur une passerelle en tôle perforée au-dessus du cratère.
  - On y entre par quatre accès : nord, sud, est et ouest.
  - Il est entouré de quatre fosses de lave. Leurs côtés extérieurs sont fermés
    par des garde-corps ; elles sont ouvertes côté point.
- **La lave** :
  - Impossible d'y entrer en marchant : on s'arrête au bord, marqué d'une bande jaune et noire.
  - Un recul (Onde de choc, marteau, mêlée, bousculade de Charge) peut y projeter un héros.
    Il meurt dès que son centre passe au-dessus de la lave.
  - Une Charge de Rempart qui épingle un ennemi le lâche au-dessus de la fosse ;
    Rempart, lui, s'arrête au bord.
  - La chute est créditée au dernier héros qui a poussé la victime (dans les 4 s).
    Le fil des éliminations affiche « LAVE ».
- **Rendu pixel art** (`src/world/themes/volcano.ts`) : 1 pixel du décor = 4 unités.
  - Roche veinée de lave, toits équipés (panneaux solaires, clims, paraboles, cheminées),
    façades éclairées, garde-corps rayés.
  - La lave des fosses est animée, avec une lueur et des braises.

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
| Thor    | Fonce au corps à corps. Mur de foudre s'il est touché de loin. Lance son marteau à mi-distance, puis fonce le ramasser s'il est tombé près de la cible, sinon le rappelle. Ruée pour coller une cible un peu éloignée. |
| Tempo   | Aura de Vitesse en patrouille, de Soin dès qu'il perd des PV. Tir continu, Onde de choc au contact, Surrégime quand il est en danger. |

## Commandes

| Touche            | Action                              |
| ----------------- | ----------------------------------- |
| ZQSD / WASD       | Se déplacer                         |
| Souris            | Viser                               |
| Clic gauche       | Arme principale                     |
| Clic droit        | Compétence 1                        |
| Espace / Maj      | Compétences 2 et 3                  |
| Clic molette      | Mêlée rapide (sauf Rempart et Thor) |
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
  render/          personnages vus de dessus : têtes, cheveux, mains et armes (topdown.ts)
  sprites/         pixel art restant : robots d'entraînement, tourelles, projectiles
  entities/        bots du champ de tir, projectiles, interface Combatant
  world/           cartes (maps.ts), arène, ligne de vue, brouillard, thèmes pixel art (themes/)
  ui/              HUD, HUD du Deathmatch, écrans HTML (menus, sélection, scores)
```
