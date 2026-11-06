import { COLORS, PLAYER_SPAWN, ZONES, teamColor } from '../config';
import type { GameContext } from '../core/GameContext';
import type { Input } from '../core/Input';
import { damp, normalize, type Vec2 } from '../core/math';
import type { Projectile } from '../entities/Projectile';
import type { Team } from '../entities/Team';
import { t, type TKey } from '../i18n';
import { drawBuffIndicator, drawHealthBar, type BuffKind } from '../ui/healthBar';

/** Touches communes à tous les héros (codes physiques : OK en AZERTY et QWERTY). */
export const KEYS = {
  ability1: ['Space'],
  ability2: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
} as const;

/** Emplacement de touche : le libellé affiché est traduit par le HUD (Clic D / RMB...). */
export type InputSlot = 'primary' | 'secondary' | 'ability1' | 'ability2';

export const INPUT_LABEL_KEYS: Record<InputSlot, TKey> = {
  primary: 'key.primary',
  secondary: 'key.secondary',
  ability1: 'key.ability1',
  ability2: 'key.ability2',
};

export type AbilityIcon = 'blink' | 'recall' | 'shield' | 'fire' | 'charge' | 'boop' | 'swap' | 'amp';

/** Description d'une case de compétence pour le HUD (générique pour tous les héros). */
export interface AbilitySlot {
  input: InputSlot;
  name: string; // déjà traduit
  icon: AbilityIcon;
  color?: string;
  cooldown?: number; // temps restant
  cooldownMax?: number;
  charges?: number;
  maxCharges?: number;
  chargeProgress?: number; // 0..1 sur la prochaine charge
  active?: boolean;
  bar?: number; // 0..1 (ex. PV du bouclier)
  label?: string; // petit texte sous le nom (ex. mode d'aura)
}

export interface WeaponHud {
  name: string;
  ammo?: number;
  magSize?: number;
  reloadProgress?: number; // défini seulement pendant un rechargement
  readyRatio?: number; // armes sans munitions : 1 = prêt
}

export interface HeroStats {
  name: string;
  maxHp: number;
  radius: number; // hurtbox
  speed: number; // px/s
  acceleration?: number;
  color: string;
  colorDark: string;
}

/**
 * Classe parente de tous les héros.
 * Elle gère : PV, mort/réapparition, déplacement fluide, visée, zones.
 * Les sous-classes branchent leurs compétences via les "hooks" protégés.
 *
 * Ordre d'une frame :
 *   tick() → [isLocked() ? updateLocked() : move() + handleInput()] → zones → lateUpdate()
 */
export abstract class Hero {
  readonly team: Team = 'ally';
  x: number = PLAYER_SPAWN.x;
  y: number = PLAYER_SPAWN.y;
  vx = 0;
  vy = 0;
  aim = 0;
  hp: number;
  dead = false;
  respawnTimer = 0;
  hurtTimer = 0;
  /** Buff d'aura reçu cette frame (indicateur au-dessus de la tête). */
  buff: BuffKind | null = null;
  /** Direction de déplacement demandée au clavier (normalisée, ou 0). */
  protected moveDir: Vec2 = { x: 0, y: 0 };

  constructor(readonly stats: HeroStats) {
    this.hp = stats.maxHp;
  }

  get name(): string {
    return this.stats.name;
  }
  get radius(): number {
    return this.stats.radius;
  }
  get maxHp(): number {
    return this.stats.maxHp;
  }
  get invulnerable(): boolean {
    return this.dead;
  }
  /** Dispersion de l'arme pour le viseur (0 = viseur simple). */
  get spreadDeg(): number {
    return 0;
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, ctx: GameContext): void {
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.buff = null;

    if (this.dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn(ctx);
      return;
    }

    this.aim = Math.atan2(ctx.aimY - this.y, ctx.aimX - this.x);
    this.moveDir = readMoveDir(ctx.input);

    this.tick(dt, ctx);
    if (this.isLocked()) {
      this.updateLocked(dt, ctx);
    } else {
      this.move(dt, ctx);
      this.handleInput(dt, ctx);
    }
    if (!this.dead) this.applyZones(dt, ctx);
    if (!this.dead) this.lateUpdate(dt, ctx);
  }

  /** Timers et cooldowns : appelé chaque frame, même quand le héros est "verrouillé". */
  protected tick(_dt: number, _ctx: GameContext): void {}
  /** true pendant une action qui retire le contrôle (Charge, Rappel...). */
  protected isLocked(): boolean {
    return false;
  }
  protected updateLocked(_dt: number, _ctx: GameContext): void {}
  /** Tir, compétences : appelé seulement si le héros n'est pas verrouillé. */
  protected abstract handleInput(dt: number, ctx: GameContext): void;
  protected lateUpdate(_dt: number, _ctx: GameContext): void {}
  /** Multiplicateur de vitesse (bouclier levé, aura...). */
  protected speedMultiplier(): number {
    return 1;
  }
  protected onDeath(_ctx: GameContext): void {}
  protected onRespawn(_ctx: GameContext): void {}

  protected move(dt: number, ctx: GameContext): void {
    const speed = this.stats.speed * this.speedMultiplier();
    const accel = this.stats.acceleration ?? 16;
    this.vx = damp(this.vx, this.moveDir.x * speed, accel, dt);
    this.vy = damp(this.vy, this.moveDir.y * speed, accel, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    ctx.arena.resolveCircle(this, this.radius);
  }

  private applyZones(dt: number, ctx: GameContext): void {
    const zone = ctx.arena.zoneAt(this.x, this.y);
    if (!zone) return;
    if (zone.kind === 'hazard') this.takeDamage(ZONES.hazardDps * dt, ctx);
    else this.heal(ZONES.healHps * dt);
  }

  // ------------------------------------------------------------------- PV

  takeDamage(amount: number, ctx: GameContext): void {
    if (this.invulnerable || amount <= 0) return;
    this.hp -= amount;
    this.hurtTimer = 0.3;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.respawnTimer = 3;
      ctx.effects.sparks(this.x, this.y, this.stats.color, 24, 320);
      this.onDeath(ctx);
    }
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /** Le héros arrête-t-il ce projectile ennemi (bouclier) ? Par défaut non. */
  shieldBlocks(_p: Projectile): boolean {
    return false;
  }

  private respawn(ctx: GameContext): void {
    this.dead = false;
    this.hp = this.maxHp;
    this.x = PLAYER_SPAWN.x;
    this.y = PLAYER_SPAWN.y;
    this.vx = 0;
    this.vy = 0;
    this.onRespawn(ctx);
    ctx.effects.ring(this.x, this.y, this.stats.color, 50, 0.4);
  }

  // -------------------------------------------------------------------- HUD

  abstract abilitySlots(): AbilitySlot[];
  abstract weaponHud(): WeaponHud;

  // ------------------------------------------------------------------ rendu

  /** Sous les entités (aura, traînées...). */
  drawUnder(_ctx: CanvasRenderingContext2D, _time: number): void {}

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(this.x + 3, this.y + 6, this.radius, this.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    this.drawBody(ctx);
  }

  protected abstract drawBody(ctx: CanvasRenderingContext2D): void;

  /** Au-dessus des entités (bouclier...). */
  drawOver(_ctx: CanvasRenderingContext2D): void {}

  /** Barre de vie au-dessus du héros. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.dead) {
      ctx.fillStyle = COLORS.hud;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('hud.respawn', { s: this.respawnTimer.toFixed(1) }), PLAYER_SPAWN.x, PLAYER_SPAWN.y - 50);
      return;
    }
    const low = this.hp / this.maxHp < 0.35;
    const width = this.maxHp > 300 ? 84 : 60;
    drawHealthBar(
      ctx,
      this.x,
      this.y - this.radius - 10,
      this.hp,
      this.maxHp,
      low ? COLORS.hpLow : COLORS.hpPlayer,
      width,
    );
    if (this.buff) drawBuffIndicator(ctx, this.x + width / 2 + 12, this.y - this.radius - 13.5, this.buff);
  }

  /** Corps circulaire standard : contour d'équipe (bleu) + visière orientée vers la visée. */
  protected drawRoundBody(ctx: CanvasRenderingContext2D, fill: string): void {
    const { x, y, radius: r } = this;
    ctx.fillStyle = this.hurtTimer > 0.2 ? '#ffffff' : fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = teamColor(this.team);
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.68, this.aim - 0.55, this.aim + 0.55);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

export function readMoveDir(input: Input): Vec2 {
  let mx = 0;
  let my = 0;
  if (input.isDown('KeyW', 'ArrowUp')) my -= 1;
  if (input.isDown('KeyS', 'ArrowDown')) my += 1;
  if (input.isDown('KeyA', 'ArrowLeft')) mx -= 1;
  if (input.isDown('KeyD', 'ArrowRight')) mx += 1;
  return normalize(mx, my);
}
