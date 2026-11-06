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
  'rempart.charge.desc': 'Préparation 0,6 s · épingle un ennemi · mur : 300 dégâts · 7 s',

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

  // Aide
  'help.title': '{hero} — CHAMP DE TIR',
  'help.move': 'ZQSD / WASD : se déplacer · Souris : viser',
  'help.line': '{key} : {name}',
  'help.misc1': 'R : recharger · B : tourelles on/off',
  'help.misc2': 'T : reset stats · H : aide · Échap : héros',
  'help.gfx': 'V : graphismes (sprites / formes)',

  // Monde
  'tag.ally': 'ALLIÉ',
  'tag.wounded': 'ALLIÉ BLESSÉ',
  'tag.turret': 'TOURELLE',
  'zone.hazard': 'DÉGÂTS  {n} PV/s',
  'zone.heal': 'SOIN  {n} PV/s',
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
  'rempart.charge.desc': '0.6 s wind-up · pins an enemy · wall: 300 damage · 7 s',

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

  'help.title': '{hero} — PRACTICE RANGE',
  'help.move': 'WASD / ZQSD: move · Mouse: aim',
  'help.line': '{key}: {name}',
  'help.misc1': 'R: reload · B: toggle turrets',
  'help.misc2': 'T: reset stats · H: help · Esc: heroes',
  'help.gfx': 'V: graphics (sprites / shapes)',

  'tag.ally': 'ALLY',
  'tag.wounded': 'WOUNDED ALLY',
  'tag.turret': 'TURRET',
  'zone.hazard': 'DAMAGE  {n} HP/s',
  'zone.heal': 'HEALING  {n} HP/s',
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
