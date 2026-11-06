import { TAU, type Vec2 } from '../core/math';
import type { Arena } from '../world/Arena';

/**
 * Déplacement des bots SANS pathfinding : de simples "raycasts" de hitbox.
 * On teste 16 directions autour de la direction voulue ; chacune est notée
 * selon (1) son accord avec la direction voulue et (2) la distance libre devant
 * elle avant un mur ou une zone de dégâts. Le bot contourne ainsi les obstacles.
 */

const DIRECTIONS = 16;

export interface Mover {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** Une boîte posée en (x, y) est-elle bloquée (mur, bord, zone de dégâts) ? */
function blocked(arena: Arena, x: number, y: number, hw: number, hh: number): boolean {
  if (arena.boxCollides(x, y, hw, hh)) return true;
  return arena.zoneAt(x, y)?.kind === 'hazard';
}

/** Fraction (0..1) de la distance `dist` libre dans la direction (dx, dy). */
export function clearance(arena: Arena, m: Mover, dx: number, dy: number, dist: number): number {
  const steps = Math.max(2, Math.ceil(dist / 12));
  for (let s = 1; s <= steps; s++) {
    const d = (dist * s) / steps;
    if (blocked(arena, m.x + dx * d, m.y + dy * d, m.hw - 1, m.hh - 1)) return (s - 1) / steps;
  }
  return 1;
}

/** Le trajet en ligne droite de la hitbox jusqu'au point est-il entièrement libre ? */
export function pathClear(arena: Arena, m: Mover, tx: number, ty: number): boolean {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  return clearance(arena, m, dx / dist, dy / dist, dist) >= 1;
}

/**
 * Meilleure direction de marche vers `desired` en évitant les obstacles.
 * `lookahead` : distance (px) à laquelle on anticipe les murs.
 */
export function steer(arena: Arena, m: Mover, desired: Vec2, lookahead = 110): Vec2 {
  const len = Math.hypot(desired.x, desired.y);
  if (len < 1e-3) return { x: 0, y: 0 };
  const base = Math.atan2(desired.y, desired.x);

  let best: Vec2 = { x: 0, y: 0 };
  let bestScore = -Infinity;
  for (let i = 0; i < DIRECTIONS; i++) {
    // 0, +1, -1, +2, -2... : à score égal, on garde la direction la plus proche de l'envie.
    const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const a = base + (k * TAU) / DIRECTIONS;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const free = clearance(arena, m, dx, dy, lookahead);
    const align = Math.cos(a - base); // 1 = exactement la direction voulue
    const score = align + free * 1.4 - (free < 1 ? 0.6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx, y: dy };
    }
  }
  return best;
}

/** Point aléatoire praticable (hors murs et zone de dégâts) pour la patrouille. */
export function randomFreePoint(arena: Arena, m: Mover, margin = 60): Vec2 {
  for (let i = 0; i < 40; i++) {
    const x = margin + Math.random() * (arena.width - margin * 2);
    const y = margin + Math.random() * (arena.height - margin * 2);
    if (!blocked(arena, x, y, m.hw + 20, m.hh + 20)) return { x, y };
  }
  return { x: arena.width / 2, y: arena.height / 2 };
}
