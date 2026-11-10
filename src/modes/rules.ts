import type { Vec2 } from '../core/math';
import type { Hero } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import { inVisionRange, lineOfSight } from '../world/Visibility';

/**
 * RÈGLES PURES DES MODES, sans DOM ni Canvas : partagées par le jeu solo (src/modes/*Mode.ts)
 * et par le serveur multijoueur (server/src/game/), qui importe ce fichier tel quel.
 * Rien ici ne doit dépendre de la caméra, du clavier ou du dessin.
 */

/** Compte à rebours de départ du Deathmatch (s). */
export const DEATHMATCH_COUNTDOWN = 3;

/** Les bots héros infligent 30 % de dégâts en moins que le joueur. */
export const BOT_DAMAGE_MULTIPLIER = 0.7;

export const BOT_NAMES = ['Nova', 'Vex', 'Krono', 'Echo', 'Rook', 'Zéphyr', 'Pulse', 'Onyx'];

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Points de réapparition du Deathmatch, répartis sur toute la map (hors murs et zone de dégâts). */
export const DM_SPAWNS: Vec2[] = [
  { x: 200, y: 650 },
  { x: 420, y: 420 },
  { x: 420, y: 880 },
  { x: 760, y: 110 },
  { x: 760, y: 1190 },
  { x: 1010, y: 650 },
  { x: 1300, y: 300 },
  { x: 1300, y: 1000 },
  { x: 1620, y: 650 },
  { x: 1900, y: 120 },
  { x: 1900, y: 1180 },
  { x: 1610, y: 1220 },
];

/** Placement de départ du Deathmatch : chacun le plus loin possible des points déjà pris. */
export function placeDeathmatchStart(heroes: readonly Hero[]): void {
  const taken: Vec2[] = [];
  for (const h of shuffle(heroes)) {
    const free = DM_SPAWNS.filter((sp) => !taken.includes(sp));
    const far = (sp: Vec2) =>
      taken.length ? Math.min(...taken.map((o) => Math.hypot(o.x - sp.x, o.y - sp.y))) : Math.random();
    const best = free.sort((a, b) => far(b) - far(a))[0];
    taken.push(best);
    h.placeAt(best);
  }
}

/**
 * Réapparition aléatoire du Deathmatch, mais pas sous le nez d'un adversaire :
 * on note chaque point (loin des ennemis, hors de leur vue) et on tire parmi les 3 meilleurs.
 */
export function pickDeathmatchSpawn(arena: Arena, hero: Hero, heroes: readonly Hero[]): Vec2 {
  const foes = heroes.filter((h) => h !== hero && h.alive);
  const scored = DM_SPAWNS.map((sp) => {
    let minD = Infinity;
    let seen = false;
    for (const f of foes) {
      minD = Math.min(minD, Math.hypot(f.x - sp.x, f.y - sp.y));
      if (inVisionRange(f.x, f.y, sp.x, sp.y) && lineOfSight(arena, f.x, f.y, sp.x, sp.y)) seen = true;
    }
    const score = (minD === Infinity ? 2000 : minD) - (seen ? 800 : 0) + Math.random() * 250;
    return { sp, score };
  }).sort((a, b) => b.score - a.score);
  return scored[Math.floor(Math.random() * Math.min(3, scored.length))].sp;
}

/** Classement du Deathmatch : éliminations décroissantes, puis le moins de morts. */
export function rankDeathmatch<T extends { kills: number; deaths: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}
