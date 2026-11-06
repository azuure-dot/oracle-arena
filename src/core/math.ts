// Petites fonctions utilitaires de math 2D.

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

export const normalize = (x: number, y: number): Vec2 => {
  const len = Math.hypot(x, y);
  return len > 1e-6 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
};

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);

/** Lissage exponentiel indépendant du framerate. */
export const damp = (current: number, target: number, smoothing: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-smoothing * dt));

/** Écart signé le plus court de l'angle a vers l'angle b, dans [-π, π]. */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/** Tourne `current` vers `target` d'au plus `maxStep` radians. */
export const rotateTowards = (current: number, target: number, maxStep: number): number => {
  const d = angleDiff(current, target);
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
};

/**
 * Un cercle (cx, cy, r) est-il dans le cône d'origine (ox, oy), de direction
 * `angle`, de demi-ouverture `halfArc` et de portée `reach` ?
 * La tolérance angulaire tient compte du rayon de la cible.
 */
export const circleInCone = (
  ox: number,
  oy: number,
  angle: number,
  halfArc: number,
  reach: number,
  cx: number,
  cy: number,
  r: number,
): boolean => {
  const d = Math.hypot(cx - ox, cy - oy);
  if (d - r > reach) return false;
  if (d < r) return true;
  const tolerance = Math.asin(Math.min(1, r / d));
  return Math.abs(angleDiff(angle, Math.atan2(cy - oy, cx - ox))) <= halfArc + tolerance;
};
