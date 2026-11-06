import { VISION } from '../config';
import type { Vec2 } from '../core/math';
import type { Arena, Rect } from './Arena';

/**
 * LIGNE DE VUE — deux outils complémentaires :
 *
 * 1. computeVisibility() : polygone de visibilité (pour le RENDU du brouillard).
 *    Pour chaque coin de mur on lance 3 rayons (angle - ε, angle, angle + ε) ;
 *    les rayons décalés "glissent" le long du coin et révèlent ce qu'il y a derrière.
 *    On garde l'impact le plus proche de chaque rayon, puis on trie par angle.
 *
 * 2. lineOfSight() / canSeeCircle() : test logique (pour le GAMEPLAY).
 *    Un segment œil→cible coupe-t-il un mur ? (algorithme de Liang-Barsky).
 *    C'est ce test qui décide si un bot est affiché, si une tourelle peut tirer,
 *    si un coup de mêlée passe... Il servira aussi côté serveur en multijoueur
 *    (ne pas envoyer au client un ennemi qu'il ne voit pas = anti-wallhack).
 */

const EPSILON_ANGLE = 0.0001;

export interface VisPoint extends Vec2 {
  angle: number;
}

/** Polygone de ce que voit un observateur placé en (ex, ey). */
export function computeVisibility(ex: number, ey: number, arena: Arena): VisPoint[] {
  const points: VisPoint[] = [];
  const segs = arena.segments;

  for (const c of arena.corners) {
    const base = Math.atan2(c.y - ey, c.x - ex);
    for (let k = -1; k <= 1; k++) {
      const angle = base + k * EPSILON_ANGLE;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      let minT = Infinity;
      for (const s of segs) {
        const sx = s.bx - s.ax;
        const sy = s.by - s.ay;
        const den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-12) continue; // parallèle
        const wx = s.ax - ex;
        const wy = s.ay - ey;
        const t = (wx * sy - wy * sx) / den; // distance le long du rayon
        const u = (wx * dy - wy * dx) / den; // position sur le segment [0, 1]
        if (t > 0 && u >= 0 && u <= 1 && t < minT) minT = t;
      }
      // Les bords de la map ferment la scène : chaque rayon touche forcément quelque chose.
      if (minT < Infinity) points.push({ x: ex + dx * minT, y: ey + dy * minT, angle });
    }
  }

  points.sort((a, b) => a.angle - b.angle);
  return points;
}

/**
 * Le cercle (cx, cy, r) touche-t-il la zone de vision 16:9 centrée sur l'œil ?
 * Au-delà de ce périmètre, rien n'est visible, même sans mur.
 */
export function inVisionRange(ex: number, ey: number, cx: number, cy: number, r = 0): boolean {
  return Math.abs(cx - ex) <= VISION.width / 2 + r && Math.abs(cy - ey) <= VISION.height / 2 + r;
}

/** Le segment [A, B] traverse-t-il le rectangle ? (Liang-Barsky) */
export function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.x, r.x + r.w - ax, ay - r.y, r.y + r.h - ay];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallèle et à l'extérieur
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

/** Vue dégagée entre deux points ? */
export function lineOfSight(arena: Arena, ax: number, ay: number, bx: number, by: number): boolean {
  for (const w of arena.walls) {
    if (segmentIntersectsRect(ax, ay, bx, by, w)) return false;
  }
  return true;
}

/**
 * Un cercle est visible si son centre OU l'un de ses deux bords latéraux
 * (perpendiculaires à la ligne de visée) l'est : un bot à moitié caché
 * derrière un coin reste donc visible.
 */
export function canSeeCircle(
  arena: Arena,
  ex: number,
  ey: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  if (lineOfSight(arena, ex, ey, cx, cy)) return true;
  const dx = cx - ex;
  const dy = cy - ey;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const px = (-dy / len) * r * 0.85;
  const py = (dx / len) * r * 0.85;
  return lineOfSight(arena, ex, ey, cx + px, cy + py) || lineOfSight(arena, ex, ey, cx - px, cy - py);
}
