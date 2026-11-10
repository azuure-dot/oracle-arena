# Multijoueur : parties privées en temps réel

Ce document décrit le passage du Hero Shooter d'un jeu solo contre des bots à un jeu **en ligne en
parties privées** : on crée un salon, on partage son code de 6 caractères, les amis le rejoignent, et
la partie se joue sur un **serveur autoritaire**. Pas de compte utilisateur : un pseudo suffit.

- [État actuel](#état-actuel)
- [Marche à suivre pas à pas](#marche-à-suivre-pas-à-pas)
- [Architecture](#architecture)
- [Réutilisation de la logique de jeu](#réutilisation-de-la-logique-de-jeu-côté-serveur)
- [Protocole réseau](#protocole-réseau)
- [Côté client : prédiction, interpolation, réconciliation](#côté-client--prédiction-interpolation-réconciliation)
- [Hébergement](#hébergement)
- [Ce qui reste à faire](#ce-qui-reste-à-faire)

## État actuel

Première version jouable, testée de bout en bout en local avec deux onglets :

| Fonction                                                                          | État                     |
| --------------------------------------------------------------------------------- | ------------------------ |
| Créer un salon, code unique de 6 caractères, rejoindre par le code                | ✅                       |
| 6 joueurs max, départ d'un joueur, migration de l'hôte, fermeture du salon vide   | ✅                       |
| Lobby : mode, carte, durée, « Remplir avec des bots » (hôte), héros, Prêt / Pas prêt | ✅                    |
| « Lancer la partie » réservé à l'hôte, actif quand tous les vrais joueurs sont prêts | ✅                    |
| **Deathmatch FFA en ligne** : déplacements, tirs, rechargements, **toutes les compétences des 5 héros**, bots IA | ✅ |
| Prédiction du joueur local + réconciliation, interpolation des autres             | ✅                       |
| Fin de partie : classement du serveur, retour au salon                            | ✅                       |
| Champ de tir, Contrôle, Escorte en ligne                                          | ⏳ affichés « Bientôt »  |
| Le jeu solo                                                                       | ✅ inchangé              |

> **Héros.** La demande initiale citait Zack, Shelly, Tonnerre et Céleste : ces héros n'existent pas
> dans le jeu. Le salon propose les vrais héros du registre (`src/heroes/registry.ts`) : **Torsten**
> (tank), **Flux** et **Kora** (dégâts), **Elio** et **Camellia** (soutien).

## Marche à suivre pas à pas

### 1. Lancer en local (deux terminaux)

```bash
# Terminal 1 — le serveur de jeu (port 3001)
cd server
npm install
cp .env.example .env        # PORT=3001, CLIENT_URL=http://localhost:5173
npm run dev                 # ts-node-dev : redémarre à chaque modification
```

```bash
# Terminal 2 — le client (port 5173)
npm install
cp .env.example .env.local  # VITE_SERVER_URL=http://localhost:3001 (valeur par défaut de toute façon)
npm run dev
```

Vérifier le serveur : http://localhost:3001/health répond `{"ok":true,"rooms":0,...}`.

### 2. Jouer à deux sur la même machine

1. Onglet A : menu principal → **Partie privée** → pseudo → **Créer le salon**. Le code s'affiche
   (bouton **Copier**).
2. Onglet B : **Partie privée** → saisir le code (majuscules ou minuscules) → **Rejoindre**.
3. Chacun choisit son héros et clique **Je suis prêt**.
4. Dans A (l'hôte) : régler mode / carte / durée / bots, puis **Lancer la partie**.
5. À la fin du chrono : tableau des scores → **Retour au salon** (chacun se remet prêt pour rejouer).

Sur le réseau local (un ami sur le même Wi-Fi) : lancer le client avec `npx vite --host`, mettre
l'adresse IP de la machine dans `VITE_SERVER_URL` (ex. `http://192.168.1.20:3001`) et dans
`CLIENT_URL` côté serveur (ex. `http://192.168.1.20:5173`).

### 3. Vérifier les builds

```bash
npm run build            # client : tsc + vite build → dist/
npm run build --prefix server   # serveur : tsc → server/dist/
npm start --prefix server       # serveur compilé (production)
```

### 4. Mettre en ligne

Voir [Hébergement](#hébergement) : serveur sur Railway / Render / Fly.io, puis `VITE_SERVER_URL`
pointé vers lui au build du client.

## Architecture

```
 Navigateur (Vite + TS + Canvas)                      Serveur Node (Express + Socket.io)
┌──────────────────────────────────┐                ┌───────────────────────────────────────┐
│ Game.ts (scènes, boucle rAF)     │                │ server.ts      HTTP /health, CORS,    │
│  ├─ PrivateHub   créer/rejoindre │   WebSocket    │                événements Socket.io   │
│  ├─ PrivateLobby salon           │◀══════════════▶│ rooms/RoomManager.ts                  │
│  └─ NetMatch     partie en ligne │  Socket.io     │   Map<code, Room>, hôte, prêts        │
│      prédiction / interpolation  │                │ game/GameLoop.ts                      │
│ network/NetworkManager.ts        │  PLAYER_INPUT ▶│   World + héros (60 Hz), IA des bots  │
│ network/netState.ts (décodage)   │ ◀ GAME_TICK    │   instantanés 30 Hz (netState.ts)     │
└──────────────────────────────────┘                └───────────────────────────────────────┘
              │                                                        │
              └─────────── code partagé : src/game, src/heroes, src/ai, src/world,
                           src/modes/rules.ts, src/network/netState.ts,
                           server/src/types/network.ts (protocole) ──────┘
```

### Fichiers

| Fichier                              | Rôle                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `server/src/server.ts`               | Express (`/health`) + Socket.io, CORS limité à `CLIENT_URL`, limiteurs de débit        |
| `server/src/rooms/RoomManager.ts`    | Salons en mémoire, codes uniques, 6 joueurs, hôte et migration, réglages, lancement    |
| `server/src/game/GameLoop.ts`        | Simulation autoritaire (pas fixe 60 Hz) et instantanés (30 Hz)                         |
| `server/src/game/NetControls.ts`     | Commandes d'un héros piloté à distance, validation des messages                        |
| `server/src/types/network.ts`        | **Protocole partagé** : événements, types des messages, modes, constantes              |
| `src/network/NetworkManager.ts`      | Connexion Socket.io (chargée à la demande), demandes avec accusé, écoute des événements |
| `src/network/NetMatch.ts`            | Partie en ligne côté client (hérite du Deathmatch solo pour le HUD et les scores)      |
| `src/network/netState.ts`            | Sérialisation générique de l'état des entités (encodage serveur, décodage client)      |
| `src/ui/screens/PrivateHub.ts`       | Écran « Créer une partie privée / Rejoindre une partie »                               |
| `src/ui/screens/PrivateLobby.ts`     | Salon privé                                                                            |
| `src/modes/rules.ts`                 | Règles pures du Deathmatch (spawns, classement...), partagées solo / serveur           |

### Serveur autoritaire

Le client n'envoie **que ses commandes** (direction, point visé, boutons) ; il ne dit jamais « j'ai
touché X ». Le serveur simule tout (dégâts, morts, munitions, chrono, score) et diffuse le résultat.
Un client modifié peut au pire mal afficher, pas tricher sur les dégâts.

Boucle (`GameLoop.run`) : un `setInterval` à 60 Hz avance la simulation par pas fixes de 1/60 s
(rattrapage limité si le serveur prend du retard) ; un pas sur deux, un instantané part vers tous les
joueurs du salon (30 Hz).

### Salons (`RoomManager`)

- `Map<string, Room>` en mémoire : rien sur disque, un redémarrage vide les salons.
- Code de 6 caractères tirés avec `crypto.randomInt` dans `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (sans 0/O ni 1/I, faciles à dicter), unicité vérifiée.
- 6 joueurs max ; on ne rejoint pas un salon en partie.
- Départ ou déconnexion : le joueur est retiré (son héros quitte la partie, ses points restent au
  classement). Si c'était l'hôte, l'hôte passe au joueur arrivé le plus tôt ; s'il n'y a plus
  personne, le salon ferme.
- « Remplir avec des bots » : au lancement, les places libres (jusqu'à 6) reçoivent des bots héros
  tirés au hasard, pilotés par l'IA du jeu solo, côté serveur.

## Réutilisation de la logique de jeu côté serveur

Le serveur **n'a pas réécrit** la simulation : il importe directement `src/game/World.ts`,
`src/heroes/*`, `src/ai/*`, `src/world/Arena.ts` et les cartes. C'était possible parce que ces modules
dépendaient déjà très peu du DOM : les héros lisent des « commandes » abstraites (`HeroControls`), et
tout le dessin est dans des méthodes `draw*()` qui ne sont jamais appelées sur le serveur. Les
canvas de cache (`render/topdown.ts`, `Arena`, `Fog`) ne sont créés qu'au premier dessin.

Ce qu'il a fallu séparer :

1. **`src/i18n.ts`** touchait `document` au chargement du module → protégé par
   `typeof document !== 'undefined'`.
2. **`World`** recevait la `Camera` (pour les tremblements d'écran) → il reçoit maintenant une
   interface `ShakeTarget { shake() }` ; le serveur passe un objet vide. Nouveau crochet
   `onShake` (le serveur retransmet les tremblements) et nouvelle méthode `updateDisplay(dt)` (le
   client en ligne fait vivre l'affichage sans simuler).
3. **Règles pures** sorties des modes vers **`src/modes/rules.ts`** : points d'apparition et
   placement du Deathmatch, choix du point de réapparition, classement, noms et multiplicateur de
   dégâts des bots, compte à rebours. `DeathmatchMode` / `MatchMode` les importent (et les
   ré-exportent : rien ne change pour le reste du code). Les classes `GameMode` restent côté client :
   elles dépendent du clavier, de la caméra et du HUD.
4. **`GameMode.update`** découpé en `handleMetaKeys()` + `sampleControls()` : la partie en ligne
   réutilise la lecture du clavier, de la souris et des commandes tactiles.
5. **`Hero.predictMove()`** : rejoue seulement le déplacement (marche, recul, murs) pour la
   prédiction du client, avec le même code que la simulation.
6. Les commandes réseau (`NetControls`) implémentent `HeroControls`, comme le clavier
   (`PlayerControls`) et l'IA (`BotControls`) : le code des héros est le même pour les trois.

Le serveur compile ce code partagé avec son propre `tsconfig.json` (CommonJS, `rootDir: ".."`) :
`server/dist/server/src/server.js` et `server/dist/src/...`.

## Protocole réseau

Tout est dans `server/src/types/network.ts` (importé tel quel par le client).

| Événement         | Sens              | Contenu                                                              |
| ----------------- | ----------------- | -------------------------------------------------------------------- |
| `CREATE_ROOM`     | client → serveur  | `{ name, heroId }` → accusé `{ you, room }`                          |
| `JOIN_ROOM`       | client → serveur  | `{ code, name, heroId }` → accusé `{ you, room }` ou erreur          |
| `LEAVE_ROOM`      | client → serveur  | —                                                                    |
| `UPDATE_SETTINGS` | client → serveur  | `{ mode?, mapId?, minutes?, fillBots? }` (hôte seulement)            |
| `SELECT_HERO`     | client → serveur  | `heroId`                                                             |
| `SET_READY`       | client → serveur  | `true` / `false`                                                     |
| `START_GAME`      | client → serveur  | — (hôte, tous prêts, mode disponible en ligne, ≥ 2 participants)     |
| `PLAYER_INPUT`    | client → serveur  | `{ seq, dt, mx, my, ax, ay, held, pressed }` à chaque image          |
| `ROOM_UPDATED`    | serveur → salon   | état complet du salon                                                |
| `ROOM_CLOSED`     | serveur → salon   | —                                                                    |
| `GAME_STARTED`    | serveur → salon   | mode, carte, participants (joueurs et bots), fréquence               |
| `GAME_TICK`       | serveur → salon   | instantané (30 Hz)                                                   |
| `GAME_OVER`       | serveur → salon   | scores finaux                                                        |

Les demandes renvoient `{ ok: true, data }` ou `{ ok: false, error }` avec un code
(`not_found`, `full`, `in_game`, `not_host`, `not_ready`, `mode_unavailable`, `too_few`...), traduit
côté client (`net.err.*` dans `src/i18n.ts`).

### Contenu d'un instantané (`GAME_TICK`)

- `t` (horloge serveur, pour l'interpolation), `wt` (temps du monde), `acks` (dernière commande
  traitée par joueur) ;
- `heroes` : pour chaque participant, `p: [x, y, visée]` à chaque fois, et `s` = **seulement les
  champs qui ont changé** depuis l'instantané précédent ;
- `objects` : projectiles, marteau de Torsten, bombes de Kora, anges et sanctuaire de Camellia,
  clones de Flux — même principe (`k` = type au premier envoi) ;
- `fx` : appels d'effets visuels enregistrés sur le serveur (étincelles, anneaux, éclairs...),
  rejoués par chaque client ; `wet` : flaques posées ; `shakes` : tremblements ; `hits` : dégâts
  (fil des éliminations, marqueur de touche, chiffres de dégâts) ;
- `match` : compte à rebours, temps restant, éliminations / morts.

**Sérialisation générique** (`src/network/netState.ts`) : plutôt qu'un paquet écrit à la main pour
chaque héros, le serveur encode automatiquement les champs propres des objets du jeu (nombres arrondis
au centième, textes, booléens, tableaux et objets simples, chargeurs). Une référence vers un héros
devient `{ $h: id }`, vers un objet du monde `{ $o: id }` ; le client les remplace par ses propres
instances. Le client crée les objets avec `Object.create(prototype)` et leur applique ces champs : le
**code de dessin existant marche tel quel**, pour toutes les compétences. Seules les différences
champ par champ sont envoyées (Socket.io garantit l'ordre et la livraison).

Mesuré en local (2 joueurs + 4 bots) : ~1,9 Ko par instantané en moyenne (4 Ko au plus fort), soit
~55 Ko/s par joueur avant compression ; `perMessageDeflate` est activé au-delà de 1 Ko.

## Côté client : prédiction, interpolation, réconciliation

`src/network/NetMatch.ts` hérite de `DeathmatchMode` : HUD, fil des éliminations, classement et
tableau des scores sont ceux du solo ; seules les données viennent du serveur.

1. **Interpolation** des autres joueurs et des objets : le client estime l'horloge du serveur (en
   retenant l'instantané arrivé le moins retardé, pour ne pas trembler avec la gigue) et affiche le
   monde avec un petit retard sur elle : 75 ms au moins, jusqu'à 250 ms si le réseau est
   irrégulier (3 × la gigue mesurée). Il glisse entre les deux instantanés qui encadrent cet
   instant, au rythme exact de l'horloge locale.
2. **Prédiction** du joueur local : chaque image, `Hero.predictMove()` le déplace tout de suite avec
   la commande qui part au serveur. La visée est locale aussi.
3. **Réconciliation** : à chaque instantané, le héros local repart de l'état calculé par le serveur
   pour la dernière commande traitée (`acks`), puis les commandes envoyées depuis sont rejouées.

Pour que la réconciliation ne corrige rien en temps normal, le serveur applique la **marche de
chaque commande dès sa réception, avec la durée de l'image du client** (`input.dt`, même fonction
`Hero.predictMove()`), au lieu de la faire avancer à son propre rythme de 60 Hz :

- le héros d'un joueur a `externalMovement = true` : `Hero.update()` ne le fait plus marcher ;
- un **budget de temps** (`NetControls`) empêche un client trafiqué d'annoncer des images plus
  longues que le temps réel (accélération) ; au-delà de 0,25 s d'avance, la durée en trop est ignorée ;
- un joueur **muet** depuis 0,2 s (onglet en arrière-plan, coupure) garde une physique vivante
  (recul, freinage) côté serveur ;
- position, visée, vitesse et recul (`HeroTick.p`) partent **en entier à chaque instantané** : la
  prédiction les modifie elle-même, un envoi « seulement si changé » la ferait repartir de ses
  propres valeurs.

Un vrai écart (recul, ruée, étourdissement décidés par le serveur) n'est pas appliqué d'un coup :
il est **absorbé en quelques images** (~90 % en 0,15 s) pour ne pas faire sauter la caméra, qui
suit le héros. Au-delà de 64 px (réapparition, téléportation), on saute directement.

**Ses propres actions au présent.** Les autres joueurs sont affichés avec le retard
d'interpolation, mais ce que le joueur local déclenche ne l'est pas :

- le serveur note **qui agit** à chaque instant de la simulation (`WorldHooks.onActor` : le héros
  mis à jour, le lanceur du projectile ou de l'objet) et attribue chaque effet visuel et chaque
  tremblement à son auteur (`FxCall = [auteur, méthode, ...]`) ;
- le client joue tout de suite les effets, tremblements et dégâts dont il est l'auteur, et affiche
  ses projectiles et objets (`owner` = lui) dès réception, prolongés jusqu'à l'instant présent
  (position + vitesse × temps écoulé) au lieu d'attendre l'instant affiché.

Mesuré avec 100 ms d'aller-retour simulé : le tir apparaît ~150 ms après le clic, contre ~260 ms
avant. Le reste, c'est l'aller-retour lui-même : les tirs ne partent qu'une fois validés par le
serveur (pas de prédiction des tirs, voir « Ce qui reste à faire »).

L'aller-retour dépend de la **région du serveur** (choisir la plus proche des joueurs, Railway :
Settings → Region) et de la **connexion des joueurs** : le Wi-Fi ou une box 4G/5G peuvent ajouter
50 ms et plus, avec beaucoup de gigue ; un câble Ethernet aide beaucoup.

### Tester avec un réseau lent

En développement, ajouter `?lag=100&jitter=30` à l'adresse du client (ex.
http://localhost:5173/?lag=100&jitter=30) : ~100 ms d'aller-retour et jusqu'à 30 ms de gigue
sont ajoutés aux messages de partie, dans l'ordre (comme TCP). Mesures dans la console :
`__game.mode.netStats` (écart corrigé à chaque instantané, images où les autres joueurs se figent
faute d'instantané).

Mesures après ces réglages (1 joueur + bots, 150 ms d'aller-retour, 60 ms de gigue simulés) :
aucune correction du joueur local en marchant, à-coup image par image < 0,5 px, aucune image
sans instantané pour les autres joueurs.

## Hébergement

Deux morceaux, hébergés séparément :

### Le client : site statique

Il est **déjà publié sur GitHub Pages** à chaque push sur `main`
(`.github/workflows/deploy.yml`). Pour qu'il parle au serveur en ligne :

- GitHub → Settings → Secrets and variables → Actions → **Variables** → `VITE_SERVER_URL` =
  l'URL publique du serveur (ex. `https://hero-shooter.up.railway.app`). Le workflow la passe au
  build (Vite l'inscrit dans le code : un changement demande un nouveau déploiement).

Alternatives équivalentes (même build, `npm run build` → `dist/`) : **Vercel** ou **Netlify**, en
ajoutant `VITE_SERVER_URL` dans les variables d'environnement du projet. Avantage : aperçus par
branche. Rien à changer dans le code.

### Le serveur : un processus permanent

Le serveur garde une connexion WebSocket ouverte avec chaque joueur pendant toute la partie et fait
tourner une boucle à 60 Hz : il lui faut un **processus Node qui reste allumé**. Les fonctions
« serverless » (Vercel Functions, Netlify Functions, Cloudflare Workers...) **ne conviennent pas** :
elles s'arrêtent après chaque requête et ne gardent pas d'état en mémoire.

Le serveur importe la logique du client (`../src`) : on déploie donc **le dépôt entier**, avec
ces commandes :

| Réglage     | Valeur                                                        |
| ----------- | ------------------------------------------------------------- |
| Build       | `npm ci --prefix server --include=dev && npm run build --prefix server` (`--include=dev` : TypeScript reste installé même si l'hébergeur passe `NODE_ENV=production`) |
| Démarrage   | `npm start --prefix server`                                   |
| Variables   | `CLIENT_URL=https://azuure-dot.github.io` (origine, sans chemin ; plusieurs : séparées par des virgules). `PORT` est fourni par l'hébergeur. |
| Santé       | `GET /health`                                                 |

- **Railway** (simple, recommandé pour commencer) : New Project → Deploy from GitHub repo → renseigner
  Build / Start ci-dessus et `CLIENT_URL` → Settings → Networking → Generate Domain. Garder le
  « Root Directory » vide (le serveur a besoin de `src/`). Réglages dans le tableau de bord : le
  fichier `railway.json` est abandonné par Railway pour les nouveaux services.
- **Render** : New → Web Service → même dépôt, mêmes commandes. L'offre gratuite s'endort après
  15 min sans trafic (premier salon lent à créer) ; WebSockets pris en charge.
- **Fly.io** : `fly launch` avec un Dockerfile à la racine (Node 22, `npm ci --prefix server`,
  `npm run build --prefix server`, `CMD ["npm","start","--prefix","server"]`) ; machines proches des
  joueurs (région `cdg` pour Paris).

Choisir une région proche des joueurs : la latence compte plus que la puissance.

### Redis / Upstash : plus tard seulement

Un seul processus Node suffit largement pour des parties privées (chaque partie : 6 héros, quelques
dizaines de projectiles). Redis (ou Upstash, Redis hébergé) ne servira que pour **plusieurs
instances** du serveur :

- un annuaire partagé `code du salon → instance` pour envoyer chaque joueur au bon serveur ;
- l'adaptateur Redis de Socket.io (`@socket.io/redis-adapter`) si des messages doivent traverser
  les instances, avec des sessions « collantes » au niveau du répartiteur.

Une partie, elle, reste toujours sur **un seul** processus (sa simulation est en mémoire).

## Ce qui reste à faire

Par ordre de priorité suggéré :

1. **Contrôle et Escorte en ligne** : règles d'équipe (`TeamMatchMode`, `ControlMode`, `EscortMode`)
   encore mêlées au HUD et au clavier → extraire leurs règles pures comme pour le Deathmatch
   (`rules.ts`), synchroniser le point / le convoi, choix des équipes dans le salon, changement de
   héros dans le spawn.
2. **Champ de tir en ligne** : les robots et tourelles du champ de tir (`entities/Bot.ts`) visent
   « le joueur » unique ; il faut les adapter à plusieurs joueurs.
3. **Reconnexion** : un joueur qui perd la connexion quitte le salon. À ajouter : un jeton de
   session (localStorage) pour reprendre sa place quelques secondes.
4. **Rejoindre en cours de partie** (spectateur, puis place libérée par un bot).
5. **Prédiction des tirs** (projectile créé dès le clic côté tireur, sans attendre le serveur ;
   aujourd'hui il est affiché dès sa réception, voir plus haut) et **compensation de
   latence** pour les armes rapides.
6. **Brouillard côté serveur** : aujourd'hui tout l'état est envoyé à chacun et le client cache ce
   que son héros ne voit pas ; un client modifié pourrait tout voir. Filtrer par ligne de vue sur
   le serveur.
7. Textes des effets (`Effects.text`) traduits côté client (aujourd'hui en français, langue du
   serveur).
8. **Bande passante** : instantanés binaires (ex. MessagePack) et différences par sous-champ si
   besoin (aujourd'hui JSON compressé, suffisant pour 6 joueurs).
9. Tests automatisés du serveur (salons, migration de l'hôte, validation des commandes).
10. Mode Classé (comptes, classement) : hors du périmètre « sans comptes » actuel.
