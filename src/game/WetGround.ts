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
 * Couleur : l'eau appartient à l'équipe qui l'a posée en dernier (comme dans Splatoon). Vue par
 * le joueur, l'eau de son équipe est bleue, celle de l'adversaire rouge : deux couches de
 * flaques, chacune avec son contour.
 *
 * Rendu : le contour des flaques est calculé 10 fois par seconde (« marching squares »
 * sur le niveau d'eau des cases, interpolé entre leurs centres), puis dessiné en vectoriel
 * à chaque image : eau translucide et liseré clair, aux bords nets et lisses quel que soit
 * le zoom (pas d'image agrandie, donc pas de flou). Une case qui sèche voit son niveau
 * baisser : la flaque rétrécit avant de disparaître.
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

/** Couleurs de l'eau : de l'équipe du joueur (bleue) et de l'adversaire (rouge). */
const PALETTE = {
  ally: { water: 'rgba(64,196,222,0.5)', rim: 'rgba(190,246,252,0.95)', shine: 'rgba(255,255,255,0.7)' },
  enemy: { water: 'rgba(232,70,92,0.48)', rim: 'rgba(255,196,204,0.95)', shine: 'rgba(255,235,238,0.7)' },
};

/** Formes d'une couche de flaques (coordonnées monde). */
interface Shapes {
  water: Path2D;
  rim: Path2D;
  shine: Path2D;
}
/**
 * Niveau d'eau (0..1, adouci entre cases voisines) à partir duquel le sol est dessiné
 * mouillé : le contour passe là. Une case isolée (niveau adouci 0,25) reste visible.
 */
const ISO = 0.2;

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
  /** Formes des flaques (coordonnées monde), recalculées 10 fois par seconde : eau de l'équipe du joueur, eau adverse. */
  private allyShapes: Shapes | null = null;
  private enemyShapes: Shapes | null = null;
  /** Équipe du joueur lors du dernier calcul des formes (null : pas de joueur, tout est bleu). */
  private viewTeam: Team | null = null;
  private shapesDirty = false;
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
    this.shapesDirty = true;
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
    this.shapesDirty = true;
  }

  update(dt: number, now: number): void {
    this.now = now;
    // L'eau sèche : on retire les cases expirées (10 fois/s suffit).
    this.redrawTimer -= dt;
    if (this.redrawTimer > 0) return;
    this.redrawTimer = 0.1;
    for (const i of this.active) if (this.until[i] <= now) this.active.delete(i);
    if (this.active.size || this.allyShapes || this.enemyShapes) this.shapesDirty = true; // l'eau s'estompe
  }

  /** `viewer` : équipe du joueur (son eau est bleue, celle des autres rouge) ; null = tout en bleu. */
  draw(ctx: CanvasRenderingContext2D, viewer: Team | null = null): void {
    if (viewer !== this.viewTeam) {
      this.viewTeam = viewer;
      this.shapesDirty = true;
    }
    if (this.shapesDirty) {
      this.shapesDirty = false;
      const mine = viewer === null ? -2 : this.teams.indexOf(viewer);
      this.allyShapes = this.buildShapes((o) => mine === -2 || o === mine);
      this.enemyShapes = mine === -2 ? null : this.buildShapes((o) => o !== mine);
    }
    if (this.enemyShapes) this.drawShapes(ctx, this.enemyShapes, PALETTE.enemy);
    if (this.allyShapes) this.drawShapes(ctx, this.allyShapes, PALETTE.ally);
  }

  private drawShapes(ctx: CanvasRenderingContext2D, s: Shapes, colors: (typeof PALETTE)['ally']): void {
    ctx.save();
    ctx.fillStyle = colors.water;
    ctx.fill(s.water);
    ctx.strokeStyle = colors.rim;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke(s.rim);
    ctx.fillStyle = colors.shine;
    ctx.fill(s.shine);
    ctx.restore();
  }

  /**
   * « Marching squares » : chaque carré relie les centres de 4 cases voisines. On garde la
   * partie du carré où le niveau d'eau dépasse ISO (polygone, avec des points interpolés sur
   * les côtés traversés) et on note les segments de contour pour le liseré.
   *
   * Le niveau d'eau est adouci (noyau 1-2-1 dans les deux sens) : le contour est arrondi au
   * lieu de suivre les marches de la grille. Tout se calcule sur le rectangle qui englobe
   * l'eau, dans des tableaux ; les carrés entièrement mouillés d'une même rangée sont
   * regroupés en une seule bande.
   *
   * `keep` : garde seulement les cases de certaines équipes (index dans `teams`) : une couche par couleur.
   */
  private buildShapes(keep: (owner: number) => boolean): Shapes | null {
    let any = false;
    for (const i of this.active) {
      if (keep(this.owner[i])) {
        any = true;
        break;
      }
    }
    if (!any) return null;
    const C = WET.cell;
    const cols = this.cols;
    const now = this.now;
    // Rectangle englobant (en cases), élargi de 2 pour l'adoucissement.
    let cmin = Infinity;
    let cmax = -Infinity;
    let rmin = Infinity;
    let rmax = -Infinity;
    for (const i of this.active) {
      if (!keep(this.owner[i])) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      if (c < cmin) cmin = c;
      if (c > cmax) cmax = c;
      if (r < rmin) rmin = r;
      if (r > rmax) rmax = r;
    }
    cmin -= 2;
    rmin -= 2;
    const w = cmax + 2 - cmin + 1;
    const h = rmax + 2 - rmin + 1;
    const raw = new Float32Array(w * h);
    const shine = new Path2D();
    for (const i of this.active) {
      if (!keep(this.owner[i])) continue;
      const left = this.until[i] - now;
      if (left <= 0) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      const v = Math.min(1, left / WET.fade);
      raw[(r - rmin) * w + (c - cmin)] = v;
      // Reflets fixes : un petit trait clair dans quelques cases bien mouillées
      if ((i * 7919) % 29 === 0 && v > 0.9) {
        const x = (c + 0.5) * C;
        const y = (r + 0.5) * C;
        shine.moveTo(x + 3, y);
        shine.ellipse(x, y, 3, 1.2, -0.35, 0, TAU);
      }
    }
    // Adoucissement séparable : horizontal puis vertical (1-2-1, total 16).
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        tmp[k] = (x > 0 ? raw[k - 1] : 0) + 2 * raw[k] + (x < w - 1 ? raw[k + 1] : 0);
      }
    const lv = raw; // réutilisé pour le niveau adouci
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        lv[k] = ((y > 0 ? tmp[k - w] : 0) + 2 * tmp[k] + (y < h - 1 ? tmp[k + w] : 0)) / 16;
      }

    const water = new Path2D();
    const rim = new Path2D();
    const px: number[] = [];
    const py: number[] = [];
    const isCross: boolean[] = [];
    const v = [0, 0, 0, 0];
    const inside = [false, false, false, false];
    for (let y = 0; y < h - 1; y++) {
      let run = -1; // début d'une bande de carrés entièrement mouillés
      const y0 = (rmin + y + 0.5) * C;
      const flush = (end: number) => {
        if (run < 0) return;
        const xa = (cmin + run + 0.5) * C;
        water.rect(xa, y0, (end - run) * C, C);
        run = -1;
      };
      for (let x = 0; x < w - 1; x++) {
        const k = y * w + x;
        v[0] = lv[k];
        v[1] = lv[k + 1];
        v[2] = lv[k + w + 1];
        v[3] = lv[k + w];
        let n = 0;
        for (let q = 0; q < 4; q++) {
          inside[q] = v[q] >= ISO;
          if (inside[q]) n++;
        }
        if (n === 4) {
          if (run < 0) run = x;
          continue;
        }
        flush(x);
        if (n === 0) continue;
        const x0 = (cmin + x + 0.5) * C;
        const cx = [x0, x0 + C, x0 + C, x0];
        const cy = [y0, y0, y0 + C, y0 + C];
        px.length = py.length = isCross.length = 0;
        for (let q = 0; q < 4; q++) {
          const m = (q + 1) % 4;
          if (inside[q]) {
            px.push(cx[q]);
            py.push(cy[q]);
            isCross.push(false);
          }
          if (inside[q] !== inside[m]) {
            // Point du côté où le niveau vaut exactement ISO (interpolation linéaire).
            const t = (ISO - v[q]) / (v[m] - v[q]);
            px.push(cx[q] + (cx[m] - cx[q]) * t);
            py.push(cy[q] + (cy[m] - cy[q]) * t);
            isCross.push(true);
          }
        }
        water.moveTo(px[0], py[0]);
        for (let q = 1; q < px.length; q++) water.lineTo(px[q], py[q]);
        water.closePath();
        // Contour : les côtés du polygone qui traversent le carré (entre deux points de passage).
        for (let q = 0; q < px.length; q++) {
          const m = (q + 1) % px.length;
          if (!isCross[q] || !isCross[m]) continue;
          rim.moveTo(px[q], py[q]);
          rim.lineTo(px[m], py[m]);
        }
      }
      flush(w - 1);
    }
    return { water, rim, shine };
  }
}
