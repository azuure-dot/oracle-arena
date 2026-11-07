import type { Arena, Rect, WallStyle } from '../Arena';
import type { MapTheme } from './index';

/**
 * Thème « camp scientifique dans un volcan » (carte Volcan), en pixel art.
 *
 * - Sol : dalles sombres du camp, laboratoires (spawns) en carrelage clair, héliports,
 *   marquages ; au centre, une passerelle en tôle perforée dont les trous laissent
 *   voir la lave (plus vive près des fosses), bordée de bandes de danger.
 * - Murs : roche volcanique veinée de lave, toits des bâtiments (panneaux solaires,
 *   clims, aérations, cheminées), façades éclairées, paillasses du labo, garde-corps
 *   rayés jaune/noir, cuves rondes de magma.
 * - Animé : la lave des fosses ondule, lueur pulsante et braises qui s'envolent.
 *
 * Tout est calculé au pixel (1 pixel = 4 unités monde) avec un bruit déterministe :
 * la carte a toujours exactement le même aspect.
 */

const P = 4;
type RGB = readonly [number, number, number];

const STYLE: Record<WallStyle, number> = { rock: 1, building: 2, lab: 3, barrier: 4, tank: 5 };
/** Hauteur (pixels) de la façade visible sous chaque type de mur (vue de 3/4). */
const FRONT = [0, 6, 6, 4, 2, 0];

// ------------------------------------------------------------------ outils

/** Bruit déterministe 0..1 d'une cellule entière. */
function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bruit de valeur lissé (cellules de `cell` pixels). */
function vnoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

/** Tampon de pixels RGBA. */
class Pix {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  blend(x: number, y: number, c: RGB, t: number): void {
    if (!this.inside(x, y)) return;
    this.set(x, y, mix(this.get(x, y), c, t), Math.max(this.data[(y * this.w + x) * 4 + 3], 255 * t));
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  toImageData(): ImageData {
    return new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, this.w, this.h);
  }
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.putImageData(this.toImageData(), 0, 0);
    return c;
  }
}

interface PxRect {
  x0: number;
  y0: number;
  x1: number; // exclusif
  y1: number;
}
const toPx = (r: Rect): PxRect => ({
  x0: Math.round(r.x / P),
  y0: Math.round(r.y / P),
  x1: Math.round((r.x + r.w) / P),
  y1: Math.round((r.y + r.h) / P),
});
const inPx = (r: PxRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
/** Distance (pixels) d'un point à un rectangle (0 dedans). */
function distPx(r: PxRect, x: number, y: number): number {
  const dx = Math.max(r.x0 - x, 0, x - (r.x1 - 1));
  const dy = Math.max(r.y0 - y, 0, y - (r.y1 - 1));
  return Math.hypot(dx, dy);
}

// ------------------------------------------------------------------ masques

interface Tank {
  x: number;
  y: number;
  r: number;
}

interface Masks {
  w: number;
  h: number;
  /** Code de style du mur (0 = sol). Les cuves sont des disques (5). */
  style: Uint8Array;
  lava: Uint8Array;
  /** Distance (pixels, en « pâté de maisons ») au sol le plus proche, dans les murs. */
  depth: Uint16Array;
  /** Nombre de pixels de mur jusqu'au bord inférieur (1 = dernière rangée). */
  down: Uint16Array;
  tanks: Tank[];
  lavaRects: PxRect[];
  /** Fosses : groupes de rectangles de lave qui se touchent. */
  pits: PxRect[];
  /** Passerelle centrale : boîte englobant toutes les fosses. */
  grate: PxRect | null;
}

const maskCache = new WeakMap<Arena, Masks>();

function masks(arena: Arena): Masks {
  const cached = maskCache.get(arena);
  if (cached) return cached;
  const w = Math.ceil(arena.width / P);
  const h = Math.ceil(arena.height / P);
  const style = new Uint8Array(w * h);
  const fill = (m: Uint8Array, r: PxRect, v: number) => {
    for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++)
      for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) m[y * w + x] = v;
  };
  for (const r of arena.walls) {
    const s = r.style ?? 'building';
    if (s !== 'tank') fill(style, toPx(r), STYLE[s]);
  }
  const tanks: Tank[] = (arena.map.decor ?? [])
    .filter((d) => d.kind === 'tank')
    .map((d) => ({ x: d.x / P, y: d.y / P, r: d.r / P }));
  for (const t of tanks) {
    for (let y = Math.floor(t.y - t.r); y <= t.y + t.r; y++)
      for (let x = Math.floor(t.x - t.r); x <= t.x + t.r; x++)
        if (x >= 0 && y >= 0 && x < w && y < h && Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y) <= t.r) style[y * w + x] = 5;
  }
  const lavaRects = arena.lava.map(toPx);
  const lava = new Uint8Array(w * h);
  for (const r of lavaRects) fill(lava, r, 1);

  // Profondeur dans les murs (deux passes) ; hors de la carte = mur.
  const depth = new Uint16Array(w * h);
  const BIG = 9999;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!style[i]) continue;
      depth[i] = Math.min(y > 0 ? depth[i - w] + 1 : BIG, x > 0 ? depth[i - 1] + 1 : BIG);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!style[i]) continue;
      depth[i] = Math.min(depth[i], y < h - 1 ? depth[i + w] + 1 : BIG, x < w - 1 ? depth[i + 1] + 1 : BIG);
    }
  const down = new Uint16Array(w * h);
  for (let x = 0; x < w; x++)
    for (let y = h - 1; y >= 0; y--) {
      const i = y * w + x;
      down[i] = style[i] ? (y === h - 1 ? BIG : down[i + w] + 1) : 0;
    }

  // Fosses : on fusionne les rectangles de lave qui se touchent.
  const pits: PxRect[] = [];
  const used = new Set<number>();
  lavaRects.forEach((_, i) => {
    if (used.has(i)) return;
    const group = { ...lavaRects[i] };
    used.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      lavaRects.forEach((r, j) => {
        if (used.has(j)) return;
        if (r.x0 <= group.x1 && r.x1 >= group.x0 && r.y0 <= group.y1 && r.y1 >= group.y0) {
          group.x0 = Math.min(group.x0, r.x0);
          group.y0 = Math.min(group.y0, r.y0);
          group.x1 = Math.max(group.x1, r.x1);
          group.y1 = Math.max(group.y1, r.y1);
          used.add(j);
          grew = true;
        }
      });
    }
    pits.push(group);
  });
  const grate = pits.length
    ? {
        x0: Math.min(...pits.map((p) => p.x0)) - 4,
        y0: Math.min(...pits.map((p) => p.y0)) - 6,
        x1: Math.max(...pits.map((p) => p.x1)) + 4,
        y1: Math.max(...pits.map((p) => p.y1)) + 6,
      }
    : null;

  const m: Masks = { w, h, style, lava, depth, down, tanks, lavaRects, pits, grate };
  maskCache.set(arena, m);
  return m;
}

// ------------------------------------------------------------------ palettes

const C = {
  tileGrout: [17, 21, 27] as RGB,
  tile: [29, 35, 43] as RGB,
  labTile: [46, 55, 64] as RGB,
  labGrout: [34, 41, 48] as RGB,
  ash: [52, 46, 44] as RGB,
  pebble: [70, 62, 60] as RGB,
  plate: [44, 47, 52] as RGB,
  plateHi: [62, 66, 72] as RGB,
  seam: [22, 24, 28] as RGB,
  rivet: [96, 102, 110] as RGB,
  rust: [86, 52, 34] as RGB,
  emberDark: [44, 14, 9] as RGB,
  emberMid: [150, 42, 12] as RGB,
  emberHot: [255, 124, 30] as RGB,
  hazardY: [222, 176, 44] as RGB,
  hazardK: [30, 28, 28] as RGB,
  lip: [16, 13, 13] as RGB,
  paint: [176, 140, 44] as RGB,
  white: [214, 220, 226] as RGB,
};

const ROCK: RGB[] = [
  [24, 19, 22],
  [33, 26, 29],
  [43, 35, 38],
  [55, 45, 47],
  [69, 57, 58],
];
const LAVA: RGB[] = [
  [74, 16, 8],
  [160, 36, 10],
  [228, 78, 16],
  [255, 134, 32],
  [255, 208, 92],
];

// ------------------------------------------------------------------ sol

function grateColor(m: Masks, x: number, y: number, heat: number): RGB {
  const g = m.grate!;
  const lx = x - g.x0;
  const ly = y - g.y0;
  // Bordure boulonnée de la passerelle
  const bw = g.x1 - g.x0;
  const bh = g.y1 - g.y0;
  if (lx < 2 || ly < 2 || lx >= bw - 2 || ly >= bh - 2) {
    const edge = lx === 0 || ly === 0 || lx === bw - 1 || ly === bh - 1;
    if (edge) return C.seam;
    return (lx + ly) % 6 === 0 ? C.rivet : C.plateHi;
  }
  const px = lx % 24;
  const py = ly % 24;
  if (px === 0 || py === 0) return C.seam;
  const plateShade = 0.92 + hash(Math.floor(lx / 24), Math.floor(ly / 24), 7) * 0.16;
  let base = scale(C.plate, plateShade);
  if (px === 1 || py === 1) base = C.plateHi;
  if ((px === 3 || px === 21) && (py === 3 || py === 21)) return C.rivet;
  // Tôle perforée : trous 2×2 tous les 4 pixels, la lave brille dessous.
  const holeZone = px >= 4 && px <= 20 && py >= 4 && py <= 20;
  if (holeZone && px % 4 >= 1 && px % 4 <= 2 && py % 4 >= 1 && py % 4 <= 2) {
    const flick = vnoise(x, y, 5, 21) * 0.22;
    const t = Math.min(1, heat + flick);
    return t < 0.5 ? mix(C.emberDark, C.emberMid, t * 2) : mix(C.emberMid, C.emberHot, (t - 0.5) * 2);
  }
  if (vnoise(x, y, 9, 23) > 0.7) base = mix(base, C.rust, 0.45);
  // La tôle chauffe près des fosses.
  return mix(base, [120, 50, 24], heat * 0.35);
}

function floorColor(x: number, y: number, inLab: boolean, center: { x: number; y: number }): RGB {
  if (inLab) {
    // Labo : carrelage clair, petits carreaux
    const lx = x % 8;
    const ly = y % 8;
    if (lx === 0 || ly === 0) return C.labGrout;
    const v = hash(x >> 3, y >> 3, 3) * 6 - 3;
    let c: RGB = [C.labTile[0] + v, C.labTile[1] + v, C.labTile[2] + v];
    if (ly === 1) c = scale(c, 1.08);
    if (hash(x, y, 4) < 0.03) c = scale(c, 0.92);
    return c;
  }
  // Camp : grandes dalles de béton sombre
  const lx = x % 12;
  const ly = y % 12;
  if (lx === 0 || ly === 0) return C.tileGrout;
  const v = hash(x / 12 | 0, y / 12 | 0, 1) * 7 - 3.5;
  let c: RGB = [C.tile[0] + v, C.tile[1] + v, C.tile[2] + v];
  if (ly === 1) c = scale(c, 1.1);
  if (lx === 11) c = scale(c, 0.92);
  // Cendre volcanique, plus dense vers le cratère
  const d = Math.hypot(x - center.x, y - center.y);
  const ashy = vnoise(x, y, 14, 2) + Math.max(0, 0.35 - d / 900);
  if (ashy > 0.78) c = mix(c, C.ash, 0.5);
  const r = hash(x, y, 5);
  if (r < 0.012) c = scale(c, 0.8);
  else if (r < 0.016 + Math.max(0, 0.01 - d / 20000)) c = C.pebble;
  return c;
}

/** Ligne pointillée de peinture (marquage au sol), axe horizontal ou vertical, en unités monde. */
function paintDashes(px: Pix, m: Masks, ax: number, ay: number, bx: number, by: number): void {
  const x0 = Math.round(ax / P);
  const y0 = Math.round(ay / P);
  const x1 = Math.round(bx / P);
  const y1 = Math.round(by / P);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) {
    if (k % 10 >= 6) continue;
    const x = Math.round(x0 + ((x1 - x0) * k) / n);
    const y = Math.round(y0 + ((y1 - y0) * k) / n);
    for (let t = 0; t < 2; t++) {
      const xx = x0 === x1 ? x + t : x;
      const yy = y0 === y1 ? y + t : y;
      if (!m.style[yy * m.w + xx] && hash(xx, yy, 9) > 0.18) px.blend(xx, yy, C.paint, 0.75);
    }
  }
}

/** Câble posé au sol (polyligne en unités monde). */
function cable(px: Pix, m: Masks, pts: { x: number; y: number }[], core: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i].x / P;
    const ay = pts[i].y / P;
    const bx = pts[i + 1].x / P;
    const by = pts[i + 1].y / P;
    const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n);
      const y = Math.round(ay + ((by - ay) * k) / n);
      if (m.style[y * m.w + x] || m.lava[y * m.w + x]) continue;
      px.set(x, y, [14, 16, 20]);
      px.set(x + 1, y, [14, 16, 20]);
      px.set(x, y + 1, [10, 11, 14]);
      if (k % 3 === 0) px.set(x, y, core);
    }
  }
}

/** Chevron peint qui indique le point (dx, dy : direction). */
function chevron(px: Pix, x: number, y: number, dx: number, dy: number): void {
  const cx = Math.round(x / P);
  const cy = Math.round(y / P);
  for (let k = -4; k <= 4; k++) {
    const a = Math.abs(k);
    for (let t = 0; t < 2; t++) {
      const along = -a + t;
      const xx = cx + (dx !== 0 ? along * dx : k);
      const yy = cy + (dy !== 0 ? along * dy : k);
      px.blend(xx, yy, C.hazardY, 0.8);
    }
  }
}

function helipad(px: Pix, m: Masks, wx: number, wy: number, wr: number): void {
  const cx = wx / P;
  const cy = wy / P;
  const r = wr / P;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (!px.inside(x, y) || m.style[y * m.w + x]) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d > r - 3) {
        const dash = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 20) % 2 === 0;
        px.set(x, y, dash ? C.hazardY : C.hazardK);
      } else if (d > r - 4) px.set(x, y, [24, 28, 34]);
      else px.blend(x, y, [36, 42, 50], 0.7);
    }
  // « H »
  const hx = Math.round(cx);
  const hy = Math.round(cy);
  px.rect(hx - 7, hy - 9, 3, 18, C.white);
  px.rect(hx + 4, hy - 9, 3, 18, C.white);
  px.rect(hx - 4, hy - 1, 8, 3, C.white);
  // Feux de balisage
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    px.rect(Math.round(cx + Math.cos(a) * (r + 3)) - 1, Math.round(cy + Math.sin(a) * (r + 3)) - 1, 2, 2, [255, 210, 120]);
  }
}

function renderFloor(g: CanvasRenderingContext2D, arena: Arena): void {
  const m = masks(arena);
  const { w, h } = m;
  const px = new Pix(w, h);
  const center = { x: arena.width / 2 / P, y: arena.height / 2 / P };
  const labs = arena.safeZones.map((z) => toPx(z.rect));
  const grate = m.grate;

  // Chaleur de la passerelle : proximité de la lave.
  const heatAt = (x: number, y: number): number => {
    let d = Infinity;
    for (const r of m.lavaRects) d = Math.min(d, distPx(r, x, y));
    return Math.max(0, 1 - d / 34) * 0.85 + 0.05;
  };

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m.style[i]) {
        px.set(x, y, [12, 10, 10]);
        continue;
      }
      if (m.lava[i]) {
        px.set(x, y, LAVA[1 + Math.floor(vnoise(x, y, 4, 31) * 2.99)]);
        continue;
      }
      if (grate && inPx(grate, x, y)) px.set(x, y, grateColor(m, x, y, heatAt(x, y)));
      else px.set(x, y, floorColor(x, y, labs.some((r) => inPx(r, x, y)), center));
    }

  // --- Décor au sol (moitié nord ; le sud est obtenu par symétrie centrale)
  const W = arena.width;
  const H = arena.height;
  const both = (f: (mx: (x: number) => number, my: (y: number) => number) => void) => {
    f(
      (x) => x,
      (y) => y,
    );
    f(
      (x) => W - x,
      (y) => H - y,
    );
  };
  for (const d of arena.map.decor ?? []) if (d.kind === 'helipad') helipad(px, m, d.x, d.y, d.r);
  both((mx, my) => {
    paintDashes(px, m, mx(964), my(432), mx(1364), my(432));
    paintDashes(px, m, mx(1026), my(500), mx(1026), my(668));
    paintDashes(px, m, mx(1716), my(820), mx(1716), my(1096));
    paintDashes(px, m, mx(348), my(940), mx(348), my(1110));
    cable(
      px,
      m,
      [
        { x: mx(760), y: my(1010) },
        { x: mx(900), y: my(1030) },
        { x: mx(1000), y: my(1060) },
      ],
      [200, 60, 50],
    );
    cable(
      px,
      m,
      [
        { x: mx(1600), y: my(1100) },
        { x: mx(1560), y: my(1300) },
        { x: mx(1540), y: my(1480) },
        { x: mx(1490), y: my(1520) },
      ],
      [60, 140, 210],
    );
    cable(
      px,
      m,
      [
        { x: mx(1380), y: my(700) },
        { x: mx(1500), y: my(760) },
        { x: mx(1620), y: my(780) },
      ],
      [230, 190, 60],
    );
  });
  // Chevrons vers le point aux quatre entrées
  const cxw = W / 2;
  const cyw = H / 2;
  chevron(px, cxw - 28, cyw - 420, 0, 1);
  chevron(px, cxw + 28, cyw + 420, 0, -1);
  chevron(px, cxw - 380, cyw + 20, 1, 0);
  chevron(px, cxw + 380, cyw - 20, -1, 0);

  // --- Bord des fosses : lèvre sombre puis bande de danger jaune/noir
  if (grate) {
    for (let y = grate.y0 - 4; y < grate.y1 + 4; y++)
      for (let x = grate.x0 - 4; x < grate.x1 + 4; x++) {
        if (!px.inside(x, y)) continue;
        const i = y * w + x;
        if (m.style[i] || m.lava[i]) continue;
        let d = Infinity;
        for (const r of m.lavaRects) d = Math.min(d, distPx(r, x, y));
        if (d <= 1) px.set(x, y, C.lip);
        else if (d <= 3) px.set(x, y, ((x + y) >> 1) % 2 === 0 ? C.hazardY : C.hazardK);
      }
  }

  // --- Ombres portées des murs (vers le bas à droite)
  const shadowOf = (x: number, y: number) => x >= 0 && y >= 0 && m.style[y * w + x] !== 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m.style[i] || m.lava[i]) continue;
      if (shadowOf(x - 2, y - 3) || shadowOf(x - 1, y - 2) || shadowOf(x, y - 2)) {
        const c = px.get(x, y);
        px.set(x, y, scale(c, 0.62));
      }
    }

  g.putImageData(px.toImageData(), 0, 0);
}

// ------------------------------------------------------------------ murs

/** Veines de lave dans la roche : marches aléatoires (1 = cœur, 2 = halo). */
function lavaVeins(m: Masks): Uint8Array {
  const { w, h } = m;
  const veins = new Uint8Array(w * h);
  const rand = rng(1337);
  const deepRock = (x: number, y: number, min: number) =>
    x > 0 && y > 0 && x < w - 1 && y < h - 1 && m.style[y * w + x] === 1 && m.depth[y * w + x] >= min && m.down[y * w + x] > 8;
  const mark = (x: number, y: number, v: number) => {
    const i = y * w + x;
    if (v === 1 || veins[i] === 0) veins[i] = v;
  };
  const walk = (len: number, width: number, minDepth: number, fine = false) => {
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 200; tries++) {
      x = Math.floor(rand() * w);
      y = Math.floor(rand() * h);
      if (deepRock(x, y, minDepth + 4)) break;
    }
    if (!deepRock(x, y, minDepth)) return;
    let a = rand() * Math.PI * 2;
    for (let s = 0; s < len; s++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a);
      y += Math.sin(a);
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (!deepRock(ix, iy, minDepth)) break;
      for (let oy = -width; oy <= width; oy++)
        for (let ox = -width; ox <= width; ox++) {
          const d = Math.abs(ox) + Math.abs(oy);
          if (!deepRock(ix + ox, iy + oy, minDepth - 1)) continue;
          if (fine) {
            if (d === 0) mark(ix + ox, iy + oy, 3);
          } else if (d < width) mark(ix + ox, iy + oy, 1);
          else if (d <= width + 1) mark(ix + ox, iy + oy, 2);
        }
      if (rand() < 0.04) a += (rand() - 0.5) * 2.4; // embranchement brusque
    }
  };
  let rock = 0;
  for (let i = 0; i < w * h; i++) if (m.style[i] === 1 && m.depth[i] > 6) rock++;
  // Quelques coulées dans la roche profonde et de fines fissures sombres : la roche
  // reste surtout sombre pour ne pas voler la vedette à la zone de jeu.
  for (let k = 0; k < Math.round(rock / 16000); k++) walk(150, 1, 12);
  for (let k = 0; k < Math.round(rock / 3500); k++) walk(14 + rand() * 22, 1, 4, true);
  return veins;
}

function rockColor(m: Masks, x: number, y: number, vein: number, front: boolean, d: number): RGB {
  if (front) {
    if (d === 1) return [14, 11, 12];
    const v = hash(x, y >> 1, 41);
    const c = ROCK[v < 0.3 ? 0 : v < 0.8 ? 1 : 2];
    return x % 4 === 0 ? scale(c, 0.85) : c;
  }
  if (vein === 1) return hash(x, y, 43) < 0.3 ? LAVA[4] : LAVA[3];
  if (vein === 2) return [96, 30, 16];
  if (vein === 3) return hash(x, y, 44) < 0.5 ? [132, 40, 16] : [88, 28, 14];
  const n = (xx: number, yy: number) => vnoise(xx, yy, 7, 11) * 0.65 + vnoise(xx, yy, 3, 12) * 0.35;
  const tone = Math.min(3, Math.floor(n(x, y) * 4.4));
  const next = Math.min(3, Math.floor(n(x + 1, y + 1) * 4.4));
  let t = tone;
  if (tone > next) t = Math.min(4, tone + 1);
  else if (tone < next) t = Math.max(0, tone - 1);
  const i = y * m.w + x;
  // Rebord éclairé côté sol
  if (m.depth[i] === 1) return ROCK[4];
  return ROCK[t];
}

function buildingColor(m: Masks, x: number, y: number, front: boolean, d: number): RGB {
  const i = y * m.w + x;
  if (front) {
    const F = FRONT[2];
    if (d === 1) return [22, 26, 32];
    if (d === F) return [84, 94, 110];
    if (d === 3 || d === 4) {
      // Fenêtres éclairées (cyan) ou éteintes
      if (x % 5 >= 1 && x % 5 <= 3) {
        const lit = hash(Math.floor(x / 5), Math.floor(y / 8), 51) < 0.62;
        if (!lit) return [26, 40, 52];
        return d === 4 ? [134, 214, 240] : [86, 164, 200];
      }
      return [38, 44, 54];
    }
    return [44, 50, 60];
  }
  if (m.depth[i] === 1) return [112, 124, 142];
  if (m.depth[i] === 2) return [46, 52, 62];
  if (x % 12 === 0 || y % 12 === 0) return [54, 61, 73];
  const v = hash(Math.floor(x / 12), Math.floor(y / 12), 53) * 6 - 3;
  return [66 + v, 74 + v, 88 + v];
}

function labColor(m: Masks, x: number, y: number, front: boolean, d: number): RGB {
  const i = y * m.w + x;
  if (front) {
    if (d === 1) return [70, 78, 88];
    if (d === FRONT[3]) return [176, 186, 196];
    return x % 6 === 0 ? [116, 126, 138] : [134, 144, 156];
  }
  if (m.depth[i] === 1) return [238, 242, 246];
  return [198, 206, 214];
}

function barrierColor(m: Masks, x: number, y: number, front: boolean): RGB {
  const i = y * m.w + x;
  const stripe = ((x + y) >> 1) % 2 === 0;
  if (front) return stripe ? [140, 108, 30] : [18, 16, 16];
  if (m.depth[i] === 1) return [20, 18, 18];
  return stripe ? C.hazardY : C.hazardK;
}

/** Cuve de magma vue de 3/4 : couvercle vitré rond, cœur incandescent, flanc côtelé. */
function drawTank(px: Pix, t: Tank): void {
  const r = t.r;
  const tx = t.x;
  const ty = t.y - 2; // couvercle un peu plus haut : le flanc dépasse en bas
  for (let y = Math.floor(t.y - r); y <= t.y + r; y++)
    for (let x = Math.floor(t.x - r); x <= t.x + r; x++) {
      const d = Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y);
      if (d > r) continue;
      const dt = Math.hypot(x + 0.5 - tx, y + 0.5 - ty);
      if (dt > r - 1) {
        // Flanc
        px.set(x, y, x % 3 === 0 ? [34, 39, 48] : [50, 57, 68]);
        if (d > r - 1) px.set(x, y, [20, 22, 28]);
        continue;
      }
      const ang = Math.atan2(y + 0.5 - ty, x + 0.5 - tx);
      if (dt > r - 4) {
        const lit = ang < -Math.PI * 0.15 && ang > -Math.PI * 0.95;
        let c: RGB = lit ? [150, 158, 170] : [96, 104, 116];
        const bolt = Math.abs(((ang + Math.PI) / (Math.PI / 4)) % 1 - 0.5) > 0.42 && dt > r - 3 && dt < r - 2;
        if (bolt) c = [196, 202, 210];
        px.set(x, y, c);
        continue;
      }
      const f = dt / (r - 4);
      let c: RGB;
      if (f < 0.22) c = [255, 226, 124];
      else if (f < 0.38) c = [255, 162, 50];
      else if (f < 0.55) c = [232, 92, 20];
      else if (f < 0.7) c = [140, 38, 14];
      else c = [26, 34, 42];
      if (dt > r - 7 && dt < r - 5 && ang < -Math.PI * 0.55 && ang > -Math.PI * 0.85) c = [200, 226, 238];
      px.set(x, y, c);
    }
}

/** Accessoires de toit, posés sans se chevaucher. */
function roofProps(px: Pix, m: Masks, r: PxRect, seed: number): void {
  const rand = rng(seed);
  const F = FRONT[2];
  const x0 = r.x0 + 3;
  const y0 = r.y0 + 3;
  const x1 = r.x1 - 3;
  const y1 = r.y1 - F - 2;
  if (x1 - x0 < 6 || y1 - y0 < 5) return;
  const taken: PxRect[] = [];
  const free = (b: PxRect) => {
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (m.style[y * m.w + x] !== 2) return false;
    return !taken.some((o) => b.x0 < o.x1 + 1 && b.x1 + 1 > o.x0 && b.y0 < o.y1 + 1 && b.y1 + 1 > o.y0);
  };
  const place = (w: number, h: number): PxRect | null => {
    for (let k = 0; k < 30; k++) {
      const x = x0 + Math.floor(rand() * Math.max(1, x1 - x0 - w));
      const y = y0 + Math.floor(rand() * Math.max(1, y1 - y0 - h));
      const b = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (b.x1 <= x1 && b.y1 <= y1 && free(b)) {
        taken.push(b);
        return b;
      }
    }
    return null;
  };

  // Conduite le long du toit
  if (y1 - y0 > 10) {
    const py = y0;
    for (let x = x0; x < x1; x++) {
      if (m.style[py * m.w + x] !== 2) continue;
      px.set(x, py, [158, 166, 176]);
      px.set(x, py + 1, [96, 104, 116]);
      if ((x - x0) % 10 === 0) {
        px.set(x, py - 1, [120, 128, 138]);
        px.set(x, py + 2, [70, 76, 86]);
      }
    }
    taken.push({ x0, y0: py - 1, x1, y1: py + 3 });
  }

  const area = (x1 - x0) * (y1 - y0);
  const count = Math.max(2, Math.round(area / 170));
  for (let k = 0; k < count; k++) {
    const kind = rand();
    if (kind < 0.24) {
      // Panneaux solaires
      const b = place(13, 8);
      if (!b) continue;
      px.rect(b.x0, b.y0, 13, 8, [30, 44, 74]);
      for (let y = b.y0; y < b.y1; y++)
        for (let x = b.x0; x < b.x1; x++)
          if ((x - b.x0) % 3 === 0 || (y - b.y0) % 4 === 0) px.set(x, y, [70, 96, 140]);
      px.rect(b.x0, b.y1, 13, 1, [22, 26, 32]);
    } else if (kind < 0.46) {
      // Climatiseur avec ventilateur
      const b = place(9, 7);
      if (!b) continue;
      px.rect(b.x0, b.y0, 9, 7, [128, 136, 146]);
      px.rect(b.x0, b.y0, 9, 1, [168, 176, 186]);
      px.rect(b.x0, b.y1 - 1, 9, 1, [80, 86, 96]);
      const fx = b.x0 + 4;
      const fy = b.y0 + 3;
      for (let y = -2; y <= 2; y++)
        for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) px.set(fx + x, fy + y, (x + y) % 2 === 0 ? [36, 40, 46] : [60, 66, 74]);
    } else if (kind < 0.64) {
      // Aération
      const b = place(5, 5);
      if (!b) continue;
      px.rect(b.x0, b.y0, 5, 5, [34, 38, 44]);
      for (let y = b.y0 + 1; y < b.y1; y += 2) px.rect(b.x0 + 1, y, 3, 1, [78, 86, 96]);
      px.rect(b.x0, b.y0, 5, 1, [110, 118, 130]);
    } else if (kind < 0.8) {
      // Antenne parabolique
      const b = place(7, 7);
      if (!b) continue;
      const cx = b.x0 + 3;
      const cy = b.y0 + 3;
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++)
          if (x * x + y * y <= 10) px.set(cx + x, cy + y, x + y < 0 ? [214, 220, 226] : [160, 168, 178]);
      px.set(cx, cy, [60, 66, 74]);
      px.set(cx + 1, cy - 1, [255, 70, 60]);
    } else {
      // Cheminée de dégazage (lueur orange)
      const b = place(5, 5);
      if (!b) continue;
      px.rect(b.x0, b.y0, 5, 5, [78, 66, 62]);
      px.rect(b.x0 + 1, b.y0 + 1, 3, 3, [40, 20, 16]);
      px.set(b.x0 + 2, b.y0 + 2, [255, 132, 40]);
      px.set(b.x0 + 1, b.y0 + 2, [190, 70, 22]);
    }
  }
  // Balises rouges aux coins
  px.set(r.x0 + 2, r.y0 + 2, [255, 70, 60]);
  px.set(r.x1 - 3, r.y0 + 2, [255, 70, 60]);
}

/** Paillasses du labo : écrans, béchers, microscopes, portoirs d'échantillons. */
function benchProps(px: Pix, r: PxRect, seed: number): void {
  const rand = rng(seed);
  const F = FRONT[3];
  const y0 = r.y0 + 2;
  const y1 = r.y1 - F - 1;
  if (y1 - y0 < 4) {
    // Façade : bande de couleur d'équipe neutre (rayure de sécurité)
    for (let x = r.x0 + 1; x < r.x1 - 1; x++) if ((x >> 1) % 2 === 0) px.set(x, r.y0 + 2, [130, 196, 210]);
    return;
  }
  let x = r.x0 + 2;
  while (x < r.x1 - 4) {
    const k = rand();
    if (k < 0.3) {
      // Écran
      px.rect(x, y0, 6, 4, [30, 34, 40]);
      px.rect(x + 1, y0 + 1, 4, 2, rand() < 0.5 ? [90, 210, 230] : [120, 230, 140]);
      px.set(x + 2, y0 + 4, [60, 66, 74]);
      x += 8;
    } else if (k < 0.6) {
      // Béchers
      const cols: RGB[] = [
        [255, 120, 40],
        [120, 230, 120],
        [170, 110, 240],
        [90, 200, 255],
      ];
      for (let n = 0; n < 3; n++) {
        const c = cols[Math.floor(rand() * cols.length)];
        px.set(x + n * 2, y0 + 1, [220, 232, 240]);
        px.set(x + n * 2, y0 + 2, c);
        px.set(x + n * 2, y0 + 3, c);
      }
      x += 7;
    } else if (k < 0.8) {
      // Microscope
      px.rect(x, y0 + 2, 4, 2, [70, 76, 86]);
      px.rect(x + 1, y0, 2, 2, [40, 44, 50]);
      px.set(x + 2, y0, [200, 210, 220]);
      x += 6;
    } else {
      // Portoir d'échantillons (roches volcaniques)
      px.rect(x, y0 + 1, 7, 3, [120, 108, 96]);
      for (let n = 0; n < 3; n++) px.set(x + 1 + n * 2, y0 + 2, n === 1 ? [255, 120, 40] : [40, 30, 30]);
      x += 9;
    }
  }
}

function renderWalls(arena: Arena): HTMLCanvasElement {
  const m = masks(arena);
  const { w, h } = m;
  const px = new Pix(w, h);
  const veins = lavaVeins(m);

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const s = m.style[i];
      if (!s || s === 5) continue;
      const d = m.down[i];
      const front = d <= FRONT[s];
      let c: RGB;
      if (s === 1) c = rockColor(m, x, y, veins[i], front, d);
      else if (s === 2) c = buildingColor(m, x, y, front, d);
      else if (s === 3) c = labColor(m, x, y, front, d);
      else c = barrierColor(m, x, y, front);
      px.set(x, y, c);
    }

  for (const t of m.tanks) drawTank(px, t);
  arena.walls.forEach((r, k) => {
    if (r.style === 'building') roofProps(px, m, toPx(r), 900 + k * 17);
    else if (r.style === 'lab') benchProps(px, toPx(r), 400 + k * 13);
  });
  return px.toCanvas();
}

// ------------------------------------------------------------------ animations

interface LiveState {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  img: ImageData;
  box: PxRect;
  /** Pixels de lave : index dans l'image, coordonnées, bord (0 non, 1 contre le sol, 2 contre un mur). */
  cells: { i: number; x: number; y: number; edge: number; r: number }[];
  last: number;
}

const liveCache = new WeakMap<Arena, LiveState | null>();

function liveState(arena: Arena): LiveState | null {
  if (liveCache.has(arena)) return liveCache.get(arena)!;
  const m = masks(arena);
  if (!m.lavaRects.length) {
    liveCache.set(arena, null);
    return null;
  }
  const box = {
    x0: Math.min(...m.lavaRects.map((r) => r.x0)),
    y0: Math.min(...m.lavaRects.map((r) => r.y0)),
    x1: Math.max(...m.lavaRects.map((r) => r.x1)),
    y1: Math.max(...m.lavaRects.map((r) => r.y1)),
  };
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(bw, bh);
  const cells: LiveState['cells'] = [];
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      if (!m.lava[y * m.w + x]) continue;
      let edge = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * m.w + (x + dx);
        if (m.lava[j]) continue;
        edge = m.style[j] ? Math.max(edge, 2) : 1;
        if (edge === 1) break;
      }
      cells.push({ i: ((y - box.y0) * bw + (x - box.x0)) * 4, x, y, edge, r: hash(x, y, 61) });
    }
  const s: LiveState = { canvas, g, img, box, cells, last: -1 };
  liveCache.set(arena, s);
  return s;
}

function drawLive(ctx: CanvasRenderingContext2D, arena: Arena, time: number): void {
  const s = liveState(arena);
  if (!s) return;
  const m = masks(arena);

  // --- Lave des fosses (recalculée ~15 fois par seconde : rendu pixel art, pas besoin de plus)
  const frame = Math.floor(time * 15);
  if (frame !== s.last) {
    s.last = frame;
    const t = frame / 15;
    const d = s.img.data;
    for (const c of s.cells) {
      const v =
        Math.sin(c.x * 0.45 + t * 1.1 + Math.sin(c.y * 0.3 + t * 0.7) * 1.5) +
        Math.sin(c.y * 0.5 - t * 0.8 + Math.sin(c.x * 0.25 - t * 0.5) * 1.2) +
        c.r * 0.8 -
        0.4;
      let k = v < -1.3 ? 0 : v < -0.25 ? 1 : v < 0.8 ? 2 : v < 1.6 ? 3 : 4;
      if (c.edge === 1) k = Math.max(k, 3); // bord incandescent côté passerelle
      else if (c.edge === 2) k = Math.min(k, 1); // croûte contre les garde-corps
      const col = LAVA[k];
      d[c.i] = col[0];
      d[c.i + 1] = col[1];
      d[c.i + 2] = col[2];
      d[c.i + 3] = 255;
    }
    s.g.putImageData(s.img, 0, 0);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, s.box.x0 * P, s.box.y0 * P, s.canvas.width * P, s.canvas.height * P);

  // --- Lueur pulsante au-dessus des fosses et braises qui s'envolent
  ctx.globalCompositeOperation = 'lighter';
  m.pits.forEach((p, n) => {
    const cx = ((p.x0 + p.x1) / 2) * P;
    const cy = ((p.y0 + p.y1) / 2) * P;
    const rad = Math.max(p.x1 - p.x0, p.y1 - p.y0) * P * 0.9;
    const a = 0.1 + 0.05 * Math.sin(time * 1.7 + n * 1.9);
    const grad = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
    grad.addColorStop(0, `rgba(255,96,24,${a})`);
    grad.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);

    for (let e = 0; e < 9; e++) {
      const life = 2.2 + hash(e, n, 71) * 1.4;
      const u = (time / life + hash(e, n, 72)) % 1;
      const ex = (p.x0 + hash(e, n, 73) * (p.x1 - p.x0)) * P + Math.sin(time * 2 + e) * 6;
      const ey = (p.y0 + hash(e, n, 74) * (p.y1 - p.y0)) * P - u * 110;
      if (!m.lava[Math.floor((ey + u * 110) / P) * m.w + Math.floor(ex / P)]) continue;
      ctx.fillStyle = u < 0.5 ? `rgba(255,190,80,${1 - u})` : `rgba(255,100,30,${1 - u})`;
      const sz = u < 0.6 ? 4 : 3;
      ctx.fillRect(Math.round(ex / 2) * 2, Math.round(ey / 2) * 2, sz, sz);
    }
  });
  ctx.restore();
}

export const VOLCANO_THEME: MapTheme = {
  pixel: P,
  renderFloor,
  renderWalls,
  drawLive,
};
