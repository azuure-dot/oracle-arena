import { BOT, COLORS, PLAYER_SPAWN, ZONES } from '../config';
import { NO_CONTROLS, type HeroControls } from '../core/Controls';
import type { GameContext } from '../core/GameContext';
import { boxExtent, boxInCone, distToBox, type Box } from '../core/geometry';
import { damp, degToRad, type Vec2 } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Projectile } from '../entities/Projectile';
import { ALLY, type Team } from '../entities/Team';
import type { TKey } from '../i18n';
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
import { drawBuffIndicator, drawHealthBar, drawStunStars, type BuffKind } from '../ui/healthBar';
import { lineOfSight } from '../world/Visibility';

/** Emplacement de touche : le libellé affiché est traduit par le HUD (Clic D / RMB...). */
export type InputSlot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'melee';

export const INPUT_LABEL_KEYS: Record<InputSlot, TKey> = {
  primary: 'key.primary',
  secondary: 'key.secondary',
  ability1: 'key.ability1',
  ability2: 'key.ability2',
  melee: 'key.melee',
};

/** Soin passif de tous les héros : après 3 s sans subir de dégâts. */
export const PASSIVE_REGEN = {
  delay: 3, // s sans dégâts
  rate: 15, // PV/s
};

/** Délai de réapparition par défaut (champ de tir, Deathmatch). La Partie rapide utilise 8 s. */
export const RESPAWN_TIME = 3;

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
  /** Résistance au recul (2 = reculs deux fois plus courts). */
  mass?: number;
  color: string;
}

/**
 * Classe parente de tous les héros, joués par un humain OU par un bot :
 * le héros lit ses `controls` (clavier ou IA) et ne sait pas qui le pilote.
 * Elle gère : PV, mort/réapparition, déplacement fluide, recul, visée, zones.
 * Les sous-classes branchent leurs compétences via les "hooks" protégés.
 *
 * Ordre d'une frame :
 *   tick() → [épinglé ? rien : isLocked() ? updateLocked() : move() + handleInput()] → zones → lateUpdate()
 */
export abstract class Hero implements Combatant {
  /** Équipe : 'ally' au champ de tir, une équipe par participant en Deathmatch. */
  team: Team = ALLY;
  /** Qui pilote ce héros (clavier du joueur ou IA). */
  controls: HeroControls = NO_CONTROLS;
  /** true pour le héros du joueur : aperçus réservés au joueur, couleur de la barre de vie. */
  isLocalPlayer = false;
  /** Contour du sprite vu par le joueur : bleu = lui / allié, rouge = adversaire. */
  outline: string = COLORS.ally;
  /** Nom affiché au-dessus de la barre de vie (bots du Deathmatch). */
  label: string | null = null;
  /** Visible par le joueur (calculé par le monde). */
  visible = true;

  x: number = PLAYER_SPAWN.x;
  y: number = PLAYER_SPAWN.y;
  vx = 0;
  vy = 0;
  aim = 0;
  hp: number;
  dead = false;
  respawnTimer = 0;
  hurtTimer = 0;
  pinned = false;
  /** Étourdi (plaqué contre un mur par une Charge) : aucun contrôle. */
  stunTimer = 0;
  /** Multiplicateur des dégâts infligés (bots : 0,7). */
  damageMultiplier = 1;
  /** Temps depuis les derniers dégâts subis (soin passif). */
  private sinceDamage = 0;
  /** Dans la zone de spawn de son équipe : invincible (mis à jour par le mode). */
  safe = false;
  /** Buff d'aura reçu cette frame (indicateur au-dessus de la tête). */
  buff: BuffKind | null = null;
  auraSpeedMul = 1;
  /** Direction de déplacement demandée (normalisée, ou 0). */
  protected moveDir: Vec2 = { x: 0, y: 0 };
  /** Temps d'animation de marche (0 = immobile). */
  protected animTime = 0;
  /** Mêlée rapide : temps de recharge restant / durée restante du coup en cours. */
  meleeCooldown = 0;
  private meleeAnim = 0;
  /** Recul (Onde de choc, marteau...) : vitesse qui s'amortit. */
  private kvx = 0;
  private kvy = 0;

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
  get alive(): boolean {
    return !this.dead;
  }
  get invulnerable(): boolean {
    return this.dead || this.safe;
  }
  /** Dispersion de l'arme pour le viseur (0 = viseur simple). */
  get spreadDeg(): number {
    return 0;
  }

  /** Place le héros (début de partie). */
  placeAt(p: Vec2): void {
    this.x = p.x;
    this.y = p.y;
    this.vx = this.vy = 0;
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, ctx: GameContext): void {
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);

    if (this.dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn(ctx);
      return;
    }

    const c = this.controls;
    this.aim = Math.atan2(c.aimY - this.y, c.aimX - this.x);
    this.moveDir = c.move;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.meleeAnim = Math.max(0, this.meleeAnim - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);

    // Soin passif : au bout de 3 s sans dégâts.
    this.sinceDamage += dt;
    if (this.sinceDamage >= PASSIVE_REGEN.delay) this.heal(PASSIVE_REGEN.rate * dt);

    this.tick(dt, ctx);
    if (this.pinned) {
      // Épinglé par une Charge : aucun contrôle, la position est imposée.
      this.vx = this.vy = this.kvx = this.kvy = 0;
    } else if (this.stunTimer > 0) {
      // Étourdi : immobile (les reculs s'appliquent quand même), aucune action.
      this.moveDir = { x: 0, y: 0 };
      this.move(dt, ctx);
    } else if (this.isLocked()) {
      this.kvx = this.kvy = 0;
      this.updateLocked(dt, ctx);
    } else {
      this.move(dt, ctx);
      if (this.hasQuickMelee() && c.pressed('melee') && this.meleeCooldown <= 0) this.quickMelee(ctx);
      this.handleInput(dt, ctx);
    }
    if (!this.dead) this.applyZones(dt, ctx);
    if (!this.dead) this.lateUpdate(dt, ctx);
    this.animTime = this.isWalking() ? this.animTime + dt * this.animRate() : 0;
  }

  /** Le sprite doit-il jouer l'animation de marche ? */
  protected isWalking(): boolean {
    return Math.hypot(this.vx, this.vy) > 30 || this.pinned;
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
  /** Début d'un étourdissement (ex. baisser le bouclier). */
  protected onStunned(): void {}

  /** Étourdit le héros (sauf s'il est invulnérable : Rappel, spawn). */
  stun(seconds: number): void {
    if (this.dead || this.invulnerable) return;
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.vx = this.vy = 0;
    this.onStunned();
  }
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
    let target: Combatant | null = null;
    let best = Infinity;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!boxInCone(this.x, this.y, this.aim, QUICK_MELEE.halfArc, reach, c.box())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      const d = distToBox(this.x, this.y, c.box());
      if (d < best) {
        best = d;
        target = c;
      }
    }
    if (!target) return;
    ctx.damage(target, QUICK_MELEE.damage, this);
    target.applyImpulse(dx * QUICK_MELEE.knockback, dy * QUICK_MELEE.knockback);
    ctx.effects.sparks(target.x - dx * target.hw, target.y - dy * target.hh, '#ffffff', 8, 200);
    ctx.shake(2, this);
  }

  protected move(dt: number, ctx: GameContext): void {
    const speed = this.stats.speed * this.speedMultiplier() * this.auraSpeedMul;
    const accel = this.stats.acceleration ?? 16;
    this.vx = damp(this.vx, this.moveDir.x * speed, accel, dt);
    this.vy = damp(this.vy, this.moveDir.y * speed, accel, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Recul subi : s'ajoute au déplacement et s'amortit (comme pour les bots).
    if (Math.hypot(this.kvx, this.kvy) > 1) {
      this.x += this.kvx * dt;
      this.y += this.kvy * dt;
      const decay = Math.exp(-BOT.knockbackDamping * dt);
      this.kvx *= decay;
      this.kvy *= decay;
    } else {
      this.kvx = this.kvy = 0;
    }
    ctx.arena.resolveBox(this, this.hw, this.hh, this.team);
  }

  applyImpulse(ix: number, iy: number): void {
    if (this.dead || this.pinned || this.isLocked()) return;
    const mass = this.stats.mass ?? 1;
    this.kvx += ix / mass;
    this.kvy += iy / mass;
  }

  private applyZones(dt: number, ctx: GameContext): void {
    const zone = ctx.arena.zoneAt(this.x, this.y);
    if (!zone) return;
    if (zone.kind === 'hazard') ctx.damage(this, ZONES.hazardDps * dt, null);
    else this.heal(ZONES.healHps * dt);
  }

  // ------------------------------------------------------------------- PV

  /** Retourne les dégâts réellement subis (0 si invulnérable). */
  takeDamage(amount: number, ctx: GameContext): number {
    if (this.invulnerable || amount <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.hurtTimer = 0.3;
    this.sinceDamage = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.pinned = false;
      this.respawnTimer = ctx.respawnDelay;
      ctx.effects.sparks(this.x, this.y, this.stats.color, 24, 320);
      this.onDeath(ctx);
    }
    return dealt;
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
    this.revive(ctx, ctx.respawnPoint(this));
  }

  /**
   * Remet le héros à neuf à cet endroit : PV au max, compétences réinitialisées (onRespawn).
   * Sert à la réapparition et au début de chaque manche.
   */
  revive(ctx: GameContext, at: Vec2): void {
    this.dead = false;
    this.hp = this.maxHp;
    this.placeAt(at);
    this.kvx = this.kvy = 0;
    this.buff = null;
    this.stunTimer = 0;
    this.sinceDamage = 0;
    this.pinned = false;
    this.hurtTimer = 0;
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
    drawGroundRing(ctx, this.x, layout.feetY, this.hw, this.outline, this.aim);
    this.drawSpriteExtras(ctx, layout, false);
    drawCharacter(ctx, def, {
      x: this.x,
      y: this.y,
      px: this.stats.px,
      facing: facingFromAngle(this.spriteFacingAngle()),
      frame: walkFrame(this.animTime),
      outline: this.outline,
      overrides: this.spriteOverrides(),
      flash: this.hurtTimer > 0.2,
      tint: this.spriteTint(),
    });
    this.drawSpriteExtras(ctx, layout, true);
    if (this.pinned) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.x - this.hw - 4, this.y - this.hh - 4, this.hw * 2 + 8, this.hh * 2 + 8);
      ctx.setLineDash([]);
    }
  }

  /** Au-dessus des entités (bouclier...). */
  drawOver(_ctx: CanvasRenderingContext2D): void {}

  /** Barre de vie (+ nom pour les bots) au-dessus du héros. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const low = this.hp / this.maxHp < 0.35;
    const width = this.maxHp > 300 ? 84 : 60;
    const barBottom = this.y - this.hh - this.stats.px - 4;
    let color: string;
    if (this.isLocalPlayer) color = low ? COLORS.hpLow : COLORS.hpPlayer;
    else color = this.outline === COLORS.ally ? COLORS.hpAlly : COLORS.hpEnemy;
    drawHealthBar(ctx, this.x, barBottom, this.hp, this.maxHp, color, width);
    if (this.buff) drawBuffIndicator(ctx, this.x + width / 2 + 12, barBottom - 3.5, this.buff);
    if (this.stunTimer > 0) drawStunStars(ctx, this.x, this.y - this.hh * 0.4);
    if (this.label) {
      ctx.fillStyle = this.outline;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.label, this.x, barBottom - 13);
    }
  }
}
