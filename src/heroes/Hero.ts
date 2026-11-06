import { COLORS, PLAYER_SPAWN, ZONES, teamColor } from '../config';
import type { GameContext } from '../core/GameContext';
import { boxExtent, boxInCone, distToBox, type Box } from '../core/geometry';
import type { Input } from '../core/Input';
import { damp, degToRad, normalize, type Vec2 } from '../core/math';
import type { Bot } from '../entities/Bot';
import type { Projectile } from '../entities/Projectile';
import { lineOfSight } from '../world/Visibility';
import type { Team } from '../entities/Team';
import { t, type TKey } from '../i18n';
import type { CharacterSprite } from '../sprites/library';
import {
  characterHalfSize,
  characterLayout,
  drawCharacter,
  drawGroundRing,
  facingFromAngle,
  walkFrame,
  type SpriteLayout,
} from '../sprites/SpriteRenderer';
import { drawBuffIndicator, drawHealthBar, type BuffKind } from '../ui/healthBar';

/** Touches communes à tous les héros (codes physiques : OK en AZERTY et QWERTY). */
export const KEYS = {
  ability1: ['Space'],
  ability2: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
} as const;

/** Emplacement de touche : le libellé affiché est traduit par le HUD (Clic D / RMB...). */
export type InputSlot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'melee';

export const INPUT_LABEL_KEYS: Record<InputSlot, TKey> = {
  primary: 'key.primary',
  secondary: 'key.secondary',
  ability1: 'key.ability1',
  ability2: 'key.ability2',
  melee: 'key.melee',
};

/**
 * Mêlée rapide (clic molette), commune à tous les héros sauf ceux qui se battent
 * déjà au corps à corps. Portée minuscule : il faut quasiment toucher l'adversaire.
 */
export const QUICK_MELEE = {
  damage: 40,
  cooldown: 1, // s entre deux coups
  /** Portée au-delà du bord de la hitbox du héros, dans la direction visée. */
  reach: 12,
  halfArc: degToRad(50),
  /** Pendant ce temps le héros ne peut pas tirer (coup en cours). */
  lockout: 0.35,
  knockback: 140,
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
  /** Sprite pixel art du héros. */
  sprite: CharacterSprite;
  /** Taille d'un pixel du sprite (unités monde) : fixe aussi la taille de la hitbox. */
  px: number;
  speed: number; // px/s
  acceleration?: number;
  color: string;
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
  /** Temps d'animation de marche (0 = immobile). */
  protected animTime = 0;
  /** Mêlée rapide : temps de recharge restant / durée restante du coup en cours. */
  meleeCooldown = 0;
  private meleeAnim = 0;

  /** Hitbox rectangulaire = le dessin du sprite (demi-largeur / demi-hauteur). */
  readonly hw: number;
  readonly hh: number;

  constructor(readonly stats: HeroStats) {
    this.hp = stats.maxHp;
    ({ hw: this.hw, hh: this.hh } = characterHalfSize(stats.sprite, stats.px));
  }

  get name(): string {
    return this.stats.name;
  }
  /** Taille approximative (demi-largeur) pour placer effets et projectiles. */
  get radius(): number {
    return this.hw;
  }
  /** Hitbox courante (dégâts reçus + collisions avec les murs). */
  box(): Box {
    return { x: this.x, y: this.y, hw: this.hw, hh: this.hh };
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
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.meleeAnim = Math.max(0, this.meleeAnim - dt);

    this.tick(dt, ctx);
    if (this.isLocked()) {
      this.updateLocked(dt, ctx);
    } else {
      this.move(dt, ctx);
      if (this.hasQuickMelee() && ctx.input.wasMousePressed(1) && this.meleeCooldown <= 0) this.quickMelee(ctx);
      this.handleInput(dt, ctx);
    }
    if (!this.dead) this.applyZones(dt, ctx);
    if (!this.dead) this.lateUpdate(dt, ctx);
    this.animTime = this.isWalking() ? this.animTime + dt * this.animRate() : 0;
  }

  /** Le sprite doit-il jouer l'animation de marche ? */
  protected isWalking(): boolean {
    return Math.hypot(this.vx, this.vy) > 30;
  }
  /** Vitesse de l'animation de marche (1 = normale). */
  protected animRate(): number {
    return 1;
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

  // ---------------------------------------------------------- mêlée rapide

  /** Le héros a-t-il la mêlée rapide ? (non pour un héros déjà au corps à corps) */
  hasQuickMelee(): boolean {
    return true;
  }
  /** true pendant le coup : les armes ne tirent pas. */
  protected get isMeleeing(): boolean {
    return this.meleeAnim > 0;
  }
  /** Appelé au début d'un coup de mêlée (ex. annuler le rechargement). */
  protected onQuickMelee(): void {}

  private quickMelee(ctx: GameContext): void {
    this.meleeCooldown = QUICK_MELEE.cooldown;
    this.meleeAnim = QUICK_MELEE.lockout;
    this.onQuickMelee();

    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    // Portée mesurée depuis le bord de la hitbox : il faut être collé à la cible.
    const reach = boxExtent(this, dx, dy) + QUICK_MELEE.reach;
    ctx.effects.wedge(this.x, this.y, this.aim, QUICK_MELEE.halfArc, reach + 6, '#ffffff', 0.15, reach * 0.55);

    // Un seul ennemi touché : le plus proche dans le cône, sans mur entre les deux.
    let target: Bot | null = null;
    let best = Infinity;
    for (const bot of ctx.bots) {
      if (!bot.alive || !bot.isEnemy) continue;
      if (!boxInCone(this.x, this.y, this.aim, QUICK_MELEE.halfArc, reach, bot.box())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, bot.x, bot.y)) continue;
      const d = distToBox(this.x, this.y, bot.box());
      if (d < best) {
        best = d;
        target = bot;
      }
    }
    if (!target) return;
    ctx.damageBot(target, QUICK_MELEE.damage);
    target.applyImpulse(dx * QUICK_MELEE.knockback, dy * QUICK_MELEE.knockback);
    ctx.effects.sparks(target.x - dx * target.hw, target.y - dy * target.hh, '#ffffff', 8, 200);
    ctx.shake(2);
  }

  protected move(dt: number, ctx: GameContext): void {
    const speed = this.stats.speed * this.speedMultiplier();
    const accel = this.stats.acceleration ?? 16;
    this.vx = damp(this.vx, this.moveDir.x * speed, accel, dt);
    this.vy = damp(this.vy, this.moveDir.y * speed, accel, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    ctx.arena.resolveBox(this, this.hw, this.hh);
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
    this.meleeCooldown = 0;
    this.meleeAnim = 0;
    this.onRespawn(ctx);
    ctx.effects.ring(this.x, this.y, this.stats.color, 50, 0.4);
  }

  // -------------------------------------------------------------------- HUD

  abstract abilitySlots(): AbilitySlot[];
  abstract weaponHud(): WeaponHud;

  // ------------------------------------------------------------------ rendu

  /** Sous les entités (aura, traînées...). */
  drawUnder(_ctx: CanvasRenderingContext2D, _time: number): void {}

  // ---- rendu : sprite pixel art ----

  /** Angle utilisé pour choisir la vue (face/dos/profil) : la visée par défaut. */
  protected spriteFacingAngle(): number {
    return this.aim;
  }
  /** Remplacements de couleurs de la palette (ex. couleur de l'aura de Tempo). */
  protected spriteOverrides(): Record<string, string> | undefined {
    return undefined;
  }
  protected spriteTint(): { color: string; alpha: number } | undefined {
    return undefined;
  }
  /** Accessoires (marteau, flash de tir...) dessinés derrière ou devant le sprite. */
  protected drawSpriteExtras(_ctx: CanvasRenderingContext2D, _layout: SpriteLayout, _front: boolean): void {}

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const def = this.stats.sprite;
    const layout = characterLayout(def, this.x, this.y, this.stats.px);
    drawGroundRing(ctx, this.x, layout.feetY, this.hw, teamColor(this.team), this.aim);
    this.drawSpriteExtras(ctx, layout, false);
    drawCharacter(ctx, def, {
      x: this.x,
      y: this.y,
      px: this.stats.px,
      facing: facingFromAngle(this.spriteFacingAngle()),
      frame: walkFrame(this.animTime),
      outline: teamColor(this.team),
      overrides: this.spriteOverrides(),
      flash: this.hurtTimer > 0.2,
      tint: this.spriteTint(),
    });
    this.drawSpriteExtras(ctx, layout, true);
  }

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
    const barBottom = this.y - this.hh - this.stats.px - 4;
    drawHealthBar(ctx, this.x, barBottom, this.hp, this.maxHp, low ? COLORS.hpLow : COLORS.hpPlayer, width);
    if (this.buff) drawBuffIndicator(ctx, this.x + width / 2 + 12, barBottom - 3.5, this.buff);
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
