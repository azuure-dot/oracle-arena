import { randRange } from '../core/math';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface DamageNumber {
  x: number;
  y: number;
  amount: number;
  life: number;
  crit: boolean;
}

interface Afterimage {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

/** Secteur de cercle (coup de marteau, onde de choc). */
interface Wedge {
  x: number;
  y: number;
  angle: number;
  halfArc: number;
  inner: number;
  outer: number;
  life: number;
  maxLife: number;
  color: string;
}

/** Texte qui jaillit puis monte en s'effaçant (« KICKFLIP! », « +100 »). */
interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

/** Effets visuels purement cosmétiques (étincelles, chiffres de dégâts, traînées). */
export class Effects {
  private particles: Particle[] = [];
  private numbers: DamageNumber[] = [];
  private afterimages: Afterimage[] = [];
  private rings: Ring[] = [];
  private wedges: Wedge[] = [];
  private texts: FloatText[] = [];

  clear(): void {
    this.texts = [];
    this.particles = [];
    this.numbers = [];
    this.afterimages = [];
    this.rings = [];
    this.wedges = [];
  }

  wedge(
    x: number,
    y: number,
    angle: number,
    halfArc: number,
    outer: number,
    color: string,
    life = 0.18,
    inner = 0,
  ): void {
    this.wedges.push({ x, y, angle, halfArc, inner, outer, life, maxLife: life, color });
  }

  sparks(x: number, y: number, color: string, count = 6, speed = 220): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = randRange(speed * 0.3, speed);
      const life = randRange(0.15, 0.35);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: randRange(1.5, 3),
        color,
      });
    }
  }

  damageNumber(x: number, y: number, amount: number, crit = false): void {
    // Regroupe les chiffres proches pour éviter une pluie illisible à 20 balles/s.
    const recent = this.numbers.find(
      (n) => n.life > 0.55 && Math.abs(n.x - x) < 40 && Math.abs(n.y - y) < 40 && n.crit === crit,
    );
    if (recent) {
      recent.amount += amount;
      recent.life = 0.8;
      return;
    }
    this.numbers.push({ x: x + randRange(-8, 8), y: y - 10, amount, life: 0.8, crit });
  }

  afterimage(x: number, y: number, radius: number, color: string, life = 0.35): void {
    this.afterimages.push({ x, y, radius, life, maxLife: life, color });
  }

  ring(x: number, y: number, color: string, maxRadius = 50, life = 0.35): void {
    this.rings.push({ x, y, radius: 4, maxRadius, life, maxLife: life, color });
  }

  text(x: number, y: number, text: string, color: string, size = 15, life = 0.9): void {
    this.texts.push({ x, y, text, color, life, maxLife: life, size });
  }

  update(dt: number): void {
    for (const tx of this.texts) {
      tx.y -= 45 * dt;
      tx.life -= dt;
    }
    this.texts = this.texts.filter((tx) => tx.life > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 6 * dt;
      p.vy *= 1 - 6 * dt;
      p.life -= dt;
    }
    for (const n of this.numbers) {
      n.y -= 40 * dt;
      n.life -= dt;
    }
    for (const a of this.afterimages) a.life -= dt;
    for (const r of this.rings) {
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.radius = 4 + (r.maxRadius - 4) * t;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.numbers = this.numbers.filter((n) => n.life > 0);
    this.afterimages = this.afterimages.filter((a) => a.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const w of this.wedges) w.life -= dt;
    this.wedges = this.wedges.filter((w) => w.life > 0);
  }

  /** Effets dessinés sous les entités. */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    for (const a of this.afterimages) {
      const t = a.life / a.maxLife;
      ctx.globalAlpha = 0.45 * t;
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius * (0.7 + 0.3 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Effets dessinés au-dessus des entités. */
  drawOver(ctx: CanvasRenderingContext2D): void {
    for (const tx of this.texts) {
      const age = tx.maxLife - tx.life;
      const pop = 1 + Math.max(0, 0.12 - age) * 4; // petit « pop » à l'apparition
      ctx.save();
      ctx.globalAlpha = Math.min(1, tx.life / 0.3);
      ctx.translate(tx.x, tx.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${tx.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,12,16,0.85)';
      ctx.strokeText(tx.text, 0, 0);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, 0, 0);
      ctx.restore();
    }
    for (const w of this.wedges) {
      const t = w.life / w.maxLife; // 1 → 0
      const outer = w.outer * (0.75 + 0.25 * (1 - t));
      ctx.globalAlpha = 0.45 * t;
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(w.x, w.y, outer, w.angle - w.halfArc, w.angle + w.halfArc);
      ctx.arc(w.x, w.y, w.inner, w.angle + w.halfArc, w.angle - w.halfArc, true);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.9 * t;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w.x, w.y, outer, w.angle - w.halfArc, w.angle + w.halfArc);
      ctx.stroke();
    }
    for (const r of this.rings) {
      ctx.globalAlpha = r.life / r.maxLife;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    for (const n of this.numbers) {
      ctx.globalAlpha = Math.min(1, n.life / 0.3);
      ctx.font = `bold ${n.crit ? 20 : 16}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const txt = String(Math.round(n.amount));
      ctx.strokeText(txt, n.x, n.y);
      ctx.fillStyle = n.crit ? '#ff6b6b' : '#ffffff';
      ctx.fillText(txt, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  }
}
