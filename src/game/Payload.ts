import { lerp, type Vec2 } from '../core/math';
import type { Rect } from '../world/Arena';

export const PAYLOAD = {
  /** Vitesse quand les attaquants poussent (px/s). Un héros court à ~330 px/s. */
  speed: 60,
  /** Recul : vitesse divisée par 4. */
  reverseFactor: 0.25,
  /** Délai sans attaquant avant que le convoi recule (s). */
  reverseDelay: 3,
  /** Rayon de présence autour du convoi (invisible). */
  pushRadius: 150,
  /** Demi-taille de la caisse (collisions). */
  half: 30,
};

export type PayloadStatus = 'pushing' | 'contested' | 'stopped' | 'reversing';

/**
 * Le convoi : avance le long d'une suite de points de passage.
 * Sa position est une distance parcourue le long du chemin (`dist`) ;
 * x/y sont interpolés (lerp) sur le segment en cours.
 *
 * Règles :
 * - ≥ 1 attaquant et 0 défenseur dans la zone → il avance (« Poussée »)
 * - attaquants ET défenseurs → il s'arrête net (« Contesté »)
 * - aucun attaquant → arrêté, puis après un court délai il recule à 1/4 de vitesse (« Recul »),
 *   sans jamais repasser sous le dernier checkpoint atteint.
 */
export class Payload {
  dist = 0;
  /** Le convoi ne recule jamais sous cette distance (dernier checkpoint). */
  floor = 0;
  x: number;
  y: number;
  /** Direction d'avancée (normalisée). */
  dir: Vec2 = { x: 0, y: -1 };
  status: PayloadStatus = 'stopped';
  attackersIn = 0;
  defendersIn = 0;
  private idle = 0;
  private wheel = 0;

  /** Distance cumulée au début de chaque point de passage. */
  private readonly cum: number[];
  readonly length: number;
  readonly checkpointDist: number;

  constructor(
    readonly path: readonly Vec2[],
    checkpointIndex: number,
  ) {
    this.cum = [0];
    for (let i = 1; i < path.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    this.length = this.cum[this.cum.length - 1];
    this.checkpointDist = this.cum[checkpointIndex];
    this.x = path[0].x;
    this.y = path[0].y;
    this.place();
  }

  /** Progression totale 0..1. */
  get progress(): number {
    return this.dist / this.length;
  }

  get delivered(): boolean {
    return this.dist >= this.length;
  }

  /** Position (et direction) à une distance donnée le long du chemin. */
  pointAt(d: number): Vec2 & { dir: Vec2 } {
    const p = this.path;
    const dd = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < p.length - 1 && this.cum[i] < dd) i++;
    const a = p[i - 1];
    const b = p[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (dd - this.cum[i - 1]) / seg;
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      dir: { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg },
    };
  }

  private place(): void {
    const p = this.pointAt(this.dist);
    this.x = p.x;
    this.y = p.y;
    this.dir = p.dir;
  }

  /** Hitbox (le convoi est un obstacle : on peut se cacher derrière). */
  rect(): Rect {
    const h = PAYLOAD.half;
    return { x: this.x - h, y: this.y - h, w: h * 2, h: h * 2 };
  }

  update(dt: number, attackers: number, defenders: number): void {
    this.attackersIn = attackers;
    this.defendersIn = defenders;
    const before = this.dist;

    if (attackers > 0 && defenders === 0) {
      this.status = 'pushing';
      this.idle = 0;
      this.dist = Math.min(this.length, this.dist + PAYLOAD.speed * dt);
    } else if (attackers > 0) {
      this.status = 'contested';
      this.idle = 0;
    } else {
      this.idle += dt;
      if (this.idle < PAYLOAD.reverseDelay || this.dist <= this.floor) {
        this.status = 'stopped';
      } else {
        this.status = 'reversing';
        this.dist = Math.max(this.floor, this.dist - PAYLOAD.speed * PAYLOAD.reverseFactor * dt);
      }
    }
    this.wheel += this.dist - before;
    this.place();
  }

  // ------------------------------------------------------------------ rendu

  /** Tracé du parcours au sol : reste à parcourir, checkpoint et arrivée. */
  drawPath(ctx: CanvasRenderingContext2D, color: string): void {
    const p = this.path;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Parcours déjà fait (discret) puis reste à faire (pointillés couleur attaque)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    for (let i = 1; i < p.length; i++) if (this.cum[i] > this.dist) ctx.lineTo(p[i].x, p[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const marker = (d: number, r: number, reached: boolean) => {
      const m = this.pointAt(d);
      ctx.fillStyle = reached ? color : 'rgba(10,14,20,0.8)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    marker(this.checkpointDist, 18, this.dist >= this.checkpointDist);
    marker(this.length, 28, this.delivered);
    ctx.restore();
  }

  /** La caisse vue de dessus, orientée dans le sens de la marche. */
  draw(ctx: CanvasRenderingContext2D, color: string, time: number): void {
    const h = PAYLOAD.half;
    const angle = Math.atan2(this.dir.y, this.dir.x);
    ctx.save();
    ctx.translate(this.x, this.y);

    // Ombre (non tournée, pour coller à la hitbox carrée)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-h + 6, -h + 8, h * 2, h * 2);

    ctx.rotate(angle);
    // Roues (elles tournent quand le convoi bouge)
    const spin = Math.floor(this.wheel / 6) % 2 === 0;
    ctx.fillStyle = '#1b2028';
    for (const wx of [-h + 6, h - 16]) {
      for (const wy of [-h - 4, h - 4]) ctx.fillRect(wx, wy, 12, 8);
    }
    ctx.fillStyle = spin ? '#3a4352' : '#2a313c';
    ctx.fillRect(-h + 8, -h - 3, 8, 2);
    ctx.fillRect(h - 14, h - 1, 8, 2);

    // Châssis + cargaison
    ctx.fillStyle = '#5b6573';
    ctx.fillRect(-h, -h + 4, h * 2, h * 2 - 8);
    ctx.fillStyle = '#c9d2dc';
    ctx.fillRect(-h + 6, -h + 9, h * 2 - 20, h * 2 - 18);
    // Bandes à la couleur de l'équipe qui attaque
    ctx.fillStyle = color;
    ctx.fillRect(-h + 6, -4, h * 2 - 20, 8);
    // Cabine à l'avant + phare qui clignote quand il avance
    ctx.fillStyle = '#2b3442';
    ctx.fillRect(h - 12, -h + 9, 10, h * 2 - 18);
    if (this.status === 'pushing' && Math.floor(time * 4) % 2 === 0) {
      ctx.fillStyle = '#ffe39a';
      ctx.fillRect(h - 3, -6, 4, 12);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - h, this.y - h, h * 2, h * 2);
  }
}
