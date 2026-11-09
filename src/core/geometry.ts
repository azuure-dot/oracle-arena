import { angleDiff, clamp } from './math';

/**
 * Hitbox ronde : héros et bots sont des boules vues de dessus. Le même cercle sert pour
 * les dégâts ET pour les collisions avec les murs.
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Rectangle aligné sur les axes (murs, zones). */
export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance d'un point au bord du cercle (0 si le point est dedans). */
export function distToCircle(px: number, py: number, c: Circle): number {
  return Math.max(0, Math.hypot(px - c.x, py - c.y) - c.r);
}

/** Un cercle de rayon `r` centré en (x, y) (projectile) touche-t-il le cercle `c` ? */
export function circleTouches(x: number, y: number, r: number, c: Circle): boolean {
  return (x - c.x) ** 2 + (y - c.y) ** 2 <= (r + c.r) ** 2;
}

/** Les deux cercles se chevauchent-ils (avec une marge optionnelle) ? */
export function circlesOverlap(a: Circle, b: Circle, margin = 0): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + margin;
}

/** Le cercle chevauche-t-il le rectangle ? */
export function circleHitsRect(x: number, y: number, r: number, w: RectLike): boolean {
  const nx = clamp(x, w.x, w.x + w.w);
  const ny = clamp(y, w.y, w.y + w.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}

/**
 * Le cercle est-il (au moins en partie) dans le cône d'origine (ox, oy), de direction
 * `angle`, de demi-ouverture `halfArc` et de portée `reach` ? (coup de marteau, Onde de choc)
 */
export function circleInCone(ox: number, oy: number, angle: number, halfArc: number, reach: number, c: Circle): boolean {
  const d = Math.hypot(c.x - ox, c.y - oy);
  if (d - c.r > reach) return false;
  if (d <= c.r) return true; // origine dans le cercle
  // Le cercle couvre ±asin(r/d) autour de sa direction, vu depuis l'origine.
  const spread = Math.asin(Math.min(1, c.r / d));
  return Math.abs(angleDiff(Math.atan2(c.y - oy, c.x - ox), angle)) <= halfArc + spread;
}
