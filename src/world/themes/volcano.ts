import { LINE } from '../../render/topdown';
import type { Arena, Rect, WallRect } from '../Arena';
import type { Decor, MapShape } from '../maps';
import type { MapTheme } from './index';

/**
 * VOLCAN — habillage vectoriel vu de dessus, dans le style des personnages : aplats, contour
 * d'encre sombre, lumière fixe venant du haut à gauche (bords éclairés en haut / à gauche,
 * ombrés en bas / à droite), ombres portées au sol.
 *
 * - Sol (image en cache, 1 px = 2 unités, adoucie) : basalte cendré, taches, fissures, cratère
 *   roussi autour du point, lueur des fosses, tôles du camp, héliport, ombres des murs.
 * - Murs (dessinés à chaque image, nets à tout zoom, seulement ceux à l'écran) : roche volcanique
 *   veinée de lave, bâtiments en tôle rivetée, mobilier blanc du labo, garde-corps rayés jaune et
 *   noir ; chaque famille est dessinée d'un seul tenant (contour d'encre continu, sans couture
 *   entre deux rectangles voisins). Arcs du point et cuves : formes rondes.
 * - Animé (sous les entités) : lave qui bouillonne dans les fosses, plateforme du point.
 */

const PIXEL = 2;

type Group = 'rock' | 'building' | 'lab' | 'barrier';
const GROUPS: Group[] = ['rock', 'building', 'lab', 'barrier'];

const PALETTE: Record<Group, { top: string; light: string; shade: string }> = {
  rock: { top: '#281f24', light: '#55444c', shade: '#150f13' },
  building: { top: '#6b7383', light: '#8f98a8', shade: '#4a515d' },
  lab: { top: '#d5dae2', light: '#f1f3f7', shade: '#a2aab7' },
  barrier: { top: '#f2c14e', light: '#ffe08a', shade: '#b8861c' },
};

const GROUND = '#5b4c4f';
const LAVA = { base: '#ec4a17', hot: '#ffd23f', mid: '#ff8a1f', dark: '#8f1d08' };

/** Bord d'une union de rectangles (côté du vide : haut, bas, gauche, droite). */
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

interface Pit {
  outer: Rect[];
  edges: Edge[];
  box: Rect;
  x: number;
  y: number;
  r: number;
  blobs: { ox: number; oy: number; rad: number; sp: number; ph: number }[];
}

type Arc = Extract<MapShape, { kind: 'arc' }>;

interface Prep {
  groups: Record<Group, { rects: WallRect[]; edges: Edge[] }>;
  veins: { box: Rect; pts: number[] }[];
  pits: Pit[];
  arcs: Arc[];
  tanks: Decor[];
}

const prepCache = new WeakMap<Arena, Prep>();

/** Pseudo-hasard déterministe (même décor à chaque partie). */
function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Bords extérieurs d'une union de rectangles (grille compressée sur leurs coordonnées). */
function unionEdges(rects: Rect[]): Edge[] {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const W = xs.length - 1;
  const H = ys.length - 1;
  const full = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < W; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h)) full[j * W + i] = 1;
    }
  }
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && full[j * W + i] === 1;
  const edges: Edge[] = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) edges.push({ x1: xs[i], y1: ys[j], x2: xs[i + 1], y2: ys[j], side: 'top' });
      if (!at(i, j + 1)) edges.push({ x1: xs[i], y1: ys[j + 1], x2: xs[i + 1], y2: ys[j + 1], side: 'bottom' });
      if (!at(i - 1, j)) edges.push({ x1: xs[i], y1: ys[j], x2: xs[i], y2: ys[j + 1], side: 'left' });
      if (!at(i + 1, j)) edges.push({ x1: xs[i + 1], y1: ys[j], x2: xs[i + 1], y2: ys[j + 1], side: 'right' });
    }
  return edges;
}

function bbox(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

function prep(arena: Arena): Prep {
  let p = prepCache.get(arena);
  if (p) return p;
  const groups = {} as Prep['groups'];
  for (const g of GROUPS) {
    const rects = arena.walls.filter((w) => (w.style ?? 'rock') === g);
    groups[g] = { rects, edges: unionEdges(rects) };
  }
  // Veines de lave dans la roche : petites lignes brisées, plus nombreuses dans les grands blocs.
  const rnd = seeded(4242);
  const veins: Prep['veins'] = [];
  for (const r of groups.rock.rects) {
    const n = Math.min(18, Math.floor((r.w * r.h) / 45000));
    for (let k = 0; k < n; k++) {
      let x = r.x + 30 + rnd() * Math.max(1, r.w - 60);
      let y = r.y + 30 + rnd() * Math.max(1, r.h - 60);
      const pts = [x, y];
      let a = rnd() * Math.PI * 2;
      const steps = 4 + Math.floor(rnd() * 3);
      for (let s = 0; s < steps; s++) {
        a += (rnd() - 0.5) * 1.4;
        x = Math.max(r.x + 14, Math.min(r.x + r.w - 14, x + Math.cos(a) * (30 + rnd() * 40)));
        y = Math.max(r.y + 14, Math.min(r.y + r.h - 14, y + Math.sin(a) * (30 + rnd() * 40)));
        pts.push(x, y);
      }
      const px = pts.filter((_, i) => i % 2 === 0);
      const py = pts.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...px);
      const y0 = Math.min(...py);
      veins.push({ box: { x: x0, y: y0, w: Math.max(...px) - x0, h: Math.max(...py) - y0 }, pts });
    }
  }
  const shapes = arena.map.shapes ?? [];
  const pits: Pit[] = shapes
    .filter((s): s is Extract<MapShape, { kind: 'pit' }> => s.kind === 'pit')
    .map((s, i) => {
      const box = bbox(s.outer);
      const r2 = seeded(97 + i * 31);
      const blobs = Array.from({ length: 7 }, () => ({
        ox: box.x + r2() * box.w,
        oy: box.y + r2() * box.h,
        rad: 50 + r2() * 70,
        sp: 0.25 + r2() * 0.35,
        ph: r2() * 6.28,
      }));
      return { outer: s.outer, edges: unionEdges(s.outer), box, x: s.x, y: s.y, r: s.r, blobs };
    });
  p = {
    groups,
    veins,
    pits,
    arcs: shapes.filter((s): s is Arc => s.kind === 'arc'),
    tanks: (arena.map.decor ?? []).filter((d) => d.kind === 'tank'),
  };
  prepCache.set(arena, p);
  return p;
}

/** Rectangle du monde visible à l'écran (d'après la transformation du contexte), avec une marge. */
function visibleRect(ctx: CanvasRenderingContext2D): Rect {
  const t = ctx.getTransform();
  return { x: -t.e / t.a - 60, y: -t.f / t.d - 60, w: ctx.canvas.width / t.a + 120, h: ctx.canvas.height / t.d + 120 };
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const edgeIn = (e: Edge, v: Rect) =>
  Math.max(e.x1, e.x2) >= v.x && Math.min(e.x1, e.x2) <= v.x + v.w && Math.max(e.y1, e.y2) >= v.y && Math.min(e.y1, e.y2) <= v.y + v.h;

function edgesPath(ctx: CanvasRenderingContext2D, edges: Edge[]): void {
  ctx.beginPath();
  for (const e of edges) {
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
  }
}
function rectsPath(ctx: CanvasRenderingContext2D, rects: Rect[]): void {
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.x, r.y, r.w, r.h);
}

/** Découpe à la forme d'une fosse : rectangles extérieurs moins le disque tourné vers le point. */
function clipPit(ctx: CanvasRenderingContext2D, pit: Pit): void {
  rectsPath(ctx, pit.outer);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(pit.box.x - 10, pit.box.y - 10, pit.box.w + 20, pit.box.h + 20);
  ctx.arc(pit.x, pit.y, pit.r, 0, Math.PI * 2);
  ctx.clip('evenodd');
}

// ------------------------------------------------------------------ sol (en cache)

function renderFloor(g: CanvasRenderingContext2D, arena: Arena): void {
  const p = prep(arena);
  g.setTransform(1 / PIXEL, 0, 0, 1 / PIXEL, 0, 0);
  const W = arena.width;
  const H = arena.height;
  g.fillStyle = GROUND;
  g.fillRect(0, 0, W, H);

  // Taches de cendre claires et sombres
  const rnd = seeded(1337);
  for (let i = 0; i < (W * H) / 9000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 30 + rnd() * 110;
    g.fillStyle = rnd() < 0.5 ? 'rgba(30,18,24,0.16)' : 'rgba(150,126,128,0.10)';
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Fissures
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < (W * H) / 40000; i++) {
    let x = rnd() * W;
    let y = rnd() * H;
    let a = rnd() * Math.PI * 2;
    g.strokeStyle = 'rgba(34,22,28,0.5)';
    g.lineWidth = 3 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 3 + Math.floor(rnd() * 4);
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 1.3;
      x += Math.cos(a) * (25 + rnd() * 35);
      y += Math.sin(a) * (25 + rnd() * 35);
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // Cratère roussi autour du point
  const c = arena.map.control;
  if (c) {
    const grad = g.createRadialGradient(c.x, c.y, c.r * 1.1, c.x, c.y, c.r * 2.4);
    grad.addColorStop(0, 'rgba(70,24,14,0.55)');
    grad.addColorStop(1, 'rgba(70,24,14,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c.x, c.y, c.r * 2.4, 0, Math.PI * 2);
    g.fill();
  }

  // Lueur orangée autour des fosses (pas dans l'anneau praticable entre la lave et le point)
  for (const pit of p.pits) {
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(pit.x, pit.y, pit.r, 0, Math.PI * 2);
    g.clip('evenodd');
    g.shadowColor = 'rgba(255,110,30,0.75)';
    g.shadowBlur = 40 / PIXEL;
    g.beginPath();
    for (const r of pit.outer) g.rect(r.x, r.y, r.w, r.h);
    g.fillStyle = 'rgba(255,90,30,0.55)';
    g.fill();
    g.restore();
  }

  // Tôles du camp (spawn, cour)
  for (const s of arena.map.shapes ?? []) {
    if (s.kind !== 'plates') continue;
    const r = s.rect;
    g.fillStyle = '#4f5562';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = '#3d424d';
    g.lineWidth = 4;
    const step = 96;
    g.beginPath();
    for (let x = r.x + step; x < r.x + r.w; x += step) {
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
    }
    for (let y = r.y + step; y < r.y + r.h; y += step) {
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
    }
    g.stroke();
    g.fillStyle = '#727a88';
    for (let x = r.x + 12; x < r.x + r.w; x += step)
      for (let y = r.y + 12; y < r.y + r.h; y += step) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
    g.strokeStyle = LINE;
    g.lineWidth = 6;
    g.strokeRect(r.x, r.y, r.w, r.h);
  }

  // Héliport
  for (const d of arena.map.decor ?? []) {
    if (d.kind !== 'helipad') continue;
    g.fillStyle = '#3b404a';
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#e9eef5';
    const s = d.r * 0.42;
    g.fillRect(d.x - s, d.y - s, s * 0.34, s * 2);
    g.fillRect(d.x + s * 0.66, d.y - s, s * 0.34, s * 2);
    g.fillRect(d.x - s, d.y - s * 0.17, s * 2, s * 0.34);
  }

  // Ombres portées des murs (vers le bas à droite), d'un seul tenant
  g.fillStyle = 'rgba(8,4,8,0.38)';
  g.beginPath();
  for (const w of arena.walls) g.rect(w.x + 12, w.y + 16, w.w, w.h);
  g.fill();
}

// ------------------------------------------------------------------ animé (sous les entités)

function drawLive(ctx: CanvasRenderingContext2D, arena: Arena, time: number): void {
  const p = prep(arena);
  const view = visibleRect(ctx);
  const c = arena.map.control;
  if (c && overlaps(view, { x: c.x - 240, y: c.y - 240, w: 480, h: 480 })) drawPlatform(ctx, c.x, c.y, 226);
  for (const pit of p.pits) if (overlaps(view, pit.box)) drawPit(ctx, pit, time);
}

/** Plateforme en tôle au-dessus du cratère, sous le point de contrôle. */
function drawPlatform(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.fillStyle = LINE;
  ctx.beginPath();
  ctx.arc(x, y, r + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#596170';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Caillebotis : anneaux et rayons
  ctx.strokeStyle = '#474e5b';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (const k of [0.8, 0.55, 0.3]) {
    ctx.moveTo(x + r * k, y);
    ctx.arc(x, y, r * k, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
    ctx.lineTo(x + Math.cos(a) * r * 0.97, y + Math.sin(a) * r * 0.97);
  }
  ctx.stroke();
  // Rivets et reflet (lumière en haut à gauche)
  ctx.fillStyle = '#8f98a8';
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rx = x + Math.cos(a) * r * 0.9;
    const ry = y + Math.sin(a) * r * 0.9;
    ctx.moveTo(rx + 4, ry);
    ctx.arc(rx, ry, 4, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(x, y, r - 8, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
}

/** Lave : bouillonnement (taches claires qui dérivent), croûte sombre au bord, rive d'encre. */
function drawPit(ctx: CanvasRenderingContext2D, pit: Pit, t: number): void {
  const b = pit.box;
  ctx.save();
  clipPit(ctx, pit);
  ctx.fillStyle = LAVA.base;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  for (const blob of pit.blobs) {
    const x = blob.ox + Math.sin(t * blob.sp + blob.ph) * 40;
    const y = blob.oy + Math.cos(t * blob.sp * 0.8 + blob.ph) * 30;
    const rad = blob.rad * (0.85 + Math.sin(t * 1.3 + blob.ph) * 0.15);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, LAVA.hot);
    grad.addColorStop(0.45, LAVA.mid);
    grad.addColorStop(1, 'rgba(236,74,23,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // Croûte qui fonce le bord : extérieur de la fosse et bord arrondi
  ctx.strokeStyle = LAVA.dark;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 26;
  edgesPath(ctx, pit.edges);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pit.x, pit.y, pit.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rive : trait d'encre le long du bord arrondi, filet lumineux juste à l'intérieur
  ctx.save();
  rectsPath(ctx, pit.outer);
  ctx.clip();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(pit.x, pit.y, pit.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,200,90,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pit.x, pit.y, pit.r + 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ murs (chaque image)

function drawWalls(ctx: CanvasRenderingContext2D, arena: Arena): void {
  const p = prep(arena);
  const view = visibleRect(ctx);
  ctx.save();
  ctx.lineJoin = 'miter';
  for (const g of GROUPS) {
    const { rects, edges } = p.groups[g];
    const vis = rects.filter((r) => overlaps(r, view));
    if (!vis.length) continue;
    const ve = edges.filter((e) => edgeIn(e, view));
    const pal = PALETTE[g];
    // 1. Contour d'encre (la moitié intérieure sera recouverte par l'aplat)
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 8;
    ctx.lineCap = 'square';
    edgesPath(ctx, ve);
    ctx.stroke();
    // 2. Aplat (union des rectangles : pas de couture)
    ctx.fillStyle = pal.top;
    rectsPath(ctx, vis);
    ctx.fill();
    // 3. Bords éclairés (haut, gauche) et ombrés (bas, droite), à l'intérieur seulement
    ctx.save();
    rectsPath(ctx, vis);
    ctx.clip();
    ctx.lineCap = 'butt';
    ctx.lineWidth = g === 'barrier' ? 4 : 14;
    ctx.strokeStyle = pal.light;
    edgesPath(ctx, ve.filter((e) => e.side === 'top' || e.side === 'left'));
    ctx.stroke();
    ctx.strokeStyle = pal.shade;
    edgesPath(ctx, ve.filter((e) => e.side === 'bottom' || e.side === 'right'));
    ctx.stroke();
    drawDetails(ctx, g, vis, p, view);
    ctx.restore();
  }
  for (const a of p.arcs) if (overlaps(view, { x: a.x - a.rOut, y: a.y - a.rOut, w: a.rOut * 2, h: a.rOut * 2 })) drawArc(ctx, a);
  for (const d of p.tanks) if (overlaps(view, { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 })) drawTank(ctx, d);
  ctx.restore();
}

/** Détails propres à chaque famille de murs (déjà découpés à leur forme). */
function drawDetails(ctx: CanvasRenderingContext2D, g: Group, rects: WallRect[], p: Prep, view: Rect): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (g === 'rock') {
    // Veines de lave : halo puis filet brillant
    for (const pass of [
      { w: 9, c: 'rgba(255,106,26,0.22)' },
      { w: 3, c: 'rgba(255,150,50,0.85)' },
    ]) {
      ctx.lineWidth = pass.w;
      ctx.strokeStyle = pass.c;
      ctx.beginPath();
      for (const v of p.veins) {
        if (!overlaps(v.box, view)) continue;
        ctx.moveTo(v.pts[0], v.pts[1]);
        for (let i = 2; i < v.pts.length; i += 2) ctx.lineTo(v.pts[i], v.pts[i + 1]);
      }
      ctx.stroke();
    }
    return;
  }
  if (g === 'barrier') {
    // Rayures de chantier en diagonale
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 7;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const r of rects) {
      for (let i = -r.h; i < r.w + r.h; i += 30) {
        ctx.moveTo(r.x + i, r.y);
        ctx.lineTo(r.x + i + r.h, r.y + r.h);
      }
    }
    ctx.stroke();
    return;
  }
  // Tôle (bâtiments) / panneaux (labo) : joints et rivets ; bande bleue au labo
  ctx.strokeStyle = g === 'lab' ? '#b4bcc8' : '#565e6b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const step = 64;
  for (const r of rects) {
    if (r.w >= r.h) {
      for (let x = r.x + step; x < r.x + r.w - 8; x += step) {
        ctx.moveTo(x, r.y + 8);
        ctx.lineTo(x, r.y + r.h - 8);
      }
    } else {
      for (let y = r.y + step; y < r.y + r.h - 8; y += step) {
        ctx.moveTo(r.x + 8, y);
        ctx.lineTo(r.x + r.w - 8, y);
      }
    }
  }
  ctx.stroke();
  if (g === 'lab') {
    ctx.fillStyle = '#4da3ff';
    for (const r of rects) {
      if (r.w >= r.h) ctx.fillRect(r.x + 6, r.y + r.h / 2 - 4, r.w - 12, 8);
      else ctx.fillRect(r.x + r.w / 2 - 4, r.y + 6, 8, r.h - 12);
    }
    return;
  }
  ctx.fillStyle = '#9aa3b3';
  ctx.beginPath();
  for (const r of rects) {
    for (const [x, y] of [
      [r.x + 14, r.y + 14],
      [r.x + r.w - 14, r.y + 14],
      [r.x + 14, r.y + r.h - 14],
      [r.x + r.w - 14, r.y + r.h - 14],
    ]) {
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** Mur en arc de cercle (béton) : couronne, joints, bords éclairé / ombré. */
function drawArc(ctx: CanvasRenderingContext2D, a: Arc): void {
  const path = () => {
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.rOut, a.a0, a.a1);
    ctx.arc(a.x, a.y, a.rIn, a.a1, a.a0, true);
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 8;
  path();
  ctx.stroke();
  ctx.fillStyle = '#939bab';
  ctx.fill();
  ctx.clip();
  // Joints entre les blocs
  ctx.strokeStyle = '#5c6372';
  ctx.lineWidth = 4;
  const n = Math.max(2, Math.round(((a.a1 - a.a0) * a.rOut) / 70));
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const t = a.a0 + ((a.a1 - a.a0) * i) / n;
    ctx.moveTo(a.x + Math.cos(t) * a.rIn, a.y + Math.sin(t) * a.rIn);
    ctx.lineTo(a.x + Math.cos(t) * a.rOut, a.y + Math.sin(t) * a.rOut);
  }
  ctx.stroke();
  // Bord extérieur éclairé s'il regarde vers le haut, ombré sinon (et l'inverse à l'intérieur)
  const up = Math.sin((a.a0 + a.a1) / 2) < 0;
  ctx.lineWidth = 8;
  ctx.strokeStyle = up ? '#a2abba' : '#4d5462';
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.rOut, a.a0, a.a1);
  ctx.stroke();
  ctx.strokeStyle = up ? '#4d5462' : '#a2abba';
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.rIn, a.a0, a.a1);
  ctx.stroke();
  ctx.restore();
}

/** Cuve ronde vue de dessus : couvercle cerclé, rivets, trappe rayée, reflet. */
function drawTank(ctx: CanvasRenderingContext2D, d: Decor): void {
  const { x, y, r } = d;
  ctx.save();
  ctx.fillStyle = LINE;
  ctx.beginPath();
  ctx.arc(x, y, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a93a3';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#646c7b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#b6bdca';
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rx = x + Math.cos(a) * r * 0.89;
    const ry = y + Math.sin(a) * r * 0.89;
    ctx.moveTo(rx + 3.5, ry);
    ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
  }
  ctx.fill();
  // Trappe centrale rayée
  ctx.fillStyle = '#f2c14e';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = -r; i < r; i += 14) {
    ctx.moveTo(x + i, y - r * 0.4);
    ctx.lineTo(x + i + r * 0.4, y + r * 0.4);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(x, y, r - 9, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
}

export const VOLCANO_THEME: MapTheme = {
  pixel: PIXEL,
  smooth: true,
  renderFloor,
  drawWalls,
  drawLive,
  dispose(arena: Arena): void {
    prepCache.delete(arena);
  },
};
