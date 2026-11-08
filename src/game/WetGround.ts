import { TAU } from '../core/math';
import type { Team } from '../entities/Team';
import type { Arena } from '../world/Arena';

/**
 * Sol mouillé (Turty) : une grille de cases de CELL unités. Chaque case retient
 * l'instant où elle sèche ; mouiller une case relance ses 15 s.
 * L'eau sert à toutes les Turty, quelle que soit leur équipe (vitesse en tortue). Chaque case
 * retient aussi l'équipe qui l'a mouillée en dernier : les alliés de cette équipe y
 * récupèrent leur soin passif plus tôt (WET.regenDelay).
 *
 * Rendu : une petite image (1 pixel = 1 case) mise à jour seulement là où l'eau
 * change, puis agrandie sans lissage : des flaques en gros pixels, dans le style du jeu.
 */
export const WET = {
  /** Durée d'une case mouillée (s). */
  duration: 15,
  /** Les dernières secondes, la flaque s'estompe. */
  fade: 3,
  cell: 8,
  /** Sur l'eau de son équipe, le soin passif démarre après ce délai sans dégâts. */
  regenDelay: 0.5,
};

const WATER = [64, 196, 222];
const RIM = [170, 240, 248];
const DEEP = [30, 120, 150];

export class WetGround {
  private readonly cols: number;
  private readonly rows: number;
  /** Instant (temps de jeu) où chaque case sèche ; 0 = sèche. */
  private readonly until: Float32Array;
  /** Équipe qui a mouillé chaque case en dernier (index dans `teams`, -1 = aucune). */
  private readonly owner: Int16Array;
  private readonly teams: Team[] = [];
  /** Cases où l'eau ne tient pas (murs, lave). */
  private readonly blocked: Uint8Array;
  /** Cases mouillées en ce moment (à faire sécher / redessiner). */
  private readonly active = new Set<number>();
  private canvas: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private dirty = false;
  private redrawTimer = 0;
  /** Temps de jeu de la dernière mise à jour (pour l'estompage). */
  private now = 0;

  constructor(arena: Arena) {
    this.cols = Math.ceil(arena.width / WET.cell);
    this.rows = Math.ceil(arena.height / WET.cell);
    this.until = new Float32Array(this.cols * this.rows);
    this.owner = new Int16Array(this.cols * this.rows).fill(-1);
    this.blocked = new Uint8Array(this.cols * this.rows);
    // Murs, lave et eau de la carte (pas le convoi, qui bouge) : cases dont le centre est dedans.
    for (const rect of [...arena.walls, ...arena.lava, ...arena.water]) {
      const c0 = Math.max(0, Math.ceil(rect.x / WET.cell - 0.5));
      const c1 = Math.min(this.cols - 1, Math.floor((rect.x + rect.w) / WET.cell - 0.5));
      const r0 = Math.max(0, Math.ceil(rect.y / WET.cell - 0.5));
      const r1 = Math.min(this.rows - 1, Math.floor((rect.y + rect.h) / WET.cell - 0.5));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[r * this.cols + c] = 1;
    }
  }

  /** Mouille un disque (bord un peu irrégulier, comme une éclaboussure) au nom d'une équipe. */
  splash(x: number, y: number, radius: number, now: number, team: Team): void {
    let ti = this.teams.indexOf(team);
    if (ti < 0) ti = this.teams.push(team) - 1;
    const C = WET.cell;
    const c0 = Math.max(0, Math.floor((x - radius) / C));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius) / C));
    const r0 = Math.max(0, Math.floor((y - radius) / C));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius) / C));
    const until = now + WET.duration;
    // Bord en lobes doux (forme de flaque), différent à chaque éclaboussure.
    const s1 = Math.random() * TAU;
    const s2 = Math.random() * TAU;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.blocked[i]) continue;
        const cx = (c + 0.5) * C;
        const cy = (r + 0.5) * C;
        const a = Math.atan2(cy - y, cx - x);
        const wobble = 1 + 0.1 * Math.sin(3 * a + s1) + 0.06 * Math.sin(5 * a + s2);
        if (Math.hypot(cx - x, cy - y) > radius * wobble) continue;
        if (this.until[i] < until) this.until[i] = until;
        this.owner[i] = ti;
        this.active.add(i);
      }
    }
    this.dirty = true;
  }

  isWet(x: number, y: number, now: number): boolean {
    const c = Math.floor(x / WET.cell);
    const r = Math.floor(y / WET.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.until[r * this.cols + c] > now;
  }

  /** Mouillé, et par cette équipe (dernière à y avoir mis de l'eau) ? */
  isWetFor(x: number, y: number, now: number, team: Team): boolean {
    const c = Math.floor(x / WET.cell);
    const r = Math.floor(y / WET.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    const i = r * this.cols + c;
    return this.until[i] > now && this.teams[this.owner[i]] === team;
  }

  /** Part de cases mouillées autour d'un point (0..1) : l'IA s'en sert pour choisir sa forme. */
  wetness(x: number, y: number, radius: number, now: number): number {
    let n = 0;
    let wet = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * radius;
      const py = y + Math.sin((a / 8) * Math.PI * 2) * radius;
      n++;
      if (this.isWet(px, py, now)) wet++;
    }
    return wet / n;
  }

  clear(): void {
    for (const i of this.active) this.until[i] = 0;
    this.active.clear();
    this.dirty = true;
  }

  update(dt: number, now: number): void {
    // L'eau sèche : on retire les cases expirées et on rafraîchit l'estompage (10 fois/s suffit).
    this.redrawTimer -= dt;
    if (this.redrawTimer > 0 && !this.dirty) return;
    this.redrawTimer = 0.1;
    if (this.active.size) this.dirty = true;
    for (const i of this.active) if (this.until[i] <= now) this.active.delete(i);
    this.now = now;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.dirty && !this.active.size && !this.canvas) return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.cols;
      this.canvas.height = this.rows;
      this.image = this.canvas.getContext('2d')!.createImageData(this.cols, this.rows);
    }
    if (this.dirty) this.repaint();
    if (!this.active.size) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, 0, 0, this.cols * WET.cell, this.rows * WET.cell);
    ctx.restore();
  }

  private repaint(): void {
    const img = this.image!;
    const d = img.data;
    d.fill(0);
    const now = this.now;
    const cols = this.cols;
    for (const i of this.active) {
      const left = this.until[i] - now;
      if (left <= 0) continue;
      const fade = Math.min(1, left / WET.fade);
      // Bord haut de la flaque plus clair (reflet), bord bas plus sombre, le reste en eau translucide.
      const up = i - cols;
      const down = i + cols;
      const rim = up < 0 || !(this.until[up] > now);
      const edge = !rim && (down >= this.until.length || !(this.until[down] > now));
      const col = rim ? RIM : edge ? DEEP : WATER;
      const k = i * 4;
      d[k] = col[0];
      d[k + 1] = col[1];
      d[k + 2] = col[2];
      d[k + 3] = Math.round((rim ? 140 : edge ? 150 : 100) * fade);
    }
    this.canvas!.getContext('2d')!.putImageData(img, 0, 0);
    this.dirty = false;
  }
}
