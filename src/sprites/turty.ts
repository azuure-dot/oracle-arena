import type { Grid } from './pixelArt';
import { propImage } from './SpriteRenderer';
import type { Dir8 } from './skater';
import {
  TURTY_BLAST,
  TURTY_BOMB,
  TURTY_HUMAN,
  TURTY_IMPACT,
  TURTY_SHELL,
  TURTY_SHEET_PALETTE,
  TURTY_TURTLE,
} from './turtySheet';

/**
 * SPRITES DE TURTY — les poses viennent telles quelles des planches du joueur
 * (concept/turty-*.png → src/sprites/turtySheet.ts, via tools/extract_turty.py).
 * La forme humaine vient de concept/turty-human-combat.png (pixels plus gros : le jeu
 * la dessine avec sa propre taille de pixel, voir Turty.ts).
 *
 * Chaque rangée de la planche donne 8 directions, dans l'ordre des étiquettes
 * SUD, SUD-OUEST, OUEST, NORD-OUEST, NORD, NORD-EST, EST, SUD-EST.
 * Les animations (marche, transformation, tir) sont faites par le jeu à partir de
 * ces poses : rebond, écrasement, éclaboussures.
 */

export const TURTY_PALETTE = TURTY_SHEET_PALETTE;

/** Colonne de la planche pour chaque direction. */
const SHEET_INDEX: Record<Dir8, number> = {
  down: 0,
  downLeft: 1,
  left: 2,
  upLeft: 3,
  up: 4,
  upRight: 5,
  right: 6,
  downRight: 7,
};

export type TurtyLook = 'human' | 'turtle' | 'turtleDry' | 'shell';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/**
 * Couleurs d'eau / d'écume de la palette (éclaboussures sous la tortue) : cyans clairs,
 * et gris-bleus clairs (l'écume mélangée au fond gris de la planche).
 */
const WATERY = new Set(
  Object.entries(TURTY_PALETTE)
    .filter(([, hex]) => {
      const [r, g, b] = rgb(hex);
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      return (lum > 95 && b >= g * 0.85 && b >= r + 8) || (Math.max(r, g, b) - Math.min(r, g, b) < 30 && lum > 140);
    })
    .map(([ch]) => ch),
);

/**
 * Tortue sur sol sec : on retire les éclaboussures dessinées sous ses pattes, elles ne
 * reviennent que sur l'eau. Dans le bas de l'image, on efface les pixels couleur d'eau
 * reliés au vide (les taches de la carapace, entourées de contour, restent), puis les
 * gouttelettes détachées du corps.
 */
function dryTurtle(src: Grid): Grid {
  const H = src.length;
  const W = src[0].length;
  const from = Math.floor(H * 0.45);
  const g = src.map((r) => [...r]);
  const stack: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === '.' || x === 0 || x === W - 1 || y === H - 1) stack.push([x, y]);
  const seen = new Set<number>();
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= W || y >= H || seen.has(y * W + x)) continue;
    const ch = g[y][x];
    if (ch !== '.' && !(y >= from && WATERY.has(ch))) continue;
    seen.add(y * W + x);
    g[y][x] = '.';
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Gouttelettes : petits groupes de pixels détachés du corps.
  const comp = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x] === '.' || comp[y * W + x] >= 0) continue;
      const id = sizes.length;
      let n = 0;
      const st: [number, number][] = [[x, y]];
      while (st.length) {
        const [cx, cy] = st.pop()!;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || g[cy][cx] === '.' || comp[cy * W + cx] >= 0) continue;
        comp[cy * W + cx] = id;
        n++;
        st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      sizes.push(n);
    }
  const biggest = Math.max(...sizes);
  return g.map((row, y) => row.map((ch, x) => (ch !== '.' && sizes[comp[y * W + x]] < biggest * 0.05 ? '.' : ch)).join(''));
}

const DRY = TURTY_TURTLE.map(dryTurtle);
const SOURCES: Record<TurtyLook, readonly Grid[]> = {
  human: TURTY_HUMAN,
  turtle: TURTY_TURTLE,
  turtleDry: DRY,
  shell: TURTY_SHELL,
};
/** Dernière ligne opaque d'une grille (le bas des pattes). */
const lastRow = (g: Grid) => {
  let y = g.length - 1;
  while (y > 0 && !/[^.]/.test(g[y])) y--;
  return y;
};

// ------------------------------------------------------------ forme humaine animée

/**
 * Forme humaine de combat (concept/turty-human-combat.png) : la planche donne une pose
 * par direction ; le jeu en tire des images de marche (jambes) et de tir (bras + jet d'eau).
 *
 * - Marche, 4 temps : pose, jambe gauche levée, pose, jambe droite levée. Une jambe levée
 *   perd une rangée sous le genou (le pied remonte d'un pixel). De profil, une seule jambe
 *   est dessinée : le jeu ajoute la jambe arrière (copie assombrie) et fait une enjambée.
 * - Tir : l'arme recule d'un pixel vers le corps et un jet d'eau sort du canon.
 * Toutes les images ont la même taille (marge de PAD colonnes de chaque côté pour le jet).
 */
const PAD = 3;
/** Première rangée des jambes (sous le short) et rangée du genou. */
const LEG_TOP = 30;
const KNEE = 32;

/** Bras armé de chaque pose : colonnes du côté de l'arme (avant la marge), rangées, sens du recul. */
const ARM: Partial<Record<Dir8, { side: -1 | 1; edge: number; y0: number; y1: number }>> = {
  downLeft: { side: -1, edge: 9, y0: 19, y1: 30 },
  left: { side: -1, edge: 8, y0: 19, y1: 28 },
  upLeft: { side: -1, edge: 8, y0: 19, y1: 29 },
  upRight: { side: 1, edge: 16, y0: 19, y1: 29 },
  right: { side: 1, edge: 15, y0: 19, y1: 28 },
  downRight: { side: 1, edge: 18, y0: 19, y1: 30 },
};
/** Vues de profil : une seule jambe visible ; sens de la marche (vers où elle regarde). */
const PROFILE: Partial<Record<Dir8, -1 | 1>> = { left: -1, right: 1 };

const hexRgb = (hex: string) => rgb(hex);
/** Caractère de palette le plus proche d'une couleur. */
function nearestChar(r: number, g: number, b: number): string {
  let best = '.';
  let bd = Infinity;
  for (const [ch, hex] of Object.entries(TURTY_PALETTE)) {
    const [pr, pg, pb] = hexRgb(hex);
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bd) {
      bd = d;
      best = ch;
    }
  }
  return best;
}
const SPRAY = { light: nearestChar(0xd8, 0xfb, 0xff), mid: nearestChar(0x84, 0xf5, 0xf3), deep: nearestChar(0x1c, 0xe2, 0xd9) };
const darkCache = new Map<string, string>();
/** Même couleur, plus sombre (jambe arrière, dans l'ombre du corps). */
function darker(ch: string): string {
  let d = darkCache.get(ch);
  if (d === undefined) {
    const [r, g, b] = hexRgb(TURTY_PALETTE[ch]);
    d = nearestChar(r * 0.6, g * 0.6, b * 0.6);
    darkCache.set(ch, d);
  }
  return d;
}
const isOrange = (ch: string) => {
  if (ch === '.') return false;
  const [r, g, b] = hexRgb(TURTY_PALETTE[ch]);
  return r > 180 && g < 150 && b < 90;
};

type Cells = string[][];
const toCells = (g: Grid): Cells => g.map((row) => ['.'.repeat(PAD), row, '.'.repeat(PAD)].join('').split(''));
const fromCells = (c: Cells): Grid => c.map((r) => r.join(''));

/** Colonnes de chaque jambe (groupes de colonnes occupées sous le genou). */
function legColumns(c: Cells): [number, number][] {
  const H = c.length;
  const used = c[0].map((_, x) => c.slice(LEG_TOP + 1, H).some((r) => r[x] !== '.'));
  const out: [number, number][] = [];
  for (let x = 0; x < used.length; x++) {
    if (!used[x]) continue;
    const s = x;
    while (x + 1 < used.length && used[x + 1]) x++;
    out.push([s, x]);
  }
  return out;
}

/** Jambe levée : une rangée de moins sous le genou, le pied remonte. */
function liftLeg(c: Cells, [x0, x1]: [number, number]): void {
  const H = c.length;
  for (let x = x0; x <= x1; x++) {
    for (let y = KNEE; y < H - 1; y++) c[y][x] = c[y + 1][x];
    c[H - 1][x] = '.';
  }
}

/** Décale le bas d'une jambe (sous le genou) de dx colonnes. */
function swingLeg(c: Cells, [x0, x1]: [number, number], dx: number): void {
  for (let y = KNEE; y < c.length; y++) {
    const part = c[y].slice(x0, x1 + 1);
    for (let x = x0; x <= x1; x++) c[y][x] = '.';
    part.forEach((ch, i) => {
      const x = x0 + i + dx;
      if (ch !== '.' && x >= 0 && x < c[y].length) c[y][x] = ch;
    });
  }
}

/** Profil : jambe arrière (copie assombrie de la jambe visible), dessinée derrière, décalée de dx. */
function backLeg(c: Cells, src: Cells, [x0, x1]: [number, number], dx: number): void {
  for (let y = LEG_TOP; y < c.length; y++)
    for (let x = x0; x <= x1; x++) {
      const ch = src[y][x];
      const tx = x + dx;
      if (ch === '.' || tx < 0 || tx >= c[y].length || c[y][tx] !== '.') continue;
      c[y][tx] = darker(ch);
    }
}

function walkFrame(c: Cells, dir: Dir8, step: number): void {
  if (step % 2 === 0) return; // temps 0 et 2 : la pose de la planche
  const legs = legColumns(c);
  const facing = PROFILE[dir];
  if (facing !== undefined && legs.length) {
    // Profil : la jambe visible part en avant (temps 1) ou en arrière (temps 3),
    // la jambe arrière fait l'inverse.
    const leg = legs[0];
    const src = c.map((r) => [...r]);
    const fwd = step === 1 ? facing : -facing;
    swingLeg(c, leg, fwd);
    if (step === 3) liftLeg(c, leg);
    backLeg(c, src, leg, -fwd * 2);
    return;
  }
  if (legs.length >= 2) liftLeg(c, step === 1 ? legs[0] : legs[legs.length - 1]);
}

function fireFrame(c: Cells, dir: Dir8): void {
  const arm = ARM[dir];
  const W = c[0].length;
  const put = (x: number, y: number, ch: string) => {
    if (x >= 0 && x < W && y >= 0 && y < c.length) c[y][x] = ch;
  };
  if (!arm) {
    if (dir !== 'down') return; // de dos, l'arme est cachée
    // De face : l'arme est tenue devant elle (pixels orange à hauteur des mains, au-dessus
    // du short, orange lui aussi) ; le jet part vers le bas.
    let tip: [number, number] | null = null;
    for (let y = 18; y < LEG_TOP - 2; y++) for (let x = 0; x < W; x++) if (isOrange(c[y][x]) && (!tip || y >= tip[1])) tip = [x, y];
    if (!tip) return;
    const [x, y] = tip;
    put(x, y + 1, SPRAY.mid);
    put(x - 1, y + 2, SPRAY.light);
    put(x + 1, y + 2, SPRAY.light);
    put(x, y + 2, SPRAY.deep);
    return;
  }
  // Arme : tous les pixels du côté de l'arme, au-delà de `edge` (colonnes de la planche).
  const edge = arm.edge + PAD;
  const inArm = (x: number) => (arm.side < 0 ? x < edge : x >= edge);
  const src = c.map((r) => [...r]);
  let tip: [number, number] | null = null;
  for (let y = arm.y0; y < arm.y1; y++)
    for (let x = 0; x < W; x++) {
      if (!inArm(x)) continue;
      c[y][x] = '.';
      if (src[y][x] !== '.' && (!tip || (arm.side < 0 ? x < tip[0] : x > tip[0]))) tip = [x, y];
    }
  // Recul : l'arme se rapproche du corps d'un pixel.
  const back = -arm.side;
  for (let y = arm.y0; y < arm.y1; y++)
    for (let x = 0; x < W; x++) if (inArm(x) && src[y][x] !== '.') put(x + back, y, src[y][x]);
  if (!tip) return;
  // Jet d'eau à la sortie du canon (en avant de l'arme reculée).
  const tx = tip[0] + back;
  const ty = tip[1];
  const o = arm.side;
  put(tx + o, ty, SPRAY.mid);
  put(tx + o * 2, ty, SPRAY.light);
  put(tx + o * 2, ty - 1, SPRAY.deep);
  put(tx + o * 2, ty + 1, SPRAY.deep);
  put(tx + o * 3, ty, SPRAY.light);
}

const humanCache = new Map<string, Grid>();
/** Pose humaine : temps de marche (0..3) et image de tir. */
function humanGrid(i: number, dir: Dir8, step: number, fire: boolean): Grid {
  const key = `${i}.${step}.${fire ? 1 : 0}`;
  let g = humanCache.get(key);
  if (!g) {
    const c = toCells(TURTY_HUMAN[i]);
    walkFrame(c, dir, step);
    if (fire) fireFrame(c, dir);
    g = fromCells(c);
    humanCache.set(key, g);
  }
  return g;
}
export const HUMAN_WALK_STEPS = 4;

export interface TurtyFrame {
  img: HTMLCanvasElement;
  /** Colonne du centre du corps (pixels de l'image, contour inclus). */
  anchorX: number;
  /**
   * Ligne de l'image posée au sol (pixels de sprite, contour inclus) : le bas de l'image,
   * sauf pour la tortue, dont les éclaboussures dépassent sous les pattes.
   */
  ground: number;
}

/** Centre du corps : moyenne des colonnes opaques du haut de l'image (tête, carapace), sans l'arme. */
function bodyCenter(g: Grid, look: TurtyLook): number {
  const until = look === 'human' ? Math.floor(g.length * 0.4) : g.length;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < until; y++)
    for (let x = 0; x < g[y].length; x++)
      if (g[y][x] !== '.' && !(look !== 'human' && WATERY.has(g[y][x]))) {
        sum += x;
        n++;
      }
  return n ? sum / n + 0.5 : g[0].length / 2;
}

const centers = new Map<string, number>();

/**
 * Image d'une pose (contour aux couleurs de l'équipe). Forme humaine : `step` = temps de
 * marche (0..3, 0 à l'arrêt) et `fire` = image de tir.
 */
export function turtyFrame(
  look: TurtyLook,
  dir: Dir8,
  v: { outline: string; silhouette?: string; step?: number; fire?: boolean },
): TurtyFrame {
  const i = SHEET_INDEX[dir];
  const human = look === 'human';
  const step = human ? (v.step ?? 0) % HUMAN_WALK_STEPS : 0;
  const fire = human && !!v.fire;
  const g = human ? humanGrid(i, dir, step, fire) : SOURCES[look][i];
  const key = `${look}.${i}`;
  let cx = centers.get(key);
  if (cx === undefined) {
    // Centre calculé sur la pose de base : il ne bouge pas d'une image à l'autre.
    cx = bodyCenter(human ? humanGrid(i, dir, 0, false) : g, look);
    centers.set(key, cx);
  }
  const name = human ? `${key}.${step}.${fire ? 1 : 0}` : key;
  const img = propImage(`turty.${name}`, g, TURTY_PALETTE, { outline: v.outline, silhouette: v.silhouette });
  const ground = look === 'turtle' || look === 'turtleDry' ? lastRow(DRY[i]) + 2 : g.length + 2;
  return { img, anchorX: cx + 1, ground };
}

/** Bombe à eau en vol, vue dans la direction du lancer. */
export function bombImage(dir: Dir8): HTMLCanvasElement {
  return propImage(`turty.bomb.${dir}`, TURTY_BOMB[SHEET_INDEX[dir]], TURTY_PALETTE, { outline: null });
}
/** Bombe posée : impact puis amorce (0..2). */
export function impactImage(i: number): HTMLCanvasElement {
  return propImage(`turty.impact.${i}`, TURTY_IMPACT[i], TURTY_PALETTE, { outline: null });
}
/** Explosion (0..3). */
export function blastImage(i: number): HTMLCanvasElement {
  return propImage(`turty.blast.${i}`, TURTY_BLAST[i], TURTY_PALETTE, { outline: null });
}
export const IMPACT_FRAMES = TURTY_IMPACT.length;
export const BLAST_FRAMES = TURTY_BLAST.length;
