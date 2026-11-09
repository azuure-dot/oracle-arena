import { BOT, COLORS, TURRET, teamColor } from '../config';
import type { Effects } from '../effects/Effects';
import type { Hero } from '../heroes/Hero';
import { angleDiff, rotateTowards } from '../core/math';
import { t } from '../i18n';
import { drawBuffIndicators, drawHealthBar, drawStunStars, type BuffKind } from '../ui/healthBar';
import type { Arena } from '../world/Arena';
import type { Circle } from '../core/geometry';
import { cached, drawTeamMarker, hand, inked, LINE, TAU } from '../render/topdown';
import { canSeeCircle } from '../world/Visibility';
import type { Combatant } from './Combatant';
import { Projectile } from './Projectile';
import { ENEMY, type Team } from './Team';

export interface PatrolPath {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export type BotKind = 'target' | 'turret';

export interface BotOptions {
  team: Team;
  x: number;
  y: number;
  kind?: BotKind;
  patrol?: PatrolPath;
  facing?: number;
  /** Allié qui perd des PV en continu (pour tester les soins). */
  wounded?: boolean;
}

export interface BotContext {
  arena: Arena;
  effects: Effects;
  hero: Hero | null;
  turretsEnabled: boolean;
  spawnProjectile(p: Projectile): void;
}

/**
 * Bot du champ de tir : cible immobile, patrouilleur ou tourelle.
 * Peut subir un recul (Onde de choc) ou être épinglé (Charge).
 * Les alliés sont invulnérables aux tirs du joueur.
 */
export class Bot implements Combatant {
  x: number;
  y: number;
  /** Rayon de la boule (= hitbox ronde). */
  readonly radius: number;
  readonly maxHp: number;
  readonly team: Team;
  readonly kind: BotKind;
  readonly patrol: PatrolPath | null;
  readonly wounded: boolean;
  hp: number;
  alive = true;
  respawnTimer = 0;
  facing: number;
  hitFlash = 0;

  /** Visible par le joueur (calculé chaque frame par le jeu). */
  visible = true;
  /** Tenu par une Charge : sa position est pilotée par le héros. */
  pinned = false;
  /** Étourdi : ne patrouille plus, la tourelle ne tire plus. */
  stunTimer = 0;
  /** Bonus d'aura (remis à zéro chaque frame, appliqué par Tempo). */
  auraSpeedMul = 1;
  buffs: BuffKind[] = [];

  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly spawnFacing: number;
  private headingToB = true;
  private kvx = 0;
  private kvy = 0;
  private fireTimer = 0;

  constructor(opts: BotOptions) {
    this.team = opts.team;
    this.kind = opts.kind ?? 'target';
    this.patrol = opts.patrol ?? null;
    this.wounded = opts.wounded ?? false;
    this.x = this.spawnX = opts.x;
    this.y = this.spawnY = opts.y;
    this.facing = this.spawnFacing = opts.facing ?? Math.PI;
    this.maxHp = this.team === ENEMY ? BOT.enemyHp : BOT.allyHp;
    this.hp = this.wounded ? this.maxHp * 0.5 : this.maxHp;
    this.radius = this.kind === 'turret' ? BOT.turretRadius : BOT.robotRadius;
  }

  /** Hitbox ronde = la boule dessinée. */
  circle(): Circle {
    return { x: this.x, y: this.y, r: this.radius };
  }

  get isEnemy(): boolean {
    return this.team === ENEMY;
  }

  resetBuffs(): void {
    this.auraSpeedMul = 1;
    this.buffs.length = 0;
  }

  /** Retourne les dégâts réellement infligés (0 pour un allié ou un bot mort). */
  takeDamage(amount: number): number {
    if (!this.alive || !this.isEnemy) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.hitFlash = 0.08;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.pinned = false;
      this.stunTimer = 0;
      this.respawnTimer = BOT.respawnTime;
    }
    return dealt;
  }

  heal(amount: number): void {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  stun(seconds: number): void {
    if (this.alive) this.stunTimer = Math.max(this.stunTimer, seconds);
  }

  applyImpulse(ix: number, iy: number): void {
    if (!this.alive || this.pinned) return;
    this.kvx += ix;
    this.kvy += iy;
  }

  private animTime = 0;

  update(dt: number, ctx: BotContext): void {
    const px = this.x;
    const py = this.y;
    this.step(dt, ctx);
    // Animation de marche si le bot s'est déplacé (patrouille, retour au poste, recul).
    const moved = Math.hypot(this.x - px, this.y - py) > 20 * dt;
    this.animTime = moved && this.alive && !this.pinned ? this.animTime + dt : 0;
  }

  private step(dt: number, ctx: BotContext): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }

    if (this.wounded && this.hp > this.maxHp * BOT.woundedFloor) {
      this.hp = Math.max(this.maxHp * BOT.woundedFloor, this.hp - BOT.woundedDrain * dt);
    }

    if (this.pinned) return;
    this.stunTimer = Math.max(0, this.stunTimer - dt);

    // Recul : vitesse qui s'amortit, avec collisions contre les murs.
    const kSpeed = Math.hypot(this.kvx, this.kvy);
    if (kSpeed > 1) {
      this.x += this.kvx * dt;
      this.y += this.kvy * dt;
      const decay = Math.exp(-BOT.knockbackDamping * dt);
      this.kvx *= decay;
      this.kvy *= decay;
      ctx.arena.resolveCircle(this, this.radius);
    } else {
      this.kvx = this.kvy = 0;
    }
    if (kSpeed > 60) return; // pendant un gros recul, le bot ne "marche" pas
    if (this.stunTimer > 0) return;

    if (this.patrol) this.updatePatrol(dt);
    else this.returnHome(dt);
    if (this.kind === 'turret') this.updateTurret(dt, ctx);
  }

  /** Un bot immobile déplacé (recul, Charge) retourne à son poste. */
  private returnHome(dt: number): void {
    const dx = this.spawnX - this.x;
    const dy = this.spawnY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const step = BOT.patrolSpeed * this.auraSpeedMul * dt;
    if (dist <= step) {
      this.x = this.spawnX;
      this.y = this.spawnY;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }

  private updatePatrol(dt: number): void {
    const p = this.patrol!;
    const tx = this.headingToB ? p.bx : p.ax;
    const ty = this.headingToB ? p.by : p.ay;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = BOT.patrolSpeed * this.auraSpeedMul * dt;
    if (dist <= step) {
      this.x = tx;
      this.y = ty;
      this.headingToB = !this.headingToB;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      this.facing = Math.atan2(dy, dx);
    }
  }

  /** La tourelle ne tire que si elle VOIT le héros (même test de ligne de vue que le joueur). */
  private updateTurret(dt: number, ctx: BotContext): void {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    const h = ctx.hero;
    if (!ctx.turretsEnabled || !h || h.dead) return;
    const dist = Math.hypot(h.x - this.x, h.y - this.y);
    if (dist > TURRET.range) return;
    if (!canSeeCircle(ctx.arena, this.x, this.y, h.circle())) return;

    const target = Math.atan2(h.y - this.y, h.x - this.x);
    this.facing = rotateTowards(this.facing, target, TURRET.turnRate * dt);
    if (this.fireTimer <= 0 && Math.abs(angleDiff(this.facing, target)) < 0.12) {
      this.fireTimer = TURRET.fireInterval;
      const mx = this.x + Math.cos(this.facing) * (this.radius + 16);
      const my = this.y + Math.sin(this.facing) * (this.radius + 16);
      ctx.spawnProjectile(
        new Projectile({
          x: mx,
          y: my,
          angle: this.facing,
          speed: TURRET.bulletSpeed,
          damage: TURRET.damage,
          team: ENEMY,
          range: TURRET.range + 100,
          radius: 5,
          style: 'enemy',
        }),
      );
      ctx.effects.sparks(mx, my, COLORS.enemyBullet, 3, 120);
    }
  }

  private respawn(): void {
    this.alive = true;
    this.hp = this.wounded ? this.maxHp * 0.5 : this.maxHp;
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.facing = this.spawnFacing;
    this.headingToB = true;
    this.kvx = this.kvy = 0;
    this.pinned = false;
  }

  // ---------------------------------------------------------------- rendu

  draw(ctx: CanvasRenderingContext2D): void {
    const outline = teamColor(this.team);
    const R = this.radius;

    if (!this.alive) {
      // Silhouette fantôme de la boule + compte à rebours
      ctx.strokeStyle = outline;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = outline;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.respawnTimer.toFixed(1), this.x, this.y + 5);
      ctx.globalAlpha = 1;
      return;
    }

    drawTeamMarker(ctx, this.x, this.y, R, outline);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facing);
    if (this.kind === 'turret') {
      // Tourelle : socle rond boulonné, canon qui suit la cible, dôme aux couleurs de l'équipe.
      cached(ctx, `turret.${outline}`, R * 2.1, (c) => drawTurret(c, R, outline));
    } else {
      // Robot : dôme d'acier, visière lumineuse aux couleurs de l'équipe, mains qui se balancent.
      const swing = this.animTime > 0 ? Math.sin(this.animTime * 10) * R * 0.18 : 0;
      cached(ctx, `robot.${outline}`, R * 1.3, (c) => drawRobotHead(c, R, outline));
      for (const side of [-1, 1]) hand(ctx, R * 0.5 + swing * side, side * R * 0.9, R * 0.3, '#8e9bb0', this.facing);
    }
    if (this.hitFlash > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (this.pinned) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, R + 6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const color = this.isEnemy ? COLORS.hpEnemy : COLORS.hpAlly;
    const barTop = this.y - this.radius * 1.3 - 4;
    const barWidth = 56;
    drawHealthBar(ctx, this.x, barTop, this.hp, this.maxHp, color, barWidth);
    drawBuffIndicators(ctx, this.x + barWidth / 2 + 12, barTop - 3.5, this.buffs);
    if (this.stunTimer > 0) drawStunStars(ctx, this.x, this.y - this.radius * 0.4);

    const tag = !this.isEnemy
      ? t(this.wounded ? 'tag.wounded' : 'tag.ally')
      : this.kind === 'turret'
        ? t('tag.turret')
        : null;
    if (tag) {
      ctx.fillStyle = teamColor(this.team);
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tag, this.x, barTop - 12);
    }
  }
}

/** Robot d'entraînement vu de dessus (regard vers +x) : dôme d'acier riveté, antenne, visière lumineuse. */
function drawRobotHead(ctx: CanvasRenderingContext2D, R: number, team: string): void {
  inked(ctx, '#9aa6b4', () => ctx.arc(0, 0, R, 0, TAU), 2.4);
  ctx.strokeStyle = '#6f7c8c';
  ctx.lineWidth = R * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.7, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#5d6b80';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85, R * 0.06, 0, TAU);
    ctx.fill();
  }
  // Visière : bandeau lumineux à l'avant
  ctx.strokeStyle = LINE;
  ctx.lineWidth = R * 0.32;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.78, -0.75, 0.75);
  ctx.stroke();
  ctx.strokeStyle = team;
  ctx.lineWidth = R * 0.18;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.74, -0.5, 0.1);
  ctx.stroke();
  // Antenne au sommet
  inked(ctx, '#c9d4e2', () => ctx.arc(-R * 0.15, 0, R * 0.16, 0, TAU), 1.6);
  inked(ctx, team, () => ctx.arc(-R * 0.15, 0, R * 0.07, 0, TAU), 1.2);
}

/** Tourelle vue de dessus (canon vers +x) : socle rond boulonné, canon double, dôme de l'équipe. */
function drawTurret(ctx: CanvasRenderingContext2D, R: number, team: string): void {
  inked(ctx, '#4a5262', () => ctx.arc(0, 0, R, 0, TAU), 2.4);
  ctx.fillStyle = '#2f3542';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82, R * 0.07, 0, TAU);
    ctx.fill();
  }
  for (const y of [-R * 0.22, R * 0.22]) inked(ctx, '#7f8ea3', () => ctx.roundRect(R * 0.2, y - R * 0.13, R * 1.5, R * 0.26, R * 0.08), 1.8);
  inked(ctx, '#2f3542', () => ctx.roundRect(R * 1.55, -R * 0.42, R * 0.25, R * 0.84, R * 0.08), 1.6);
  inked(ctx, team, () => ctx.arc(0, 0, R * 0.55, 0, TAU), 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(-R * 0.15, -R * 0.15, R * 0.2, 0, TAU);
  ctx.fill();
}
