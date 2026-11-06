import { BOT, COLORS, TURRET, teamColor } from '../config';
import type { Effects } from '../effects/Effects';
import type { Hero } from '../heroes/Hero';
import { angleDiff, rotateTowards } from '../core/math';
import { t } from '../i18n';
import { drawBuffIndicator, drawHealthBar, type BuffKind } from '../ui/healthBar';
import type { Arena } from '../world/Arena';
import type { Box } from '../core/geometry';
import { canSeeBox } from '../world/Visibility';
import { ROBOT_SPRITE, TURRET_BARREL, TURRET_BASE, TURRET_PALETTE } from '../sprites/library';
import {
  characterHalfSize,
  characterLayout,
  drawCharacter,
  drawGroundRing,
  drawProp,
  facingFromAngle,
  propImage,
  walkFrame,
} from '../sprites/SpriteRenderer';
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
  /** Taille d'un pixel de sprite → fixe la hitbox rectangulaire (hw, hh). */
  readonly px: number;
  readonly hw: number;
  readonly hh: number;
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
  /** Bonus d'aura (remis à zéro chaque frame, appliqué par Tempo). */
  auraSpeedMul = 1;
  buff: BuffKind | null = null;

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
    if (this.kind === 'turret') {
      this.px = BOT.turretPx;
      this.hw = (TURRET_BASE[0].length * this.px) / 2;
      this.hh = (TURRET_BASE.length * this.px) / 2;
    } else {
      this.px = BOT.robotPx;
      ({ hw: this.hw, hh: this.hh } = characterHalfSize(ROBOT_SPRITE, this.px));
    }
  }

  /** Hitbox rectangulaire = le dessin du sprite. */
  box(): Box {
    return { x: this.x, y: this.y, hw: this.hw, hh: this.hh };
  }

  /** Taille approximative pour placer les effets (demi-largeur). */
  get radius(): number {
    return this.hw;
  }

  get isEnemy(): boolean {
    return this.team === ENEMY;
  }

  resetBuffs(): void {
    this.auraSpeedMul = 1;
    this.buff = null;
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
      this.respawnTimer = BOT.respawnTime;
    }
    return dealt;
  }

  heal(amount: number): void {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount);
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

    // Recul : vitesse qui s'amortit, avec collisions contre les murs.
    const kSpeed = Math.hypot(this.kvx, this.kvy);
    if (kSpeed > 1) {
      this.x += this.kvx * dt;
      this.y += this.kvy * dt;
      const decay = Math.exp(-BOT.knockbackDamping * dt);
      this.kvx *= decay;
      this.kvy *= decay;
      ctx.arena.resolveBox(this, this.hw, this.hh);
    } else {
      this.kvx = this.kvy = 0;
    }
    if (kSpeed > 60) return; // pendant un gros recul, le bot ne "marche" pas

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
    if (!canSeeBox(ctx.arena, this.x, this.y, h.box())) return;

    const target = Math.atan2(h.y - this.y, h.x - this.x);
    this.facing = rotateTowards(this.facing, target, TURRET.turnRate * dt);
    if (this.fireTimer <= 0 && Math.abs(angleDiff(this.facing, target)) < 0.12) {
      this.fireTimer = TURRET.fireInterval;
      const mx = this.x + Math.cos(this.facing) * (this.hw + 8);
      const my = this.y + Math.sin(this.facing) * (this.hw + 8);
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

    if (!this.alive) {
      // Silhouette fantôme de la hitbox + compte à rebours
      ctx.strokeStyle = outline;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - this.hw, this.y - this.hh, this.hw * 2, this.hh * 2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = outline;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.respawnTimer.toFixed(1), this.x, this.y + 5);
      ctx.globalAlpha = 1;
      return;
    }

    const flash = this.hitFlash > 0;
    if (this.kind === 'turret') {
      const v = { outline, overrides: { t: outline }, silhouette: flash ? '#ffffff' : undefined };
      const base = propImage('turret.base', TURRET_BASE, TURRET_PALETTE, v);
      const barrel = propImage('turret.barrel', TURRET_BARREL, TURRET_PALETTE, v);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(this.x - this.hw + 4, this.y - this.hh + 6, this.hw * 2, this.hh * 2);
      drawProp(ctx, base, this.x, this.y, 0, this.px, base.width / 2, base.height / 2);
      drawProp(ctx, barrel, this.x, this.y, this.facing, this.px, 0, barrel.height / 2);
    } else {
      const layout = characterLayout(ROBOT_SPRITE, this.x, this.y, this.px);
      drawGroundRing(ctx, this.x, layout.feetY, this.hw, outline);
      drawCharacter(ctx, ROBOT_SPRITE, {
        x: this.x,
        y: this.y,
        px: this.px,
        facing: facingFromAngle(this.facing),
        frame: walkFrame(this.animTime),
        outline,
        overrides: { t: outline },
        flash,
      });
    }

    if (this.pinned) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.x - this.hw - 4, this.y - this.hh - 4, this.hw * 2 + 8, this.hh * 2 + 8);
      ctx.setLineDash([]);
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const color = this.isEnemy ? COLORS.hpEnemy : COLORS.hpAlly;
    const barTop = this.y - this.hh - this.px - 4;
    const barWidth = 56;
    drawHealthBar(ctx, this.x, barTop, this.hp, this.maxHp, color, barWidth);
    if (this.buff) drawBuffIndicator(ctx, this.x + barWidth / 2 + 12, barTop - 3.5, this.buff);

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
