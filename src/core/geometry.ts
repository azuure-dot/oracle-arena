import { angleDiff, clamp } from './math';

/**
 * Hitbox rectangulaire, alignée sur les axes, décrite par son centre et ses demi-dimensions.
 * Héros et bots utilisent la même boîte pour les dégâts ET pour les collisions avec les murs :
 * elle épouse le sprite (tête comprise).
 */
export interface Box {
  x: number;
  y: number;
  hw: number; // demi-largeur
  hh: number; // demi-hauteur
}

/** Distance d'un point au bord de la boîte (0 si le point est dedans). */
export function distToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(Math.abs(px - b.x) - b.hw, 0);
  const dy = Math.max(Math.abs(py - b.y) - b.hh, 0);
  return Math.hypot(dx, dy);
}

/** Un cercle (projectile) touche-t-il la boîte ? */
export function circleIntersectsBox(cx: number, cy: number, r: number, b: Box): boolean {
  const nx = clamp(cx, b.x - b.hw, b.x + b.hw);
  const ny = clamp(cy, b.y - b.hh, b.y + b.hh);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

/** Les deux boîtes se chevauchent-elles (avec une marge optionnelle) ? */
export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw + margin && Math.abs(a.y - b.y) < a.hh + b.hh + margin;
}

/**
 * Distance du centre au bord de la boîte dans la direction (dx, dy) normalisée.
 * Sert à coller deux boîtes l'une devant l'autre (ennemi épinglé par la Charge).
 */
export const boxExtent = (b: { hw: number; hh: number }, dx: number, dy: number): number =>
  b.hw * Math.abs(dx) + b.hh * Math.abs(dy);

/**
 * La boîte est-elle (au moins en partie) dans le cône d'origine (ox, oy),
 * de direction `angle`, de demi-ouverture `halfArc` et de portée `reach` ?
 * (coup de marteau, Onde de choc)
 */
export function boxInCone(
  ox: number,
  oy: number,
  angle: number,
  halfArc: number,
  reach: number,
  b: Box,
): boolean {
  if (distToBox(ox, oy, b) > reach) return false;
  if (Math.abs(ox - b.x) <= b.hw && Math.abs(oy - b.y) <= b.hh) return true; // origine dans la boîte

  // Plage angulaire couverte par les 4 coins, vue depuis l'origine.
  const base = Math.atan2(b.y - oy, b.x - ox);
  let min = 0;
  let max = 0;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const d = angleDiff(base, Math.atan2(b.y + sy * b.hh - oy, b.x + sx * b.hw - ox));
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const axis = angleDiff(base, angle); // direction du cône, relative au centre de la boîte
  return axis - halfArc <= max && axis + halfArc >= min;
}
