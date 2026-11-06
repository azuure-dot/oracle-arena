import { COLORS } from '../config';
import type { Team } from './Team';

export type ProjectileStyle = 'bullet' | 'sonic' | 'fire' | 'enemy';

export interface ProjectileSpec {
  x: number;
  y: number;
  angle: number;
  speed: number;
  damage: number;
  team: Team;
  range: number;
  radius?: number;
  /** Traverse les cibles (chacune n'est touchée qu'une fois). S'arrête quand même sur les murs. */
  pierce?: boolean;
  style?: ProjectileStyle;
}

export class Projectile {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly damage: number;
  readonly team: Team;
  readonly maxRange: number;
  readonly radius: number;
  readonly pierce: boolean;
  readonly style: ProjectileStyle;
  /** Cibles déjà touchées (projectiles perforants). */
  readonly hits = new Set<object>();
  traveled = 0;
  dead = false;

  constructor(spec: ProjectileSpec) {
    this.x = spec.x;
    this.y = spec.y;
    this.vx = Math.cos(spec.angle) * spec.speed;
    this.vy = Math.sin(spec.angle) * spec.speed;
    this.damage = spec.damage;
    this.team = spec.team;
    this.maxRange = spec.range;
    this.radius = spec.radius ?? 2;
    this.pierce = spec.pierce ?? false;
    this.style = spec.style ?? 'bullet';
  }

  get color(): string {
    switch (this.style) {
      case 'sonic':
        return COLORS.sonic;
      case 'fire':
        return COLORS.fire;
      case 'enemy':
        return COLORS.enemyBullet;
      default:
        return COLORS.bullet;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const speed = Math.hypot(this.vx, this.vy);
    const dx = this.vx / speed;
    const dy = this.vy / speed;

    switch (this.style) {
      case 'bullet': {
        const tail = 22;
        const grad = ctx.createLinearGradient(this.x - dx * tail, this.y - dy * tail, this.x, this.y);
        grad.addColorStop(0, 'rgba(255,227,154,0)');
        grad.addColorStop(1, COLORS.bullet);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.x - dx * tail, this.y - dy * tail);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
        ctx.lineCap = 'butt';
        break;
      }
      case 'sonic': {
        ctx.fillStyle = 'rgba(91,227,125,0.25)';
        ctx.beginPath();
        ctx.arc(this.x - dx * 8, this.y - dy * 8, this.radius * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d9ffe3';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.sonic;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'fire': {
        const r = this.radius;
        for (let i = 3; i >= 1; i--) {
          ctx.globalAlpha = 0.18 * i;
          ctx.fillStyle = COLORS.fire;
          ctx.beginPath();
          ctx.arc(this.x - dx * i * 14, this.y - dy * i * 14, r * (1 - i * 0.15), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, r);
        g.addColorStop(0, '#fff3c4');
        g.addColorStop(0.45, '#ffb347');
        g.addColorStop(1, 'rgba(255,90,40,0.15)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'enemy': {
        ctx.fillStyle = 'rgba(255,77,94,0.3)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd0d5';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
}
