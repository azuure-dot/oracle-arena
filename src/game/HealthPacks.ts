import { COLORS } from '../config';
import { circleIntersectsBox } from '../core/geometry';
import type { Vec2 } from '../core/math';
import type { Effects } from '../effects/Effects';
import type { Hero } from '../heroes/Hero';

export const HEALTH_PACK = {
  heal: 200,
  /** Temps avant réapparition après utilisation (s). */
  respawn: 10,
  radius: 18,
};

interface Pack extends Vec2 {
  cooldown: number;
}

/** Packs de soin au sol : +200 PV au premier héros blessé qui passe dessus. */
export class HealthPacks {
  private readonly packs: Pack[];

  constructor(points: readonly Vec2[]) {
    this.packs = points.map((p) => ({ x: p.x, y: p.y, cooldown: 0 }));
  }

  reset(): void {
    for (const p of this.packs) p.cooldown = 0;
  }

  /** Packs disponibles (pour l'IA). */
  available(): Vec2[] {
    return this.packs.filter((p) => p.cooldown <= 0);
  }

  update(dt: number, heroes: readonly Hero[], effects: Effects): void {
    for (const p of this.packs) {
      if (p.cooldown > 0) {
        p.cooldown = Math.max(0, p.cooldown - dt);
        continue;
      }
      // Un héros à fond de PV ne gaspille pas le pack.
      const taker = heroes.find(
        (h) => h.alive && h.hp < h.maxHp && circleIntersectsBox(p.x, p.y, HEALTH_PACK.radius, h.box()),
      );
      if (!taker) continue;
      taker.heal(HEALTH_PACK.heal);
      p.cooldown = HEALTH_PACK.respawn;
      effects.ring(p.x, p.y, COLORS.recall, 46, 0.35);
      effects.sparks(taker.x, taker.y, COLORS.recall, 12, 200);
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    for (const p of this.packs) {
      const ready = p.cooldown <= 0;
      const r = HEALTH_PACK.radius;
      ctx.save();
      // Socle
      ctx.fillStyle = 'rgba(10,14,20,0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      ctx.fill();
      if (ready) {
        // Halo qui pulse + croix
        const pulse = 0.5 + 0.5 * Math.sin(time * 4 + p.x);
        ctx.fillStyle = COLORS.recall;
        ctx.globalAlpha = 0.18 + 0.12 * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8 + pulse * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e9fbff';
        ctx.fillRect(p.x - 3.5, p.y - 11, 7, 22);
        ctx.fillRect(p.x - 11, p.y - 3.5, 22, 7);
      } else {
        // Recharge : croix éteinte + anneau de progression
        ctx.fillStyle = 'rgba(127,216,255,0.25)';
        ctx.fillRect(p.x - 3.5, p.y - 11, 7, 22);
        ctx.fillRect(p.x - 11, p.y - 3.5, 22, 7);
        ctx.strokeStyle = COLORS.recall;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const done = 1 - p.cooldown / HEALTH_PACK.respawn;
        ctx.arc(p.x, p.y, r + 2, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
