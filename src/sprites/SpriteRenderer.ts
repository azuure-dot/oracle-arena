import { TAU } from '../core/math';
import type { CharacterSprite } from './library';
import { mirrorGrid, renderGrid, type Grid, type Palette } from './pixelArt';

export type Facing = 'down' | 'up' | 'left' | 'right';

/** Mode de rendu (touche V en jeu) : sprites pixel art ou anciennes formes géométriques. */
export const renderSettings: { mode: 'sprites' | 'shapes' } = { mode: 'sprites' };

/** Nombre d'images du cycle de marche. */
export const WALK_FRAMES = 4;
/** Images de marche par seconde. */
export const WALK_FPS = 8;

/** Direction (4 vues) à partir d'un angle : 0 = droite, π/2 = bas (axe y vers le bas). */
export function facingFromAngle(angle: number): Facing {
  const a = ((angle % TAU) + TAU) % TAU;
  if (a < Math.PI / 4 || a >= (7 * Math.PI) / 4) return 'right';
  if (a < (3 * Math.PI) / 4) return 'down';
  if (a < (5 * Math.PI) / 4) return 'left';
  return 'up';
}

/** Image du cycle de marche à partir du temps d'animation (0 = immobile). */
export const walkFrame = (animTime: number): number =>
  animTime > 0 ? (1 + Math.floor(animTime * WALK_FPS)) % WALK_FRAMES : 0;

/**
 * Assemble haut du corps + jambes pour une direction et une image.
 *  - face/dos : neutre, pas, neutre, pas miroir
 *  - profil   : neutre, foulée, passage, foulée
 */
function composeFrame(def: CharacterSprite, facing: Facing, frame: number): Grid {
  const legs = def.legs;
  let rows: string[];
  if (facing === 'down' || facing === 'up') {
    const legRows = frame === 1 ? legs.frontStep : frame === 3 ? mirrorGrid(legs.frontStep) : legs.frontIdle;
    rows = [...def[facing], ...legRows];
  } else {
    const legRows = frame === 0 ? legs.sideIdle : frame === 2 ? legs.sidePass : legs.sideStride;
    rows = [...def.right, ...legRows];
  }
  return facing === 'left' ? mirrorGrid(rows) : rows;
}

// ------------------------------------------------------------------ cache

const cache = new Map<string, HTMLCanvasElement>();

interface Variant {
  outline: string | null;
  overrides?: Palette;
  silhouette?: string;
}

function variantKey(v: Variant): string {
  const o = v.overrides ? Object.entries(v.overrides).map(([k, c]) => k + c).join(',') : '';
  return `${v.outline}|${v.silhouette ?? ''}|${o}`;
}

export function characterFrame(def: CharacterSprite, facing: Facing, frame: number, v: Variant): HTMLCanvasElement {
  const key = `${def.id}|${facing}|${frame}|${variantKey(v)}`;
  let img = cache.get(key);
  if (!img) {
    const palette = v.overrides ? { ...def.palette, ...v.overrides } : def.palette;
    img = renderGrid(composeFrame(def, facing, frame), palette, v, `${def.id}.${facing}.${frame}`);
    cache.set(key, img);
  }
  return img;
}

export function propImage(name: string, g: Grid, palette: Palette, v: Variant): HTMLCanvasElement {
  const key = `prop:${name}|${variantKey(v)}`;
  let img = cache.get(key);
  if (!img) {
    img = renderGrid(g, { ...palette, ...v.overrides }, v, name);
    cache.set(key, img);
  }
  return img;
}

// ------------------------------------------------------------------ mise en page

export interface SpriteLayout {
  /** Taille d'un pixel de sprite en unités monde. */
  px: number;
  left: number;
  top: number;
  w: number;
  h: number;
  /** Ligne des pieds (où se trouvent l'ombre et l'anneau d'équipe). */
  feetY: number;
}

/**
 * Place le sprite autour de la hurtbox (cercle de centre x,y et rayon `radius`) :
 * largeur ≈ 2,3 × rayon, pieds un peu sous le cercle, tête au-dessus.
 * La hurtbox couvre donc le torse et le bas de la tête.
 */
export function characterLayout(def: CharacterSprite, x: number, y: number, radius: number): SpriteLayout {
  const gw = def.down[0].length + 2; // + contour
  const gh = def.down.length + def.legs.frontIdle.length + 2;
  const px = (radius * 2.3) / gw;
  const w = gw * px;
  const h = gh * px;
  const feetY = y + radius * 1.15;
  return { px, left: x - w / 2, top: feetY - h, w, h, feetY };
}

// ------------------------------------------------------------------ dessin

export interface DrawCharacterOptions {
  x: number;
  y: number;
  radius: number;
  facing: Facing;
  frame: number;
  outline: string;
  overrides?: Palette;
  /** Flash blanc (dégâts subis). */
  flash?: boolean;
  /** Teinte unie par-dessus (ex. Rappel) avec son opacité. */
  tint?: { color: string; alpha: number };
  alpha?: number;
}

export function drawCharacter(ctx: CanvasRenderingContext2D, def: CharacterSprite, o: DrawCharacterOptions): SpriteLayout {
  const L = characterLayout(def, o.x, o.y, o.radius);
  const base = characterFrame(def, o.facing, o.frame, { outline: o.outline, overrides: o.overrides });

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.drawImage(base, L.left, L.top, L.w, L.h);
  if (o.flash) {
    ctx.drawImage(characterFrame(def, o.facing, o.frame, { outline: o.outline, silhouette: '#ffffff' }), L.left, L.top, L.w, L.h);
  } else if (o.tint) {
    ctx.globalAlpha *= o.tint.alpha;
    ctx.drawImage(characterFrame(def, o.facing, o.frame, { outline: o.outline, silhouette: o.tint.color }), L.left, L.top, L.w, L.h);
  }
  ctx.restore();
  return L;
}

/**
 * Accessoire pixel art tourné (canon, marteau...).
 * (pivotX, pivotY) = point de rotation dans l'image, en pixels de sprite (contour inclus).
 */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  angle: number,
  px: number,
  pivotX: number,
  pivotY: number,
  flipY = false,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (flipY) ctx.scale(1, -1);
  ctx.drawImage(img, -pivotX * px, -pivotY * px, img.width * px, img.height * px);
  ctx.restore();
}

/**
 * Ombre + anneau d'équipe aux pieds, avec un chevron qui indique la direction de visée
 * (les sprites n'ont que 4 directions : le chevron donne l'angle exact).
 */
export function drawGroundRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  feetY: number,
  radius: number,
  color: string,
  aim?: number,
): void {
  const rx = radius * 1.05;
  const ry = radius * 0.42;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, feetY, rx * 0.85, ry * 0.85, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, feetY, rx, ry, 0, 0, TAU);
  ctx.stroke();

  if (aim !== undefined) {
    const dx = Math.cos(aim);
    const dy = Math.sin(aim);
    const tipX = x + dx * (rx + 9);
    const tipY = feetY + dy * (ry + 9);
    const baseX = x + dx * (rx + 2);
    const baseY = feetY + dy * (ry + 2);
    const nx = -dy * 5;
    const ny = dx * 5 * (ry / rx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + nx, baseY + ny);
    ctx.lineTo(baseX - nx, baseY - ny);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
