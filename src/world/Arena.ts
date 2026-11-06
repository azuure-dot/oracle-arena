import { clamp } from '../core/math';
import { COLORS, WORLD, ZONES, teamColor } from '../config';
import type { Team } from '../entities/Team';
import { getLang, t } from '../i18n';
import type { MapDef, SafeZone } from './maps';

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

const boxHitsRect = (x: number, y: number, hw: number, hh: number, r: Rect): boolean =>
  x + hw > r.x && x - hw < r.x + r.w && y + hh > r.y && y - hh < r.y + r.h;

/**
 * La map : bords, murs, zones spéciales, zones de spawn protégées et rendu du sol.
 * Le contenu vient d'une MapDef (src/world/maps.ts).
 */
export class Arena {
  readonly width: number;
  readonly height: number;
  readonly walls: Rect[];
  /** Eau : bloque les déplacements, pas la vue ni les tirs. */
  readonly water: Rect[];
  readonly zones: Zone[];
  /** Zones de spawn protégées (peuvent changer en cours de partie : Escorte). */
  safeZones: SafeZone[];
  /** Obstacles mobiles (le convoi) : bloquent déplacements et projectiles, pas la vue. */
  dynamicRects: Rect[] = [];

  /** Segments opaques (arêtes des murs + bords de la map) pour le raycasting. */
  readonly segments: Segment[];
  /** Sommets vers lesquels on lance les rayons de visibilité. */
  readonly corners: { x: number; y: number }[];

  private floorCache: HTMLCanvasElement | null = null;
  private floorLang = '';

  constructor(readonly map: MapDef) {
    this.width = map.width;
    this.height = map.height;
    this.walls = map.walls;
    this.water = map.water ?? [];
    this.zones = map.zones;
    this.safeZones = map.safeZones;

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
  }

  /**
   * Rectangles infranchissables pour une équipe : les murs + les zones de spawn adverses.
   * Sans équipe (bots du champ de tir), seulement les murs.
   */
  private blockers(team?: Team): Rect[] {
    const base =
      this.water.length || this.dynamicRects.length ? [...this.walls, ...this.water, ...this.dynamicRects] : this.walls;
    if (team === undefined || this.safeZones.length === 0) return base;
    return [...base, ...this.safeZones.filter((z) => z.team !== team).map((z) => z.rect)];
  }

  /** Change les zones de spawn protégées (Escorte : au passage du checkpoint). */
  setSafeZones(zones: SafeZone[]): void {
    this.safeZones = zones;
    this.floorCache = null; // le sol teinté des spawns est dans le cache
  }

  /** La boîte (centre x,y, demi-dimensions hw,hh) chevauche-t-elle un obstacle ou sort-elle de la map ? */
  boxCollides(x: number, y: number, hw: number, hh: number, team?: Team): boolean {
    if (x - hw < 0 || y - hh < 0 || x + hw > this.width || y + hh > this.height) return true;
    return this.blockers(team).some((w) => boxHitsRect(x, y, hw, hh, w));
  }

  /** Arrête les projectiles : murs et obstacles mobiles (pas l'eau). */
  pointInWall(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x > this.width || y > this.height) return true;
    return this.walls.some((w) => pointInRect(x, y, w)) || this.dynamicRects.some((w) => pointInRect(x, y, w));
  }

  /**
   * Repousse une boîte hors des obstacles et des bords, sur l'axe de plus petite
   * pénétration : le personnage "glisse" le long des murs.
   */
  resolveBox(pos: { x: number; y: number }, hw: number, hh: number, team?: Team): void {
    const blockers = this.blockers(team);
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const w of blockers) {
        const ox = Math.min(pos.x + hw, w.x + w.w) - Math.max(pos.x - hw, w.x);
        const oy = Math.min(pos.y + hh, w.y + w.h) - Math.max(pos.y - hh, w.y);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) pos.x += pos.x < w.x + w.w / 2 ? -ox : ox;
        else pos.y += pos.y < w.y + w.h / 2 ? -oy : oy;
        moved = true;
      }
      if (!moved) break;
    }
    pos.x = clamp(pos.x, hw, this.width - hw);
    pos.y = clamp(pos.y, hh, this.height - hh);
  }

  zoneAt(x: number, y: number): Zone | undefined {
    return this.zones.find((z) => pointInRect(x, y, z));
  }

  /** Zone de spawn qui contient ce point (s'il y en a une). */
  safeZoneAt(x: number, y: number): SafeZone | undefined {
    return this.safeZones.find((z) => pointInRect(x, y, z.rect));
  }

  // ---------------------------------------------------------------- rendu

  drawFloor(ctx: CanvasRenderingContext2D): void {
    // Le sol est mis en cache ; il contient des libellés traduits : on le refait si la langue change.
    if (!this.floorCache || this.floorLang !== getLang()) {
      this.floorCache = this.renderFloor();
      this.floorLang = getLang();
    }
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

    // eau (hachures bleues) et ses berges
    for (const w of this.water) {
      g.fillStyle = '#123a52';
      g.fillRect(w.x, w.y, w.w, w.h);
      g.save();
      g.beginPath();
      g.rect(w.x, w.y, w.w, w.h);
      g.clip();
      g.strokeStyle = 'rgba(120,200,240,0.18)';
      g.lineWidth = 6;
      for (let i = -w.h; i < w.w + w.h; i += 22) {
        g.beginPath();
        g.moveTo(w.x + i, w.y);
        g.lineTo(w.x + i - w.h, w.y + w.h);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(160,220,250,0.55)';
      g.lineWidth = 3;
      g.strokeRect(w.x + 1.5, w.y + 1.5, w.w - 3, w.h - 3);
    }

    // zones spéciales
    for (const z of this.zones) {
      const color = z.kind === 'hazard' ? '255,77,94' : '90,220,140';
      this.hatch(g, z, color);
      g.fillStyle = `rgba(${color},0.95)`;
      g.font = 'bold 14px system-ui, sans-serif';
      g.textAlign = 'center';
      const label =
        z.kind === 'hazard' ? t('zone.hazard', { n: ZONES.hazardDps }) : t('zone.heal', { n: ZONES.healHps });
      g.fillText(label, z.x + z.w / 2, z.y + z.h / 2 + 5);
    }

    // zones de spawn protégées : sol teinté à la couleur de l'équipe + portes en jaune
    for (const s of this.safeZones) {
      const r = s.rect;
      g.fillStyle = teamColor(s.team);
      g.globalAlpha = 0.1;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.globalAlpha = 1;
      g.strokeStyle = '#f5d742';
      g.lineWidth = 6;
      g.lineCap = 'round';
      for (const d of s.doors) {
        g.beginPath();
        g.moveTo(d.ax, d.ay);
        g.lineTo(d.bx, d.by);
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    // marqueur de spawn (champ de tir)
    const m = this.map.spawnMarker;
    if (m) {
      g.strokeStyle = 'rgba(255,179,71,0.35)';
      g.lineWidth = 3;
      g.setLineDash([8, 8]);
      g.beginPath();
      g.arc(m.x, m.y, 40, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    // bordure de map
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, this.width - 6, this.height - 6);

    return c;
  }

  private hatch(g: CanvasRenderingContext2D, z: Rect, color: string): void {
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
  }
}
