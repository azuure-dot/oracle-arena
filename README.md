# Web Hero Shooter

Prototype de hero shooter 2D en vue de dessus, jouable dans le navigateur.
Vite + TypeScript + Canvas 2D. Solo contre des bots, et **parties privées en ligne** (serveur Node +
Socket.io dans `server/`, voir [Multijoueur](#multijoueur-parties-privées)).

## Lancer le projet

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

Galerie des personnages (pour travailler les designs) : http://localhost:5173/galerie.html

| Commande            | Rôle                                          |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Serveur de développement (rechargement auto)  |
| `npm run build`     | Vérification TypeScript + build dans `dist/`  |
| `npm run preview`   | Sert le build de production                   |
| `npm run typecheck` | Vérification TypeScript seule                 |

## Multijoueur (parties privées)

Menu principal → **Partie privée** : créer un salon (code de 6 caractères à partager) ou en rejoindre
un avec son code, sans compte. Dans le salon, l'hôte choisit le mode, la carte, la durée et
« Remplir avec des bots » ; chacun choisit son héros et se met **Prêt** ; l'hôte lance la partie
quand tous les joueurs sont prêts. Jusqu'à 6 joueurs.

- **Serveur autoritaire** (`server/`, Node + TypeScript + Express + Socket.io) : il fait tourner la
  même simulation que le solo (`src/game/World.ts`, les héros, l'IA des bots) à 60 Hz et envoie
  30 instantanés par seconde. Les clients n'envoient que leurs commandes.
- **Client** (`src/network/`) : prédiction du déplacement du joueur local avec réconciliation,
  interpolation des autres joueurs, HUD et scores du Deathmatch solo.
- **Disponible en ligne : Deathmatch FFA**, avec toutes les compétences des 5 héros. Champ de tir,
  Contrôle et Escorte sont affichés « Bientôt » dans le salon.

En local, deux terminaux :

```bash
cd server && npm install && cp .env.example .env && npm run dev   # serveur : http://localhost:3001
```

```bash
npm run dev                                                       # client : http://localhost:5173
```

Puis deux onglets : l'un crée le salon, l'autre le rejoint par le code. Le client vise
`VITE_SERVER_URL` (fichier `.env.local`, voir `.env.example`), par défaut `http://localhost:3001`.

| Commande (dans `server/`) | Rôle                                                   |
| ------------------------- | ------------------------------------------------------ |
| `npm run dev`             | Serveur de développement (`ts-node-dev`, redémarrage auto) |
| `npm run build`           | Compilation TypeScript dans `server/dist/`             |
| `npm start`               | Lance le serveur compilé                               |

Hébergement : le site reste statique (GitHub Pages aujourd'hui, ou Vercel / Netlify) avec la
variable `VITE_SERVER_URL` au build ; le serveur WebSocket doit être un **processus permanent**
(Railway, Render ou Fly.io, pas de fonctions serverless). Redis / Upstash seulement pour plusieurs
instances, plus tard. Architecture, protocole, marche à suivre et reste à faire :
**[docs/multijoueur.md](docs/multijoueur.md)**.

## Version en ligne (GitHub Pages)

À chaque push sur `main`, le workflow `.github/workflows/deploy.yml` compile le jeu et le publie sur
https://azuure-dot.github.io/oracle-arena/ (galerie : `…/galerie.html`). Le build utilise des chemins
relatifs (`base: './'` dans `vite.config.ts`), il marche donc dans ce sous-dossier.

À faire une fois sur GitHub : Settings → Pages → Source : **GitHub Actions**. GitHub Pages demande un dépôt
public (ou un abonnement payant pour un dépôt privé). Le suivi des déploiements est dans l'onglet Actions.

## Menu principal (lobby)

Style « Grèce antique » (aussi sur les écrans de choix de la carte, réglages du Deathmatch, sélection
du héros et scores) : marbre veiné, blanc et or, frises à méandres dorées, groupe en façade de temple
(fronton, colonnes, marches), couronne d'olivier, places numérotées de 1 à 6. Polices Marcellus et EB Garamond.
La sélection du héros a le même fond de marbre que l'accueil.

Deux thèmes au choix dans les Paramètres (« Thème », mémorisé) : **Jour** (par défaut, marbre au
soleil) et **Nuit** (même temple au clair de lune : marbre sombre, panneaux bleu nuit, or, ciel
étoilé et pleine lune). La Nuit ne change que les couleurs : `src/ui/themes/greece-night.css` se pose
par-dessus `greece.css`, et son décor (ciel, lune, colonnes) est `greeceNightDecor` dans `ornaments.ts`.

La feuille est `src/ui/themes/greece.css`, posée par `src/ui/theme.ts`. Ce qui change dans le HTML
(icônes, décor, numéros des places, couronne) est dans `src/ui/lobby/kits.ts`, dessiné en SVG dans
`src/ui/lobby/ornaments.ts`. Deux anciens styles restent dans le dépôt sans être chargés ni proposés :
`myth.css` (mythologique, nuit étoilée) et `esport.css` (e-sport néon) ; `src/ui/theme.ts` explique
comment en remettre un (il s'ajoute alors au choix du thème).

- **Onglets en haut** : Accueil (actif), Passe de combat et Boutique (verrouillés, badge « Bientôt »).
  La roue dentée ouvre les **Paramètres** : langue FR/EN (tous les textes changent aussitôt), thème
  Jour / Nuit, pseudo, photo de profil et bannière (5 de chaque, une par héros).
- **Groupe de 6 au centre** : la carte 1 est le joueur, chef du groupe (bannière, avatar, pseudo).
  Les places 2 à 6 ajoutent ou retirent un bot (héros tiré au sort). Pour l'instant ces bots sont
  décoratifs : la composition des équipes en partie ne change pas.
- **JOUER en bas à gauche** ouvre le tiroir des modes : Partie rapide, Deathmatch, Champ de tir
  (Classé verrouillé jusqu'au multijoueur), avec la note sur les adversaires IA. Raccourcis :
  `1`-`3` choisissent un mode, `Entrée` lance, `Échap` ferme.
- **PARTIE PRIVÉE**, à côté : jeu en ligne avec un code de salon (voir
  [Multijoueur](#multijoueur-parties-privées)).
- **Visuels** : avatars et bannières sont des SVG générés dans `src/ui/lobby/art.ts`.
- **État** : `src/ui/lobby/profile.ts` (pseudo, avatar, bannière, mode, groupe), mémorisé dans le
  navigateur ; le menu se met à jour à chaque changement.
- **Navigation rapide** :
  - les écrans se mettent à jour en place (`src/ui/morph.ts`) : un clic ne modifie que ce qui
    change, sans rejouer les apparitions ni perdre le focus ;
  - l'entrée animée de l'accueil n'a lieu qu'au premier affichage ;
  - les menus sont opaques (`--screen-covers: 1` dans le thème) : le jeu ne dessine plus rien
    derrière eux ;
  - les veines du marbre sont converties une fois en image au démarrage (`src/ui/theme.ts`) ;
  - les vignettes et illustrations des héros sont préparées pendant que le joueur est sur l'accueil.

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

- **Sélection du héros** (avant chaque partie, et au spawn pour changer de héros), façon Overwatch / Valorant :
  au fond, la carte de la partie floutée (lent travelling) ; au centre, la grande illustration du héros
  sélectionné, son nom, son rôle et ses compétences ; en bas, la grille des héros regroupés par rôle
  (vignettes = le héros tel qu'on le voit en jeu) et le bouton **Prêt**. Clic ou touches 1-5 pour
  sélectionner, double-clic, Entrée ou Prêt pour jouer, Échap pour revenir. Au spawn, le héros joué et
  ceux des alliés sont grisés. Illustrations détourées dans `src/assets/heroes/`.
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

- **Soin passif** : après 5 s sans subir de dégâts, chaque héros récupère 15 PV/s (0,5 s sur l'eau de Kora, voir plus bas). Il ne se cumule pas avec les autres soins (aura d'Elio, zone de soin) : seul le plus fort des deux s'applique.
- **Vitesse de marche** : celle de chaque héros est réduite de 30 % puis encore de 15 % (×0,6 au total,
  `MOVE_SPEED_SCALE` dans `src/heroes/Hero.ts`) ;
  les compétences de déplacement sont ralenties d'autant (ruée de Torsten, course du trick, carapace ; distance de la Frappe fantôme).
- **Bots héros** : ils infligent 30 % de dégâts en moins que le joueur.
- **5 héros** : Torsten (tank), Flux (dégâts), Kora (dégâts), Elio (soutien), Camellia (soutien).
  Dans le code, trois gardent leur ancien nom (fichiers, classes, identifiants) : Torsten = `Thor`, Kora = `Turty`,
  Elio = `Skater`.
- **Flux, le glitcheur** (leurres et faux-semblants : l'adversaire doit deviner le vrai du faux), 175 PV, petite boule.
  - Clic G : blasters jumeaux (20 balles/s, 40 munitions, 7,8 dégâts).
  - Clic D, Frappe fantôme : 2 téléportations courtes (101 unités, direction du déplacement, sinon de la visée).
    La première rend Flux invisible 0,5 s pour l'adversaire et laisse à sa place un clone holographique immortel qui
    court tout droit vers la visée pendant 2 s avant de disparaître (aucun effet à l'arrivée : rien ne trahit où il est
    allé). La seconde est une simple téléportation, sans clone. Les deux reviennent ensemble 6 s après la première.
  - Espace, Permutation : échange instantanément sa place avec son clone le plus proche. Un nouveau clone apparaît
    à son ancienne place (nouveau leurre). Sans clone actif, rien ne se passe (recharge non consommée). Chaque
    permutation rend 75 PV. Recharge 10 s.
  - Les clones : l'adversaire les voit exactement comme Flux (même dessin, même barre de vie, même nom) ; ses bots
    les prennent pour cible. Ils sont immortels : les tirs les touchent (chiffre de dégâts et marqueur de touche comme
    sur un vrai héros) sans les arrêter ni compter comme une élimination. Flux et ses alliés les voient translucides, qui grésillent.
  - Invisible, Flux n'est ni affiché ni ciblé par l'adversaire (bots, tourelles), mais les tirs le touchent toujours ;
    lui et ses alliés le voient en hologramme. Le joueur voit en pointillé où le mènerait la Permutation.
  Rempart (tank) et Tempo (soutien) sont retirés de la sélection : ni le joueur ni les bots ne les jouent plus,
  mais leur code reste en place (`RETIRED_HEROES` dans `src/heroes/registry.ts` : déplacer une entrée dans
  `HEROES` pour le remettre).
- **Torsten** : tank de mêlée au marteau de foudre (600 PV).
  - Clic G : coup de marteau en arc (75 dégâts), de droite à gauche puis de gauche
    à droite au coup suivant. Marteau lancé : petits coups de poing (25 dégâts).
  - Clic D maintenu : mur de foudre droit, face à Torsten (800 PV, bloque les tirs ennemis, ralentit Torsten de 30 %).
  - Espace : 1 s de charge sur place (la foudre s'accumule, la direction suit la visée, le couloir s'affiche au sol ;
    un étourdissement l'annule), puis ruée en avant sur la distance de la Frappe fantôme de Flux, coup de marteau au
    bout ou sur le premier ennemi percuté (70 dégâts, gros recul). Marteau lancé : même charge, puis il fonce vers le
    marteau (même s'il revient), le ramasse et déclenche une décharge de 70 dégâts autour de lui. Recharge 6 s.
  - Maj : il lance son marteau vers le point visé (460 px max, arrêté par le premier mur). À l'impact, la foudre
    tombe : 80 dégâts au centre → 40 au bord. Le marteau reste planté au sol. Maj à nouveau : il revient à Torsten
    à travers les murs (45 dégâts aux ennemis traversés). Recharge 6 s à partir du moment où il l'a récupéré.
  - Démarche lourde : il se dandine (le corps se décale et penche vers le pied posé, rebondit et s'écrase
    un peu à chaque pas, poussière sous le pied ; le marteau balance au rythme des pas).
- **Elio** : il se déplace sur sa planche, un peu plus vite que les autres.
  - Clic G : combo de 3 coups de planche (35, 35 puis 60 dégâts), le 3e repousse. Pas de rechargement : quand il arrête
    de taper (ou après le 3e coup), il attend 1,5 s après son dernier coup avant de pouvoir retaper (le combo repart du 1er).
  - Clic D : il lance son équipement dans l'ordre (casque, genouillère, coudière, protège-poignet), 75 dégâts, toutes les secondes.
    On le voit armer puis lancer de la main droite.
  - Espace : trick (3 charges, rechargées une par une en 6 s) sur le joueur le plus proche dans la zone de l'aura.
    - Aura en mode Vitesse : sur un ennemi. Il fonce dessus (75 dégâts), rebondit, et gagne un palier de vitesse.
    - Aura en mode Soin : sur un allié, +75 PV, et un palier de son aura de soin.
    - Paliers enchaînés : 3 s après 1 trick, 5 s après 2, 8 s après 3 (chaque trick relance le chrono).
    - Un trick dans les 2 s qui suivent le précédent vise forcément quelqu'un d'autre. Personne à portée : il se pousse
      en avant sur sa planche (direction du déplacement, sinon de la visée) sur la distance de la Frappe fantôme de Flux,
      en un quart de seconde, et garde son coup de boost.
  - Maj : mode d'aura Vitesse / Soin. L'aura bénéficie à Elio et à ses alliés proches : active de base, puis 3 paliers selon les tricks enchaînés.
    - Vitesse des alliés : +10 % de base, puis +13 / +18 / +25 %. Soin : 11 PV/s de base, puis 14 / 18 / 25 PV/s.
    - Vitesse d'Elio lui-même avec les paliers de tricks sur des ennemis : +15 / +26 / +37 %.
- **Camellia, l'archange** : soutien à distance (200 PV). Ailes blanches, auréole dorée, longs cheveux rose crevette.
  - Clic G, rafale de plumes : tir automatique façon fusil d'assaut, 9 plumes/s, chargeur de 30, recharge 1,6 s.
    Chaque plume fait 10 dégâts à un ennemi ; sur un allié, elle s'arrête et lui rend 30 PV (pas sur Camellia elle-même).
  - Clic D, petit ange (2 charges, rechargées une par une en 8 s) : lancé sur la souris. Si un joueur est sous la souris, il
    file droit sur lui ; sinon il va au point visé puis rejoint le joueur le plus proche (260 autour, allié ou ennemi).
    Il vole par-dessus les murs et se colle dans le dos de sa cible pendant 5 s : allié +35 PV/s, ennemi 20 dégâts/s.
    Personne autour au bout de 3 s : il disparaît.
  - Espace, Envol : elle vole jusqu'à l'allié visé (le plus proche de la ligne de visée, en vue, à 460 max), ailes grandes
    ouvertes. Personne de visé : rien ne se passe (recharge non consommée). Recharge 5 s. L'allié visé est entouré.
  - Maj, Sanctuaire de plumes : un ange gardien se pose sous la souris (420 max, s'arrête aux murs) et ouvre une zone de
    110 de rayon où tombe une pluie de plumes. Elle ne soigne pas : c'est un anti-mort, les alliés à l'intérieur
    (Camellia comprise) ne peuvent pas descendre sous 50 PV (la lave tue quand même). L'ange a 100 PV qui baissent petit
    à petit (0 au bout de 10 s) ; l'adversaire peut le viser et le tuer (les bots le prennent pour cible) : la zone disparaît avec lui.
    Il ne compte ni dans le score ni dans le fil des éliminations. Recharge 20 s.
  - Les anges (petits anges et ange gardien) sont bleus pour une Camellia de l'équipe du joueur, rouges pour une adverse.
- **Kora** : deux formes, humaine (vitesse moyenne) pour se battre, tortue pour se déplacer.
  - Clic G : pistolet à eau façon lanceur de base de Splatoon, 90 gouttes, 30 dégâts, 9 tirs/s. Tir peu précis
    (dispersion 24°, 30° en marchant) ; chaque goutte sème des taches et des éclaboussures le long de sa course,
    fines près de Kora et de plus en plus larges au loin : en rafale, l'eau forme un V ouvert devant elle.
    Les gouttes touchent aussi loin que le pistolet de Flux, mais ne mouillent le sol que jusqu'à 340 px
    (2 × l'aura d'Elio). Le sol reste mouillé 15 s.
    L'eau appartient à l'équipe qui l'a posée en dernier (comme dans Splatoon) : vue par le joueur, l'eau de son
    équipe est bleue, celle d'une Kora adverse rouge (flaques et gouttes).
    Rendu des flaques : contour calculé 10 fois par seconde (« marching squares » sur un niveau d'eau adouci entre
    cases voisines) puis dessiné en vectoriel : bords arrondis et nets à tout zoom, liseré clair, quelques reflets ;
    une flaque qui sèche rétrécit avant de disparaître (`src/game/WetGround.ts`).
  - Sur l'eau (dans les deux formes), son soin passif démarre après 0,5 s sans dégâts au lieu de 5 s.
    Ses alliés aussi, sur l'eau de leur équipe : chaque case retient l'équipe qui l'a mouillée en dernier.
  - Clic D maintenu : forme tortue (relâché : forme humaine). En tortue : ×0,5 sur le sec, ×1,8 sur l'eau ;
    0,5 s sans compétence après la transformation. Clic G en tortue : elle se relève et tire aussitôt.
  - Espace : elle rentre dans sa carapace, la fait tourner (on peut encore viser) puis se lance. La carapace est
    téléguidée : pendant la préparation, on sélectionne un adversaire (le plus proche de la ligne de visée, en vue,
    900 max ; viseur rouge autour de lui, plein une fois verrouillé). Pendant sa course, la carapace tourne peu à peu
    vers lui (3,2 rad/s), où qu'on vise ensuite, et continue de le poursuivre après chaque rebond (sur lui ou sur un
    mur), jusqu'à la fin de sa course. Cible morte ou devenue invisible : tout droit. Sans adversaire sélectionné,
    elle suit la souris. Elle rebondit sur les murs
    (2 rebonds max ; les bords de lave font aussi rebondir) et sur chaque ennemi percuté (75 dégâts, il est repoussé ;
    il peut être repercuté 0,5 s plus tard, ou après un rebond sur un mur). Recharge 12 s, 3,5 s de course max.
  - Maj : bombe à eau lancée en l'air jusqu'au point visé (560 px max), au-dessus des murs et des joueurs.
    Une zone d'ombre montre l'impact pendant tout le vol. 120 dégâts au centre → 60 au bord, et une grande flaque. Recharge 8 s.
- **Personnages vus de dessus, façon Bopz.io** (`src/render/topdown.ts`, poses dans chaque fichier de `src/heroes/`) :
  - la caméra est juste au-dessus des têtes : chaque héros est une boule (sa tête vue d'en haut) qu'on reconnaît
    à ses cheveux ou à son couvre-chef, avec deux mains rondes qui tiennent l'arme et l'animent (recul au tir,
    arcs de marteau, coups de poing, lancers) ; tout le personnage tourne avec la souris ;
  - Torsten : cheveux bleus, barbe tressée, mains bandées, marteau
    à runes lumineuses · Flux : casquette noire à l'envers (visière dans la nuque, liseré cyan), peau foncée, gants cyber à
    bracelets lumineux, deux blasters aux balles bleu cyan · Kora : afro bouclée et bandana orange, peau verte, carapace à autocollants sur le dos,
    pistolet à eau-bouteille ; en tortue, carapace ronde avec tête et pattes · Elio : bonnet violet à pompon (qui
    cache ses cheveux), casque audio au cou, planche (qui tourne pendant les tricks, et sert d'arme à pied) ·
    Camellia : longs cheveux lisses rose crevette qui tombent dans le dos, auréole dorée, grandes ailes blanches (à demi
    repliées au repos, qui battent en marchant, grandes ouvertes en vol), épaulières dorées, mains bandées et orbe de
    lumière d'où partent les plumes ; ses anges sont des boules bleues (alliés) ou rouges (adverses) à petites ailes
    blanches et mini-auréole dorée ;
  - liseré aux couleurs de l'équipe autour de la tête, ombre au sol décalée, lumière fixe à l'écran ;
  - **hitbox ronde** : la boule dessinée est exactement la hitbox (dégâts reçus et collisions avec les murs, qui font
    glisser le long des parois et contourner les coins). Rayons : Torsten 23, Kora 15,
    Elio 15, Camellia 14, Flux 13 (petite boule : fragile mais difficile à toucher) ; robots 17, tourelles 18 ;
  - les robots d'entraînement (dôme d'acier, visière aux couleurs de l'équipe) et les tourelles (socle boulonné,
    canon double) sont dessinés de la même façon, comme les projectiles (équipement d'Elio, bombe à eau) ;
  - chaque tête, arme et main est dessinée une seule fois en haute résolution puis recopiée (≈ 0,1 ms par héros
    et par image) ;
- **Performances sur la durée** :
  - sur un écran 120/144 Hz, le jeu ne dessine qu'une image sur deux (60-72 images/s) : moitié moins de
    travail pour la carte graphique, qui chauffe moins et ne se bride plus après quelques parties ;
  - en fin de partie, les grandes images du décor (sol, murs, lave) sont libérées tout de suite, ainsi que
    les cartes floutées de la sélection au lancement d'une partie, au lieu d'attendre le ramasse-miettes ;
  - les calculs qui tournent en continu (flaques d'eau, liste des cibles) réutilisent leurs tableaux.
  - collisions : les obstacles fixes sont rangés dans une grille, un test ne regarde que les cases
    voisines (les bots en font des centaines par image) ;
  - brouillard : le champ de vision ne lance des rayons que vers les coins de murs autour du joueur.
  - galerie : `galerie.html` (chaque héros au repos, en action, et une version animée qui tourne et marche ;
    robots, tourelles, projectiles) ;
    croquis de référence dans `concept/` (Kora, Elio, Torsten).
- **Ligne de vue** : les murs bloquent la vision (raycasting + brouillard de guerre).
  L'ombre des murs est calculée en quart de résolution puis agrandie avec lissage : bords doux sans filtre
  de flou, qui coûtait cher à chaque image sur une carte graphique intégrée.
- **Cercle de vision** autour de chaque héros (rayon 492 unités, `VISION` dans `src/config.ts`), caméra
  verrouillée sur le joueur. Chacun voit depuis sa propre position : son cercle, moins ce que les murs lui
  cachent. Les bots ont exactement la même règle, chacun depuis son point de vue. La caméra montre un cadre
  16:9 fixe (985 × 554 unités, rapprochement `CAMERA_ZOOM` ×1,95), le même sur tous les écrans : le cercle
  va d'un bord à l'autre en largeur et dépasse un peu en hauteur, où la vue s'arrête au bord de l'écran (pour
  tous, bots compris). Au-delà du cercle, la carte est assombrie et aucun ennemi n'est affiché.
  Le brouillard ne lance des rayons que vers les coins des murs du carré qui contient le cercle ; les murs qui
  sortent de ce carré y sont découpés, et leur point de sortie compte comme un coin (ombres justes au bord).
- **Interface bilingue** FR / EN.

## Carte Route 66

Carte originale :
- Le convoi part du sud-ouest, longe une place et traverse le canal par un pont (passage obligé).
- Il passe le checkpoint, puis tourne dans les rues jusqu'au nord-est.
- On peut contourner par une passerelle à l'ouest, ou par une rue et un passage étroit à l'est.
- L'eau bloque les déplacements mais pas la vue ni les tirs.

## Carte Volcan

Carte de contrôle dessinée par le joueur (2e version, d'après le croquis « Map Control Volcan ») : un camp
scientifique installé dans un volcan. Elle est symétrique par rotation de 180°, comme Sanctuaire.

- **Spawns** : des laboratoires d'analyse avec paillasses et console.
  Chacun s'ouvre par deux portes sur une cour avec un héliport.
- **Accès au point** (couloirs allongés par rapport à la 1re version) :
  - à l'ouest, un long couloir étroit longe les bâtiments du camp jusqu'à l'entrée nord ;
  - à l'est, un passage étroit mène à une petite salle intermédiaire (un mur au milieu pour se
    couvrir, un pack de soin), puis un couloir descend vers la grande salle latérale.
- **Les grandes salles latérales** : chacune a une cuve ronde comme couvert, placée du côté de
  l'équipe qui y arrive (et non du côté de ceux qui la prennent à revers).
- **Le point** : il est posé sur une plateforme en tôle au-dessus du cratère.
  - Deux murs en arc de cercle couvrent ses extrémités nord et sud : on contourne l'arc pour entrer.
  - Il est entouré de quatre fosses de lave au bord arrondi, tourné vers le point. Leurs côtés
    extérieurs sont fermés par des garde-corps.
- **La lave** :
  - Impossible d'y entrer en marchant : on s'arrête au bord.
  - Un recul (marteau et ruée de Torsten, bombe à eau, coup de planche, mêlée) peut y projeter un héros.
    Il meurt dès que son centre passe au-dessus de la lave. Torsten, lui, s'arrête au bord pendant sa ruée.
  - La chute est créditée au dernier héros qui a poussé la victime (dans les 4 s).
    Le fil des éliminations affiche « LAVE ».
- **Formes arrondies** (fosses, arcs, cuves) : décrites telles qu'on les voit (`shapes` dans
  `src/world/maps.ts`) ; leurs collisions sont des bandes de 12 unités générées à partir de ces formes.
- **Rendu vectoriel vu de dessus** (`src/world/themes/volcano.ts`), dans le style des personnages :
  aplats, contour d'encre, lumière fixe venant du haut à gauche.
  - Sol en cache (basalte cendré, fissures, cratère roussi, lueur des fosses, tôles du camp, héliport,
    ombres des murs).
  - Murs dessinés à chaque image, nets à tout zoom : roche veinée de lave, bâtiments en tôle rivetée,
    mobilier du labo, garde-corps rayés jaune et noir, arcs en béton, cuves cerclées.
  - Animé : lave qui bouillonne dans les fosses, plateforme en caillebotis sous le point.

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
  évités par raycasts de leur boule (pas de pathfinding). Un bot coincé repart dans une direction libre.
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
| Flux    | Distance moyenne, tire dès qu'il a la cible en vue. Esquive parfois en Frappe fantôme latérale (le clone file vers la cible et attire les tirs). Sous 45 % de PV : Permutation (+75 PV), sinon Frappe fantôme pour fuir. |
| Torsten   | Fonce au corps à corps. Mur de foudre s'il est touché de loin. Lance son marteau à mi-distance, puis fonce le ramasser s'il est tombé près de la cible, sinon le rappelle. Ruée pour coller une cible un peu éloignée. |
| Camellia | Distance moyenne, tire en rafale ; les soins passent avant le tir : elle tourne sa visée vers un allié pour poser son Sanctuaire (ange gardien, anti-mort) sur un allié en danger, sous 45 % de PV (ou sur elle-même), lui lancer un petit ange, ou s'envoler jusqu'à lui s'il est loin (et pour fuir vers un allié quand elle est à bout). Garde une charge de petit ange pour soigner, sinon le lance sur l'ennemi qu'elle combat. Hors combat, soigne un allié blessé en lui tirant ses plumes dessus. |

## Commandes

| Touche            | Action                              |
| ----------------- | ----------------------------------- |
| ZQSD / WASD       | Se déplacer                         |
| Souris            | Viser                               |
| Clic gauche       | Arme principale                     |
| Clic droit        | Compétence 1                        |
| Espace / Maj      | Compétences 2 et 3                  |
| Clic molette      | Mêlée rapide (sauf Torsten et Elio)  |
| R                 | Recharger                           |
| H                 | Aide                                |
| X                 | Afficher les hitbox                 |
| B / T             | Tourelles on/off · reset des stats (champ de tir) |
| C                 | Changer de héros (Contrôle, dans ton spawn) |
| Échap             | Champ de tir : sélection du héros · autres modes : quitter la partie |

Dans les menus : touches 1, 2, 3… pour choisir, Entrée pour valider, Échap pour revenir (sélection du héros :
les touches sélectionnent, Entrée lance).


### Sur téléphone (commandes tactiles)

Le jeu se joue à deux pouces, en paysage (un message demande de tourner le téléphone en portrait).
Le mode tactile s'active au premier toucher et se coupe dès qu'on touche la souris ou le clavier
(`src/core/Touch.ts`, dessin dans `src/ui/touchHud.ts`).

- **Pouce gauche** : stick de déplacement flottant, il apparaît là où le pouce se pose (moitié gauche).
- **Pouce droit** : stick de tir en bas à droite. Poussé, le héros vise dans cette direction et tire
  en continu ; une aide à la visée se cale sur l'ennemi le plus proche de la direction poussée.
  Les munitions s'affichent au centre du stick, le rechargement en anneau autour.
- **Compétences** : boutons en arc autour du stick de tir (icône, recharge, charges). Trois façons de
  les utiliser, réglées par héros (`touch` dans `src/heroes/registry.ts`) :
  - appui simple = lancer sur la cible automatique (ennemi le plus proche ; allié pour l'Envol de
    Camellia ; elle-même pour son Sanctuaire ; allié blessé sinon ennemi pour ses petits anges) ;
    glisser depuis le bouton = viser à la main (portée en pointillés, point visé), relâcher = lancer ;
  - maintenu : mur de foudre de Torsten (glisser l'oriente), forme tortue de Kora ;
  - immédiat : compétences qui choisissent seules (trick et aura d'Elio, Frappe fantôme dans le sens
    du déplacement et Permutation de Flux).
- **Petits boutons** : mêlée rapide (👊), rechargement. En haut à gauche : quitter (✕) et, dans le
  spawn en Partie rapide, changer de héros (⇄). Les PV passent en haut à gauche.
- Sans visée récente, le héros regarde là où il va. Plein écran au premier toucher si le navigateur
  le permet ; menus compacts sur les écrans peu hauts.
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
  entities/        bots du champ de tir, projectiles, interface Combatant
  world/           cartes (maps.ts), arène, ligne de vue, brouillard, thèmes pixel art (themes/)
  ui/              HUD, HUD du Deathmatch, écrans HTML (menus, sélection, scores, parties privées)
  network/         jeu en ligne : connexion (NetworkManager), partie en ligne (NetMatch), état réseau (netState)
server/
  src/server.ts    Express + Socket.io (CORS, événements)
  src/rooms/       salons privés en mémoire (codes, hôte, prêts)
  src/game/        simulation autoritaire (GameLoop) et commandes réseau
  src/types/       protocole réseau partagé avec le client
docs/
  multijoueur.md   architecture et marche à suivre du multijoueur
```
