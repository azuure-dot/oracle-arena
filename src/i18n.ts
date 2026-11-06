/**
 * Localisation FR / EN — dictionnaire simple.
 * - `t('clé', { param })` renvoie le texte dans la langue courante ({param} est remplacé).
 * - Les clés sont typées à partir du dictionnaire FR : une clé manquante en EN = erreur de compilation.
 * - La langue choisie est mémorisée dans le navigateur (localStorage).
 */

const fr = {
  // Écran de sélection
  'select.title': 'Champ de tir',
  'select.subtitle': 'Choisis ton héros · clic ou touches',
  'select.footer': 'En jeu : {key} pour revenir ici',
  'select.language': 'Langue',
  'role.tank': 'Tank',
  'role.damage': 'Dégâts',
  'role.support': 'Soutien',
  'unit.hp': 'PV',

  // Touches
  'key.primary': 'Clic G',
  'key.secondary': 'Clic D',
  'key.ability1': 'Espace',
  'key.ability2': 'Maj',
  'key.escape': 'Échap',
  'key.melee': 'Molette',
  'key.enter': 'Entrée',

  // Mêlée rapide (tous les héros sauf Rempart)
  'melee.name': 'Mêlée rapide',
  'melee.desc': 'Coup au contact, 40 dégâts · 1 s',

  // Flux
  'flux.tagline': 'Duelliste ultra-mobile. Petite hurtbox, gros harcèlement.',
  'flux.weapon': 'Blasters jumeaux',
  'flux.weapon.desc': '20 balles/s, 40 munitions',
  'flux.blink': 'Transfert',
  'flux.blink.desc': 'Téléportation courte · 3 charges (3 s chacune)',
  'flux.recall': 'Rappel',
  'flux.recall.desc': 'Retour 3 s en arrière (position + PV) · 12 s',

  // Rempart
  'rempart.tagline': 'Mur vivant : protège son équipe et écrase la ligne adverse.',
  'rempart.weapon': 'Marteau',
  'rempart.weapon.desc': 'Large arc de mêlée, 75 dégâts',
  'rempart.shield': 'Bouclier',
  'rempart.shield.desc': 'Maintenu · 1200 PV · bloque les tirs ennemis',
  'rempart.fire': 'Onde de feu',
  'rempart.fire.desc': 'Projectile perforant, 100 dégâts · 8 s',
  'rempart.charge': 'Charge',
  'rempart.charge.desc': 'Préparation 0,6 s · épingle un ennemi · mur : 250 dégâts + étourdi 2 s · 7 s',

  // Tempo
  'tempo.tagline': 'Support mobile : son aura soigne ou accélère toute l’équipe.',
  'tempo.weapon': 'Canon sonique',
  'tempo.weapon.desc': 'Rafale de 4 projectiles lents',
  'tempo.boop': 'Onde de choc',
  'tempo.boop.desc': 'Cône court, fort recul · 4 s',
  'tempo.aura': 'Aura',
  'tempo.swap': 'Changement d’aura',
  'tempo.swap.desc': 'Soin (jaune) ⇄ Vitesse (vert)',
  'tempo.amp': 'Surrégime',
  'tempo.amp.desc': 'Aura renforcée pendant 3 s · 12 s',
  'aura.heal': 'SOIN',
  'aura.speed': 'VITESSE',

  // HUD
  'hud.dps': 'DPS (3 s)',
  'hud.damage': 'DÉGÂTS',
  'hud.kills': 'ÉLIMINATIONS',
  'hud.turrets': 'TOURELLES',
  'hud.fps': 'FPS',
  'hud.on': 'ON',
  'hud.off': 'OFF',
  'hud.reloading': 'RECHARGEMENT',
  'hud.melee': 'MÊLÉE',
  'hud.respawn': 'Réapparition… {s}',
  'hud.shieldHp': '{hp} PV',
  'hud.stunned': 'ÉTOURDI',

  // Aide
  'help.title': '{hero} — CHAMP DE TIR',
  'help.move': 'ZQSD / WASD : se déplacer · Souris : viser',
  'help.line': '{key} : {name}',
  'help.misc1': 'R : recharger · B : tourelles on/off',
  'help.misc2': 'T : reset stats · H : aide · Échap : héros',
  'help.hitbox': 'X : afficher les hitbox',

  // Monde
  'tag.ally': 'ALLIÉ',
  'tag.wounded': 'ALLIÉ BLESSÉ',
  'tag.turret': 'TOURELLE',
  'zone.hazard': 'DÉGÂTS  {n} PV/s',
  'zone.heal': 'SOIN  {n} PV/s',

  // Menu principal
  'menu.title': 'Hero Shooter',
  'menu.subtitle': 'Prototype 2D · choisis un mode de jeu',
  'menu.practice': 'Champ de tir',
  'menu.practice.desc': 'Cibles, tourelles et alliés pour t’entraîner sans pression.',
  'menu.deathmatch': 'Deathmatch',
  'menu.deathmatch.desc': 'Chacun pour soi contre des bots qui jouent les héros.',
  'ui.back': 'Retour',
  'ui.next': 'Suivant',
  'ui.mainMenu': 'Menu principal',
  'ui.replay': 'Rejouer',

  // Configuration du Deathmatch
  'dm.subtitle': 'Chacun pour soi · chaque élimination rapporte 1 point',
  'dm.bots': 'Nombre de bots',
  'dm.duration': 'Durée du match',
  'dm.minutes': '{n} min',
  'dm.summary': '{bots} bots aux héros tirés au hasard · {min} min',
  'select.title.dm': 'Deathmatch',
  'select.footer.dm': 'En jeu : {key} pour quitter la partie',

  // HUD du Deathmatch
  'hud.dm.kills': 'ÉLIMINATIONS',
  'hud.dm.position': 'POSITION',
  'hud.dm.killedBy': 'Éliminé par {name}',
  'hud.dm.elimination': 'ÉLIMINATION',
  'help.title.dm': '{hero} — DEATHMATCH',
  'help.dm.misc': 'H : aide · Échap : quitter la partie',

  // Tableau des scores
  'score.title': 'Fin du match',
  'score.victory': 'Victoire !',
  'score.place': 'Tu termines {rank} sur {n}',
  'score.player': 'Joueur',
  'score.hero': 'Héros',
  'score.kills': 'Éliminations',
  'score.deaths': 'Morts',
  'score.you': 'Toi',

  // Partie rapide (Quickplay) et cartes
  'menu.quickplay': 'Partie rapide',
  'menu.quickplay.desc': '2 contre 2 sur une carte à objectif, en 2 manches gagnantes.',
  'map.title': 'Choisis une carte',
  'map.subtitle': 'La carte détermine le mode de jeu',
  'map.sanctuary': 'Sanctuaire',
  'map.sanctuary.desc': 'Prends le point central et tiens-le : la première équipe à 100 % remporte la manche.',
  'mode.control': 'Contrôle',
  'mode.teams': '2 contre 2 · 2 manches gagnantes',
  'select.title.control': '{map} · Contrôle',
  'select.swap': 'Changer de héros',
  'select.taken': 'Déjà pris par ton allié',
  'select.swap.footer': '{key} pour fermer · ton allié garde son héros',

  // Mode Contrôle
  'control.neutral': 'NEUTRE',
  'control.blue': 'BLEU',
  'control.red': 'ROUGE',
  'control.contested': 'CONTESTÉ',
  'control.capturing': 'CAPTURE {p} %',
  'control.overtime': 'PROLONGATIONS',
  'control.round': 'MANCHE {n}',
  'control.roundWinBlue': 'L’équipe bleue remporte la manche',
  'control.roundWinRed': 'L’équipe rouge remporte la manche',
  'control.nextRound': 'Manche suivante dans {s}',
  'control.victory': 'VICTOIRE',
  'control.defeat': 'DÉFAITE',
  'control.objective': 'OBJECTIF',
  'control.capturedBlue': 'Point capturé par l’équipe bleue',
  'control.capturedRed': 'Point capturé par l’équipe rouge',
  'control.swapHint': 'C : changer de héros',
  'help.title.control': '{hero} — CONTRÔLE',
  'help.control.misc': 'C (au spawn) : changer de héros',
  'help.control.misc2': 'H : aide · Échap : quitter la partie',
  'score.rounds': 'Manches {a} – {b}',
  'score.teamBlue': 'Équipe bleue',
  'score.teamRed': 'Équipe rouge',

  // Escorte
  'map.route66': 'Route 66',
  'map.route66.desc': 'Une équipe escorte le convoi jusqu’au bout du parcours, l’autre doit l’arrêter avant la fin du temps.',
  'mode.escort': 'Escorte',
  'mode.teams.escort': '2 contre 2 · attaque / défense',
  'select.title.map': '{map} · {mode}',
  'escort.attack': 'ATTAQUE',
  'escort.defense': 'DÉFENSE',
  'escort.goalAttack': 'Escortez le convoi',
  'escort.goalDefense': 'Arrêtez le convoi',
  'escort.pushing': 'POUSSÉE',
  'escort.contested': 'CONTESTÉ',
  'escort.stopped': 'ARRÊTÉ',
  'escort.reversing': 'RECUL',
  'escort.overtime': 'PROLONGATIONS',
  'escort.checkpoint': 'Checkpoint atteint · +3:00',
  'escort.phase': 'PHASE {n}/2',
  'escort.delivered': 'Le convoi est arrivé à destination',
  'escort.held': 'Convoi arrêté à {p} % du parcours',
  'escort.youAttack': 'Tu étais en attaque',
  'escort.youDefend': 'Tu étais en défense',
  'help.title.escort': '{hero} — ESCORTE',

  // Compte à rebours de départ
  'start.countdown': 'La partie commence dans',
  'start.doors': 'Les portes s’ouvrent dans',
  'start.takePositions': 'Prenez position · l’attaque sort dans',
};

export type TKey = keyof typeof fr;

const en: Record<TKey, string> = {
  'select.title': 'Practice Range',
  'select.subtitle': 'Pick your hero · click or press',
  'select.footer': 'In game: {key} to come back here',
  'select.language': 'Language',
  'role.tank': 'Tank',
  'role.damage': 'Damage',
  'role.support': 'Support',
  'unit.hp': 'HP',

  'key.primary': 'LMB',
  'key.secondary': 'RMB',
  'key.ability1': 'Space',
  'key.ability2': 'Shift',
  'key.escape': 'Esc',
  'key.melee': 'MMB',
  'key.enter': 'Enter',

  'melee.name': 'Quick melee',
  'melee.desc': 'Point-blank hit, 40 damage · 1 s',

  'flux.tagline': 'Hyper-mobile duelist. Tiny hurtbox, relentless harassment.',
  'flux.weapon': 'Twin Blasters',
  'flux.weapon.desc': '20 shots/s, 40 rounds',
  'flux.blink': 'Blink',
  'flux.blink.desc': 'Short teleport · 3 charges (3 s each)',
  'flux.recall': 'Recall',
  'flux.recall.desc': 'Rewind 3 s (position + HP) · 12 s',

  'rempart.tagline': 'A walking wall: shields the team and crushes the enemy line.',
  'rempart.weapon': 'Hammer',
  'rempart.weapon.desc': 'Wide melee arc, 75 damage',
  'rempart.shield': 'Barrier',
  'rempart.shield.desc': 'Hold · 1200 HP · blocks enemy fire',
  'rempart.fire': 'Fire Wave',
  'rempart.fire.desc': 'Piercing projectile, 100 damage · 8 s',
  'rempart.charge': 'Charge',
  'rempart.charge.desc': '0.6 s wind-up · pins an enemy · wall: 250 damage + 2 s stun · 7 s',

  'tempo.tagline': 'Mobile support: the aura heals or speeds up the whole team.',
  'tempo.weapon': 'Sonic Cannon',
  'tempo.weapon.desc': 'Burst of 4 slow projectiles',
  'tempo.boop': 'Shockwave',
  'tempo.boop.desc': 'Short cone, strong knockback · 4 s',
  'tempo.aura': 'Aura',
  'tempo.swap': 'Aura Swap',
  'tempo.swap.desc': 'Heal (yellow) ⇄ Speed (green)',
  'tempo.amp': 'Overdrive',
  'tempo.amp.desc': 'Boosted aura for 3 s · 12 s',
  'aura.heal': 'HEAL',
  'aura.speed': 'SPEED',

  'hud.dps': 'DPS (3 s)',
  'hud.damage': 'DAMAGE',
  'hud.kills': 'ELIMINATIONS',
  'hud.turrets': 'TURRETS',
  'hud.fps': 'FPS',
  'hud.on': 'ON',
  'hud.off': 'OFF',
  'hud.reloading': 'RELOADING',
  'hud.melee': 'MELEE',
  'hud.respawn': 'Respawning… {s}',
  'hud.shieldHp': '{hp} HP',
  'hud.stunned': 'STUNNED',

  'help.title': '{hero} — PRACTICE RANGE',
  'help.move': 'WASD / ZQSD: move · Mouse: aim',
  'help.line': '{key}: {name}',
  'help.misc1': 'R: reload · B: toggle turrets',
  'help.misc2': 'T: reset stats · H: help · Esc: heroes',
  'help.hitbox': 'X: show hitboxes',

  'tag.ally': 'ALLY',
  'tag.wounded': 'WOUNDED ALLY',
  'tag.turret': 'TURRET',
  'zone.hazard': 'DAMAGE  {n} HP/s',
  'zone.heal': 'HEALING  {n} HP/s',

  'menu.title': 'Hero Shooter',
  'menu.subtitle': '2D prototype · pick a game mode',
  'menu.practice': 'Practice Range',
  'menu.practice.desc': 'Targets, turrets and allies to train without pressure.',
  'menu.deathmatch': 'Deathmatch',
  'menu.deathmatch.desc': 'Free-for-all against bots playing the heroes.',
  'ui.back': 'Back',
  'ui.next': 'Next',
  'ui.mainMenu': 'Main menu',
  'ui.replay': 'Play again',

  'dm.subtitle': 'Free-for-all · every elimination scores 1 point',
  'dm.bots': 'Number of bots',
  'dm.duration': 'Match length',
  'dm.minutes': '{n} min',
  'dm.summary': '{bots} bots with random heroes · {min} min',
  'select.title.dm': 'Deathmatch',
  'select.footer.dm': 'In game: {key} to leave the match',

  'hud.dm.kills': 'ELIMINATIONS',
  'hud.dm.position': 'POSITION',
  'hud.dm.killedBy': 'Eliminated by {name}',
  'hud.dm.elimination': 'ELIMINATION',
  'help.title.dm': '{hero} — DEATHMATCH',
  'help.dm.misc': 'H: help · Esc: leave the match',

  'score.title': 'Match over',
  'score.victory': 'Victory!',
  'score.place': 'You finished {rank} of {n}',
  'score.player': 'Player',
  'score.hero': 'Hero',
  'score.kills': 'Eliminations',
  'score.deaths': 'Deaths',
  'score.you': 'You',

  'menu.quickplay': 'Quick Play',
  'menu.quickplay.desc': '2v2 on an objective map, best of 3 rounds.',
  'map.title': 'Pick a map',
  'map.subtitle': 'The map sets the game mode',
  'map.sanctuary': 'Sanctuary',
  'map.sanctuary.desc': 'Take the central point and hold it: the first team to 100% wins the round.',
  'mode.control': 'Control',
  'mode.teams': '2v2 · best of 3',
  'select.title.control': '{map} · Control',
  'select.swap': 'Change hero',
  'select.taken': 'Already taken by your ally',
  'select.swap.footer': '{key} to close · your ally keeps their hero',

  'control.neutral': 'NEUTRAL',
  'control.blue': 'BLUE',
  'control.red': 'RED',
  'control.contested': 'CONTESTED',
  'control.capturing': 'CAPTURING {p}%',
  'control.overtime': 'OVERTIME',
  'control.round': 'ROUND {n}',
  'control.roundWinBlue': 'Blue team wins the round',
  'control.roundWinRed': 'Red team wins the round',
  'control.nextRound': 'Next round in {s}',
  'control.victory': 'VICTORY',
  'control.defeat': 'DEFEAT',
  'control.objective': 'OBJECTIVE',
  'control.capturedBlue': 'Point captured by the blue team',
  'control.capturedRed': 'Point captured by the red team',
  'control.swapHint': 'C: change hero',
  'help.title.control': '{hero} — CONTROL',
  'help.control.misc': 'C (in spawn): change hero',
  'help.control.misc2': 'H: help · Esc: leave the match',
  'score.rounds': 'Rounds {a} – {b}',
  'score.teamBlue': 'Blue team',
  'score.teamRed': 'Red team',

  'map.route66': 'Route 66',
  'map.route66.desc': 'One team escorts the payload to the end of the route, the other must stop it before time runs out.',
  'mode.escort': 'Escort',
  'mode.teams.escort': '2v2 · attack / defense',
  'select.title.map': '{map} · {mode}',
  'escort.attack': 'ATTACK',
  'escort.defense': 'DEFENSE',
  'escort.goalAttack': 'Escort the payload',
  'escort.goalDefense': 'Stop the payload',
  'escort.pushing': 'PUSHING',
  'escort.contested': 'CONTESTED',
  'escort.stopped': 'STOPPED',
  'escort.reversing': 'REVERSING',
  'escort.overtime': 'OVERTIME',
  'escort.checkpoint': 'Checkpoint reached · +3:00',
  'escort.phase': 'PHASE {n}/2',
  'escort.delivered': 'The payload reached its destination',
  'escort.held': 'Payload stopped at {p}% of the route',
  'escort.youAttack': 'You were attacking',
  'escort.youDefend': 'You were defending',
  'help.title.escort': '{hero} — ESCORT',

  'start.countdown': 'The match starts in',
  'start.doors': 'Doors open in',
  'start.takePositions': 'Take your positions · attack leaves in',
};

export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];

const DICTS: Record<Lang, Record<TKey, string>> = { fr, en };
const STORAGE_KEY = 'hero-shooter.lang';

let current: Lang = loadLang();
const listeners = new Set<(lang: Lang) => void>();

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* stockage indisponible : on garde la langue par défaut */
  }
  return 'fr'; // langue par défaut du projet
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignoré */
  }
  listeners.forEach((cb) => cb(lang));
}

/** S'abonner aux changements de langue (retourne une fonction de désabonnement). */
export function onLangChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

document.documentElement.lang = current;

/** Rang ordinal : 1er, 2e... / 1st, 2nd, 3rd... */
export function ordinal(n: number): string {
  if (current === 'fr') return n === 1 ? '1er' : `${n}e`;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
