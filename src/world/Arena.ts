import { clamp } from '../core/math';
import { COLORS, PLAYER_SPAWN, WORLD, ZONES } from '../config';
import { onLangChange, t } from '../i18n';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export type ZoneKind = 'hazard' | 'heal';

export interface Zone extends Rect {
  kind: ZoneKind;
}

export const pointInRect = (px: number, py: number, r: Rect): boolean =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** La map : bords, murs, zones spéciales et rendu du sol. */
export class Arena {
  readonly width = WORLD.width;
  readonly height = WORLD.height;

  readonly walls: Rect[] = [
    { x: 560, y: 200, w: 50, h: 360 }, // A : couvert gauche haut
    { x: 560, y: 760, w: 50, h: 340 }, // B : couvert gauche bas (passage y 560-760 entre A et B)
    { x: 880, y: 400, w: 280, h: 50 }, // C : salle centrale, mur haut
    { x: 880, y: 850, w: 280, h: 50 }, // D : salle centrale, mur bas
    { x: 1110, y: 450, w: 50, h: 140 }, // E : salle centrale, droite (haut)
    { x: 1110, y: 710, w: 50, h: 140 }, // F : salle centrale, droite (bas) → porte y 590-710
    { x: 1450, y: 170, w: 320, h: 50 }, // G : barre haute droite
    { x: 1450, y: 1080, w: 320, h: 50 }, // H : barre basse droite
    { x: 1760, y: 480, w: 50, h: 340 }, // I : mur du fond (idéal pour épingler à la Charge)
  ];

  readonly zones: Zone[] = [
    { kind: 'hazard', x: 110, y: 110, w: 220, h: 170 },
    { kind: 'heal', x: 110, y: 1020, w: 220, h: 170 },
  ];

  /** Segments opaques (arêtes des murs + bords de la map) pour le raycasting. */
  readonly segments: Segment[];
  /** Sommets vers lesquels on lance les rayons de visibilité. */
  readonly corners: { x: number; y: number }[];

  private floorCache: HTMLCanvasElement | null = null;

  constructor() {
    const rects: Rect[] = [{ x: 0, y: 0, w: this.width, h: this.height }, ...this.walls];
    this.segments = [];
    this.corners = [];
    for (const r of rects) {
      const pts = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        this.segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
      this.corners.push(...pts);
    }
    // Les libellés des zones sont dessinés dans le sol mis en cache : on le régénère.
    onLangChange(() => (this.floorCache = null));
  }

  /** Le cercle chevauche-t-il un mur ou sort-il de la map ? */
  circleCollides(x: number, y: number, r: number): boolean {
    if (x - r < 0 || y - r < 0 || x + r > this.width || y + r > this.height) return true;
    for (const w of this.walls) {
      const cx = clamp(x, w.x, w.x + w.w);
      const cy = clamp(y, w.y, w.y + w.h);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  pointInWall(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x > this.width || y > this.height) return true;
    return this.walls.some((w) => pointInRect(x, y, w));
  }

  /**
   * Repousse un cercle hors des murs et des bords (résolution par plus petite
   * pénétration). Le joueur "glisse" ainsi le long des murs.
   */
  resolveCircle(pos: { x: number; y: number }, r: number): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const w of this.walls) {
        const cx = clamp(pos.x, w.x, w.x + w.w);
        const cy = clamp(pos.y, w.y, w.y + w.h);
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;

        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.y += (dy / d) * push;
        } else {
          // Centre à l'intérieur du rectangle : on sort par le côté le plus proche.
          const left = pos.x - w.x;
          const right = w.x + w.w - pos.x;
          const top = pos.y - w.y;
          const bottom = w.y + w.h - pos.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = w.x - r;
          else if (m === right) pos.x = w.x + w.w + r;
          else if (m === top) pos.y = w.y - r;
          else pos.y = w.y + w.h + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    pos.x = clamp(pos.x, r, this.width - r);
    pos.y = clamp(pos.y, r, this.height - r);
  }

  zoneAt(x: number, y: number): Zone | undefined {
    return this.zones.find((z) => pointInRect(x, y, z));
  }

  // ---------------------------------------------------------------- rendu

  drawFloor(ctx: CanvasRenderingContext2D): void {
    if (!this.floorCache) this.floorCache = this.renderFloor();
    ctx.drawImage(this.floorCache, 0, 0);
  }

  drawWalls(ctx: CanvasRenderingContext2D): void {
    for (const w of this.walls) {
      // ombre portée
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(w.x + 8, w.y + 10, w.w, w.h);
      // corps
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      // dessus légèrement plus clair
      ctx.fillStyle = COLORS.wallTop;
      ctx.fillRect(w.x + 4, w.y + 4, w.w - 8, w.h - 8);
      ctx.strokeStyle = COLORS.wallEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }
  }

  private renderFloor(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const g = c.getContext('2d')!;

    g.fillStyle = COLORS.floor;
    g.fillRect(0, 0, this.width, this.height);

    // quadrillage
    const step = WORLD.gridSize;
    for (let x = 0; x <= this.width; x += step) {
      g.strokeStyle = x % (step * 5) === 0 ? COLORS.gridMajor : COLORS.gridMinor;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, this.height);
      g.stroke();
    }
    for (let y = 0; y <= this.height; y += step) {
      g.strokeStyle = y % (step * 5) === 0 ? COLORS.gridMajor : COLORS.gridMinor;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(this.width, y + 0.5);
      g.stroke();
    }

    // zones spéciales
    for (const z of this.zones) {
      const color = z.kind === 'hazard' ? '255,77,94' : '90,220,140';
      g.fillStyle = `rgba(${color},0.10)`;
      g.fillRect(z.x, z.y, z.w, z.h);
      g.save();
      g.beginPath();
      g.rect(z.x, z.y, z.w, z.h);
      g.clip();
      g.strokeStyle = `rgba(${color},0.18)`;
      g.lineWidth = 10;
      for (let i = -z.h; i < z.w + z.h; i += 28) {
        g.beginPath();
        g.moveTo(z.x + i, z.y);
        g.lineTo(z.x + i - z.h, z.y + z.h);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = `rgba(${color},0.7)`;
      g.lineWidth = 2;
      g.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
      g.fillStyle = `rgba(${color},0.95)`;
      g.font = 'bold 14px system-ui, sans-serif';
      g.textAlign = 'center';
      const label =
        z.kind === 'hazard' ? t('zone.hazard', { n: ZONES.hazardDps }) : t('zone.heal', { n: ZONES.healHps });
      g.fillText(label, z.x + z.w / 2, z.y + z.h / 2 + 5);
    }

    // marqueur de spawn
    g.strokeStyle = 'rgba(255,179,71,0.35)';
    g.lineWidth = 3;
    g.setLineDash([8, 8]);
    g.beginPath();
    g.arc(PLAYER_SPAWN.x, PLAYER_SPAWN.y, 40, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    // bordure de map
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, this.width - 6, this.height - 6);

    return c;
  }
}
