import type { GameContext } from '../core/GameContext';
import { circleInCone, circlesOverlap, distToCircle } from '../core/geometry';
import { angleDiff, clamp, degToRad, randRange, TAU } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Projectile } from '../entities/Projectile';
import type { Team } from '../entities/Team';
import type { WorldObject } from '../entities/WorldObject';
import { t } from '../i18n';
import { cached, drawTeamMarker, hand, head, thorHairBack, thorHairTop, thorHammer as drawThorHammer } from '../render/topdown';
import { lineOfSight } from '../world/Visibility';
import { PHANTOM } from './Flux';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';
import { HAMMER as REMPART_HAMMER, SHIELD as REMPART_SHIELD } from './Rempart';

/** Rayon de la boule (= hitbox), peau, bandages des mains. */
const R = 23;
const SKIN = '#e9b48f';
const WRAP = { color: '#d8c7a5', lines: '#b9a47e' };
/** Marteau : longueur du manche et taille de la tête (unités monde). */
const HAMMER_LEN = 26;
const HAMMER_HEAD = 17;

function thorHammer(ctx: CanvasRenderingContext2D): void {
  cached(ctx, 'thor.hammer', 40, (c) => drawThorHammer(c, HAMMER_LEN, HAMMER_HEAD, LIGHTNING));
}

/**
 * Démarche lourde : Thor se dandine. Sur un cycle de deux pas (u de 0 à 1) :
 * - le poids passe d'un pied sur l'autre : la boule se décale de côté et penche un peu ;
 * - à chaque pas posé (u = 0 et 0,5), elle s'écrase légèrement et soulève de la poussière ;
 * - le marteau tenu balance au rythme des pas.
 */
const WADDLE = {
  stride: 140, // distance parcourue par cycle de deux pas (≈ 1,05 s à vitesse normale)
  sway: 2.5, // décalage latéral du corps
  tilt: 0.055, // inclinaison (rad) vers le pied posé
  squash: 0.05, // écrasement à l'impact du pied
  impactWindow: 0.09, // durée de l'écrasement (fraction de cycle)
  hammerSwing: 0.12, // balancement du marteau (rad)
  dustSpeed: 70,
};
export const LIGHTNING = '#8fdcff';
const LIGHTNING_DEEP = '#3f8cff';

/** Clic G : marteau en arc (mêmes valeurs que Rempart), puis de l'autre côté au coup suivant. */
export const SWING = { ...REMPART_HAMMER, anim: 0.26 };
/** Clic G sans marteau (lancé) : petits coups de poing. */
export const PUNCH = { damage: 25, interval: 0.4, reach: 26, halfArc: degToRad(45), knockback: 60, anim: 0.16 };

/** Clic D (maintenu) : mur de foudre droit, face à Thor. */
export const BARRIER = {
  maxHp: REMPART_SHIELD.maxHp,
  distance: 64, // du centre de Thor au mur
  halfWidth: 70,
  thickness: 10,
  regenRate: REMPART_SHIELD.regenRate,
  regenDelay: REMPART_SHIELD.regenDelay,
  brokenCooldown: REMPART_SHIELD.brokenCooldown,
  speedMul: REMPART_SHIELD.speedMul,
};

/**
 * Espace : ruée en avant (même distance que le Transfert de Flux), coup de marteau au bout
 * ou sur le premier ennemi percuté. Sans marteau : ruée vers le marteau jusqu'à le ramasser,
 * avec une décharge de foudre autour de Thor.
 */
export const SMASH = {
  cooldown: 6,
  distance: PHANTOM.distance,
  speed: 1050 * MOVE_SPEED_SCALE, // ≈ 625 : ruée de ~0,16 s
  damage: 70,
  reach: 70, // coup de marteau au bout de la ruée (cône devant)
  halfArc: degToRad(60),
  knockback: 420,
  toHammerSpeed: 1250 * MOVE_SPEED_SCALE, // ≈ 745
  toHammerMaxTime: 1.6,
  pickupRadius: 34,
  pickupDamage: 70,
  pickupRadiusAoe: 120,
  pickupKnockback: 320,
};

/**
 * Maj : lance le marteau vers le point visé ; il tombe en déclenchant la foudre (dégâts de
 * zone). Maj à nouveau : il revient à Thor à travers les murs, en blessant au passage.
 */
export const THROW = {
  cooldown: 6, // compte à partir du moment où Thor récupère son marteau
  range: 460,
  minRange: 80,
  speed: 820,
  arcHeight: 40,
  damage: 80,
  minDamage: 40,
  radius: 105,
  knockback: 200,
  recallDelay: 0.2, // temps minimal avant de pouvoir rappeler
  recallSpeed: 1150,
  recallDamage: 45,
  recallHitRadius: 24,
  catchRadius: 30,
};

interface Swing {
  t: number;
  side: 1 | -1;
  dir: number;
  punch: boolean;
}

interface Dash {
  t: number;
  dir: number;
  /** Ruée vers le marteau lancé (ramassage) plutôt que ruée simple. */
  toHammer: boolean;
  traveled: number;
  trail: number;
}

/**
 * Thor — tank de mêlée au marteau de foudre (remplaçant de Rempart).
 * Clic G : Marteau (arc, puis poings s'il est lancé) · Clic D (maintenu) : Mur de foudre ·
 * Espace : Ruée (vers le marteau s'il est lancé) · Maj : Lancer / rappeler le marteau.
 */
export class Thor extends Hero {
  private attackTimer = 0;
  private swing: Swing | null = null;
  private swingSide: 1 | -1 = 1;

  barrierHp = BARRIER.maxHp;
  barrierUp = false;
  private barrierAngle = 0;
  private barrierRegenDelay = 0;
  private barrierBroken = 0;
  private barrierFlash = 0;

  private dashCooldown = 0;
  private dash: Dash | null = null;
  private throwCooldown = 0;
  /** Marteau lancé (null = en main). */
  hammer: ThrownHammer | null = null;
  private throwAnim = 0;
  /** Cycle de marche (2 pas par unité), avancé selon la distance parcourue. */
  private walkCycle = 0;

  constructor() {
    super({
      name: 'Thor',
      maxHp: 600,
      radius: R,
      speed: 220,
      acceleration: 10,
      mass: 2,
      color: '#5ab4ff',
    });
  }

  // ---- état lu par l'IA ----
  get hasHammer(): boolean {
    return this.hammer === null;
  }
  get dashReady(): boolean {
    return this.dashCooldown <= 0 && this.dash === null;
  }
  get isDashing(): boolean {
    return this.dash !== null;
  }
  get throwReady(): boolean {
    return this.hammer === null && this.throwCooldown <= 0;
  }
  get barrierAvailable(): boolean {
    return this.barrierBroken <= 0 && this.barrierHp > 1;
  }
  get attackReady(): boolean {
    return this.attackTimer <= 0;
  }
  get meleeReach(): number {
    return this.hammer ? PUNCH.reach : SWING.reach;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number, ctx: GameContext): void {
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (!this.hammer) this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    this.barrierBroken = Math.max(0, this.barrierBroken - dt);
    this.barrierFlash = Math.max(0, this.barrierFlash - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t >= (this.swing.punch ? PUNCH.anim : SWING.anim)) this.swing = null;
    }
    if (!this.barrierUp) {
      this.barrierRegenDelay -= dt;
      if (this.barrierRegenDelay <= 0) this.barrierHp = Math.min(BARRIER.maxHp, this.barrierHp + BARRIER.regenRate * dt);
    }
    // Démarche : le cycle avance avec la distance parcourue (plus lent derrière le mur de foudre).
    // À chaque pas posé (u = 0 et 0,5), un nuage de poussière sous le pied.
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 30 && !this.dash) {
      const before = Math.floor(this.walkCycle * 2);
      this.walkCycle += (speed * dt) / WADDLE.stride;
      if (Math.floor(this.walkCycle * 2) !== before) this.footfall(ctx);
    }
  }

  /** Pas lourd : poussière sous le pied qui se pose (pied droit de l'image à u = 0, gauche à u = 0,5). */
  private footfall(ctx: GameContext): void {
    const u = this.walkCycle % 1;
    const side = u < 0.5 ? 1 : -1;
    // De part et d'autre de la boule, perpendiculairement à la marche.
    const m = Math.atan2(this.vy, this.vx) + (side * Math.PI) / 2;
    const fx = this.x + Math.cos(m) * this.radius * 0.8;
    const fy = this.y + Math.sin(m) * this.radius * 0.8;
    ctx.effects.sparks(fx, fy, '#8d8273', 5, WADDLE.dustSpeed);
    ctx.effects.sparks(fx, fy, '#b3a894', 3, WADDLE.dustSpeed * 0.6);
  }

  /** u ∈ [0, 1) : position dans le cycle de marche (deux pas). */
  private get walkU(): number {
    return ((this.walkCycle % 1) + 1) % 1;
  }

  /** Thor se bat déjà au corps à corps : pas de mêlée rapide. */
  override hasQuickMelee(): boolean {
    return false;
  }

  protected override speedMultiplier(): number {
    return this.barrierUp ? BARRIER.speedMul : 1;
  }

  protected override isLocked(): boolean {
    return this.dash !== null;
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    this.updateDash(dt, ctx);
  }

  protected override onStunned(): void {
    this.setBarrier(false);
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    const input = this.controls;

    // Mur de foudre : maintenu tant que le clic droit est enfoncé.
    const want = input.held('secondary') && this.barrierBroken <= 0 && this.barrierHp > 1;
    if (want !== this.barrierUp) this.setBarrier(want);
    if (this.barrierUp) this.barrierAngle += angleDiff(this.barrierAngle, this.aim) * (1 - Math.exp(-18 * dt));

    if (input.held('primary') && !this.barrierUp && this.attackTimer <= 0) this.attack(ctx);
    if (input.pressed('ability1') && this.dashCooldown <= 0) this.startDash(ctx);
    if (input.pressed('ability2')) {
      if (this.hammer) this.hammer.recall(ctx);
      else if (this.throwCooldown <= 0) this.throwHammer(ctx);
    }
  }

  protected override onDeath(): void {
    this.dash = null;
    this.setBarrier(false);
    // Le marteau disparaît et revient dans la main de Thor à la réapparition.
    if (this.hammer) this.hammer.done = true;
    this.hammer = null;
  }

  protected override onRespawn(): void {
    if (this.hammer) this.hammer.done = true;
    this.hammer = null;
    this.dash = null;
    this.swing = null;
    this.setBarrier(false);
    this.attackTimer = 0;
    this.barrierHp = BARRIER.maxHp;
    this.barrierBroken = 0;
    this.dashCooldown = 0;
    this.throwCooldown = 0;
  }

  // ------------------------------------------------------------ Marteau / poings

  private attack(ctx: GameContext): void {
    const punch = this.hammer !== null;
    const a = punch ? PUNCH : SWING;
    this.attackTimer = a.interval;
    this.swingSide = this.swingSide === 1 ? -1 : 1;
    this.swing = { t: 0, side: this.swingSide, dir: this.aim, punch };
    const reach = this.radius + a.reach;
    ctx.effects.wedge(this.x, this.y, this.aim, a.halfArc, reach, punch ? '#e8eef5' : LIGHTNING, punch ? 0.12 : 0.2, this.radius);

    let hit = false;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!circleInCone(this.x, this.y, this.aim, a.halfArc, reach, c.circle())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue; // pas de coup à travers un mur
      ctx.damage(c, a.damage, this);
      const d = Math.hypot(c.x - this.x, c.y - this.y) || 1;
      c.applyImpulse(((c.x - this.x) / d) * a.knockback, ((c.y - this.y) / d) * a.knockback, this);
      if (!punch) ctx.effects.bolt(this.x, this.y, c.x, c.y, LIGHTNING, 0.14, 2, 10);
      hit = true;
    }
    if (hit) ctx.shake(punch ? 1.5 : 3, this);
  }

  // ------------------------------------------------------------ Mur de foudre

  private setBarrier(up: boolean): void {
    if (up === this.barrierUp) return;
    this.barrierUp = up;
    if (up) this.barrierAngle = this.aim;
    else this.barrierRegenDelay = BARRIER.regenDelay;
  }

  /** Arrête les projectiles ENNEMIS qui touchent le mur ; les tirs alliés le traversent. */
  override shieldBlocks(p: Projectile): boolean {
    if (!this.barrierUp || p.team === this.team) return false;
    const dx = Math.cos(this.barrierAngle);
    const dy = Math.sin(this.barrierAngle);
    const ox = p.x - this.x;
    const oy = p.y - this.y;
    const along = ox * dx + oy * dy;
    const side = -ox * dy + oy * dx;
    if (Math.abs(along - BARRIER.distance) > BARRIER.thickness + p.radius) return false;
    if (Math.abs(side) > BARRIER.halfWidth + p.radius) return false;

    this.barrierHp -= p.damage * (p.owner?.damageMultiplier ?? 1);
    this.barrierFlash = 0.08;
    if (this.barrierHp <= 0) {
      this.barrierHp = 0;
      this.barrierBroken = BARRIER.brokenCooldown;
      this.setBarrier(false);
    }
    return true;
  }

  // ------------------------------------------------------------ Ruée

  private startDash(ctx: GameContext): void {
    this.setBarrier(false);
    const toHammer = this.hammer !== null;
    const dir = toHammer ? Math.atan2(this.hammer!.y - this.y, this.hammer!.x - this.x) : this.aim;
    this.dash = { t: 0, dir, toHammer, traveled: 0, trail: 0 };
    this.swing = null;
    this.vx = this.vy = 0;
    ctx.effects.ring(this.x, this.y, LIGHTNING, 46, 0.25);
    ctx.effects.bolt(this.x, this.y, this.x - Math.cos(dir) * 50, this.y - Math.sin(dir) * 50, LIGHTNING, 0.2, 2, 10);
  }

  private updateDash(dt: number, ctx: GameContext): void {
    const d = this.dash!;
    d.t += dt;
    const h = this.hammer;
    if (d.toHammer) {
      // Suit le marteau (il peut encore voler ou revenir) jusqu'à l'atteindre.
      if (!h) return this.endDash(ctx);
      d.dir = Math.atan2(h.y - this.y, h.x - this.x);
      if (Math.hypot(h.x - this.x, h.y - this.y) <= SMASH.pickupRadius) return this.pickup(ctx);
      if (d.t >= SMASH.toHammerMaxTime) return this.endDash(ctx);
    }
    const speed = d.toHammer ? SMASH.toHammerSpeed : SMASH.speed;
    let dist = speed * dt;
    if (!d.toHammer) dist = Math.min(dist, SMASH.distance - d.traveled);
    const dx = Math.cos(d.dir);
    const dy = Math.sin(d.dir);
    const steps = Math.max(1, Math.ceil(dist / 6)); // sous-pas : pas de traversée de mur
    for (let s = 0; s < steps; s++) {
      const nx = this.x + (dx * dist) / steps;
      const ny = this.y + (dy * dist) / steps;
      // Murs et bords de lave arrêtent la ruée.
      if (ctx.arena.circleCollides(nx, ny, this.radius - 0.5, this.team)) {
        if (!d.toHammer) this.smash(ctx);
        return this.endDash(ctx);
      }
      this.x = nx;
      this.y = ny;
      d.traveled += dist / steps;
      if (d.toHammer) {
        if (h && Math.hypot(h.x - this.x, h.y - this.y) <= SMASH.pickupRadius) return this.pickup(ctx);
      } else if (this.bumpsEnemy(ctx, dx, dy)) {
        // Premier ennemi percuté : le coup de marteau part tout de suite.
        this.smash(ctx);
        return this.endDash(ctx);
      }
    }
    d.trail -= dt;
    if (d.trail <= 0) {
      d.trail = 0.025;
      ctx.effects.afterimage(this.x, this.y, this.radius, LIGHTNING_DEEP, 0.22);
      if (Math.random() < 0.5) {
        const bx = this.x - dx * this.radius + randRange(-8, 8);
        const by = this.y - dy * this.radius + randRange(-8, 8);
        ctx.effects.bolt(bx, by, bx - dx * 34 + randRange(-10, 10), by - dy * 34 + randRange(-10, 10), LIGHTNING, 0.12, 1.6, 6);
      }
    }
    if (!d.toHammer && d.traveled >= SMASH.distance - 0.5) {
      this.smash(ctx);
      this.endDash(ctx);
    }
  }

  private bumpsEnemy(ctx: GameContext, dx: number, dy: number): boolean {
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!circlesOverlap(this.circle(), c.circle(), 4)) continue;
      const ox = c.x - this.x;
      const oy = c.y - this.y;
      if ((ox * dx + oy * dy) / (Math.hypot(ox, oy) || 1) > 0.2) return true;
    }
    return false;
  }

  /** Coup de marteau au bout de la ruée : cône devant Thor, gros recul. */
  private smash(ctx: GameContext): void {
    const dir = this.dash!.dir;
    const reach = this.radius + SMASH.reach;
    this.swingSide = this.swingSide === 1 ? -1 : 1;
    this.swing = { t: SWING.anim * 0.35, side: this.swingSide, dir, punch: false };
    ctx.effects.wedge(this.x, this.y, dir, SMASH.halfArc, reach, LIGHTNING, 0.25, this.radius * 0.5);
    let hit = false;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!circleInCone(this.x, this.y, dir, SMASH.halfArc, reach, c.circle())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      ctx.damage(c, SMASH.damage, this);
      c.applyImpulse(Math.cos(dir) * SMASH.knockback, Math.sin(dir) * SMASH.knockback, this);
      ctx.effects.bolt(this.x, this.y, c.x, c.y, LIGHTNING, 0.2, 2.5, 12);
      ctx.effects.sparks(c.x, c.y, LIGHTNING, 12, 300);
      hit = true;
    }
    ctx.shake(hit ? 6 : 3, this);
  }

  /** Ramassage du marteau au bout d'une ruée : décharge de foudre autour de Thor. */
  private pickup(ctx: GameContext): void {
    if (this.hammer) this.hammer.done = true;
    this.hammer = null;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (distToCircle(this.x, this.y, c.circle()) > SMASH.pickupRadiusAoe) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      ctx.damage(c, SMASH.pickupDamage, this);
      const ax = c.x - this.x;
      const ay = c.y - this.y;
      const n = Math.hypot(ax, ay) || 1;
      c.applyImpulse((ax / n) * SMASH.pickupKnockback, (ay / n) * SMASH.pickupKnockback, this);
      ctx.effects.bolt(this.x, this.y, c.x, c.y, LIGHTNING, 0.25, 2.5, 14);
    }
    ctx.effects.lightningBurst(this.x, this.y, SMASH.pickupRadiusAoe, LIGHTNING, 9, 0.3);
    ctx.effects.ring(this.x, this.y, LIGHTNING, SMASH.pickupRadiusAoe, 0.35);
    ctx.shake(7, this);
    this.endDash(ctx);
  }

  private endDash(ctx: GameContext): void {
    if (!this.dash) return;
    this.dash = null;
    this.dashCooldown = SMASH.cooldown;
    this.vx = this.vy = 0;
    ctx.arena.resolveCircle(this, this.radius, this.team);
  }

  // ------------------------------------------------------------ Lancer

  private throwHammer(ctx: GameContext): void {
    const c = this.controls;
    let tx = c.aimX - this.x;
    let ty = c.aimY - this.y;
    const d = Math.hypot(tx, ty) || 1;
    const dist = clamp(d, THROW.minRange, THROW.range);
    tx = this.x + (tx / d) * dist;
    ty = this.y + (ty / d) * dist;
    // Le marteau vole au ras des têtes : il s'arrête contre le premier mur sur sa route.
    const steps = Math.ceil(dist / 8);
    let ex = this.x;
    let ey = this.y;
    for (let i = 1; i <= steps; i++) {
      const px = this.x + ((tx - this.x) * i) / steps;
      const py = this.y + ((ty - this.y) * i) / steps;
      if (ctx.arena.pointInWall(px, py)) break;
      ex = px;
      ey = py;
    }
    this.hammer = new ThrownHammer(this, this.x, this.y, ex, ey);
    ctx.spawnObject(this.hammer);
    this.throwAnim = 0.25;
    this.swing = null;
    this.setBarrier(false);
  }

  /** Appelé par le marteau quand il revient dans la main de Thor. */
  catchHammer(ctx: GameContext): void {
    this.hammer = null;
    this.throwCooldown = THROW.cooldown;
    ctx.effects.sparks(this.x, this.y, LIGHTNING, 10, 200);
  }

  get throwCooldownLeft(): number {
    return this.throwCooldown;
  }

  // ------------------------------------------------------------ rendu

  override drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.dead || !this.dash || this.dash.toHammer) return;
    // Couloir de la ruée (très bref) : la fin de la course, au sol.
    const d = this.dash;
    const left = Math.max(0, SMASH.distance - d.traveled);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(d.dir);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = LIGHTNING;
    ctx.fillRect(0, -this.radius * 0.8, left + SMASH.reach, this.radius * 1.6);
    ctx.restore();
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const moving = Math.hypot(this.vx, this.vy) > 30;
    const dash = this.dash;
    const sw = this.swing;
    const face = dash ? dash.dir : sw ? sw.dir : this.aim;
    drawTeamMarker(ctx, this.x, this.y, R, this.outline);

    // Dandinement (voir WADDLE) : > 0 quand le poids est sur le pied droit.
    const walking = moving && !dash;
    const u = this.walkU;
    const weight = walking ? Math.sin(TAU * u) : 0;
    const toStep = Math.min(u, Math.abs(u - 0.5), 1 - u); // distance au pas posé le plus proche
    const impact = walking ? Math.max(0, 1 - toStep / WADDLE.impactWindow) : 0;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(face);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (walking) {
      // Le corps passe d'un pied sur l'autre (de côté), penche un peu et s'écrase à chaque pas.
      const k = 1 + impact * WADDLE.squash;
      ctx.translate(0, weight * WADDLE.sway);
      ctx.rotate(weight * WADDLE.tilt);
      ctx.scale(k, k);
    }
    this.drawBody(ctx, face, weight);
    if (this.hurtTimer > 0.2) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  protected drawTop(ctx: CanvasRenderingContext2D, rot: number): void {
    this.drawBody(ctx, rot, 0);
  }

  /**
   * Repère local (regard vers +x). Marteau tenu à droite, qui balance au rythme des pas ;
   * frappe : arc d'un côté à l'autre de la visée ; ruée : pointé droit devant ; marteau lancé :
   * poings (coup de poing alterné), main tendue pendant le lancer.
   */
  private drawBody(ctx: CanvasRenderingContext2D, rot: number, weight: number): void {
    const hr = R * 0.3;
    const wrap = { wrap: WRAP.lines };
    const sw = this.swing;
    const dash = this.dash;
    const body = () => {
      cached(ctx, 'thor.head', R * 1.6, (c) => {
        thorHairBack(c, R);
        head(c, R, SKIN);
        thorHairTop(c, R);
      });
    };
    if (this.hammer === null) {
      let a = 0.55 - weight * WADDLE.hammerSwing;
      if (sw && !sw.punch) {
        const k = clamp(sw.t / SWING.anim, 0, 1);
        const e = 1 - (1 - k) * (1 - k);
        a = sw.side * (1 - 2 * e) * 1.15;
      } else if (dash) a = 0;
      const gx = Math.cos(a) * R * 1.05;
      const gy = Math.sin(a) * R * 1.05;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(a);
      thorHammer(ctx);
      ctx.restore();
      body();
      hand(ctx, gx, gy, hr, WRAP.color, rot, wrap);
      hand(ctx, R * (dash ? 0.9 : 0.55), -R * (dash ? 0.55 : 0.85), hr, WRAP.color, rot, wrap);
      return;
    }
    // Sans marteau : poings.
    body();
    const throwing = this.throwAnim > 0 ? Math.sin((1 - this.throwAnim / 0.25) * Math.PI) : 0;
    const punch = sw && sw.punch ? Math.sin(clamp(sw.t / PUNCH.anim, 0, 1) * Math.PI) : 0;
    for (const side of [-1, 1]) {
      const jab = (sw && sw.punch && sw.side === side ? punch : 0) + (side === 1 ? throwing : 0);
      hand(ctx, R * (0.75 + jab * 0.7), side * R * (0.75 - jab * 0.35), hr, WRAP.color, rot, wrap);
    }
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead || !this.barrierUp) return;
    const ratio = this.barrierHp / BARRIER.maxHp;
    const dx = Math.cos(this.barrierAngle);
    const dy = Math.sin(this.barrierAngle);
    const cx = this.x + dx * BARRIER.distance;
    const cy = this.y + dy * BARRIER.distance;
    const ex = -dy * BARRIER.halfWidth;
    const ey = dx * BARRIER.halfWidth;

    // Bande translucide
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.16 + 0.18 * ratio + (this.barrierFlash > 0 ? 0.25 : 0);
    ctx.strokeStyle = LIGHTNING;
    ctx.lineWidth = BARRIER.thickness * 2;
    ctx.beginPath();
    ctx.moveTo(cx - ex, cy - ey);
    ctx.lineTo(cx + ex, cy + ey);
    ctx.stroke();

    // Éclairs qui parcourent le mur (redessinés à chaque image : ils grésillent).
    ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const u = i / n - 0.5;
        const off = i === 0 || i === n ? 0 : randRange(-1, 1) * BARRIER.thickness * 0.9;
        const x = cx + ex * 2 * u + dx * off;
        const y = cy + ey * 2 * u + dy * off;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = k === 0 ? 0.95 : 0.5;
      ctx.strokeStyle = k === 0 ? '#f4fbff' : LIGHTNING;
      ctx.lineWidth = k === 0 ? 1.6 : 2.4;
      ctx.stroke();
    }

    // Bords lumineux (extrémités)
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = this.barrierFlash > 0 ? '#ffffff' : LIGHTNING;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + ex * s, cy + ey * s, randRange(3, 5), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    return [
      {
        input: 'secondary',
        name: t('thor.barrier'),
        icon: 'shield',
        color: LIGHTNING,
        cooldown: this.barrierBroken,
        cooldownMax: BARRIER.brokenCooldown,
        active: this.barrierUp,
        bar: this.barrierHp / BARRIER.maxHp,
        label: t('hud.shieldHp', { hp: Math.ceil(this.barrierHp) }),
      },
      {
        input: 'ability1',
        name: t('thor.smash'),
        icon: 'charge',
        color: LIGHTNING,
        cooldown: this.dash ? 0 : this.dashCooldown,
        cooldownMax: SMASH.cooldown,
        active: this.dash !== null,
        label: this.hammer ? t('thor.toHammer') : undefined,
      },
      {
        input: 'ability2',
        name: this.hammer ? t('thor.recall') : t('thor.throw'),
        icon: 'hammer',
        color: LIGHTNING,
        cooldown: this.hammer ? 0 : this.throwCooldown,
        cooldownMax: THROW.cooldown,
        active: this.hammer !== null,
      },
    ];
  }

  weaponHud(): WeaponHud {
    const a = this.hammer ? PUNCH : SWING;
    return { name: this.hammer ? t('thor.fists') : t('thor.weapon'), readyRatio: 1 - this.attackTimer / a.interval };
  }
}

/**
 * Marteau lancé : vole en tournoyant jusqu'au point visé (ou au premier mur), tombe en
 * déclenchant la foudre, reste au sol en grésillant. Rappelé, il revient à Thor à travers
 * les murs en blessant les ennemis qu'il traverse.
 */
export class ThrownHammer implements WorldObject {
  readonly team: Team;
  x: number;
  y: number;
  phase: 'flight' | 'landed' | 'recall' = 'flight';
  /** true : retiré du monde (rattrapé, ramassé, Thor mort). */
  done = false;
  private t = 0;
  private readonly flight: number;
  private readonly dir: number;
  private spin = 0;
  private crackle = 0;
  private readonly hit = new Set<Combatant>();

  constructor(
    private readonly owner: Thor,
    private readonly fromX: number,
    private readonly fromY: number,
    private readonly toX: number,
    private readonly toY: number,
  ) {
    this.team = owner.team;
    this.x = fromX;
    this.y = fromY;
    this.flight = Math.max(0.12, Math.hypot(toX - fromX, toY - fromY) / THROW.speed);
    this.dir = Math.atan2(toY - fromY, toX - fromX);
  }

  /** Rappel (Maj à nouveau) : possible un court instant après le lancer. */
  recall(ctx: GameContext): void {
    if (this.phase === 'recall' || this.t < THROW.recallDelay && this.phase === 'flight') return;
    this.phase = 'recall';
    this.hit.clear();
    ctx.effects.ring(this.x, this.y, LIGHTNING, 30, 0.2);
  }

  update(dt: number, ctx: GameContext): boolean {
    if (this.done) return false;
    this.t += dt;
    if (this.phase === 'flight') {
      const u = Math.min(1, this.t / this.flight);
      this.x = this.fromX + (this.toX - this.fromX) * u;
      this.y = this.fromY + (this.toY - this.fromY) * u;
      this.spin += dt * 22;
      if (u >= 1) this.land(ctx);
    } else if (this.phase === 'landed') {
      this.crackle -= dt;
      if (this.crackle <= 0) {
        this.crackle = randRange(0.25, 0.6);
        const a = randRange(0, TAU);
        ctx.effects.bolt(this.x, this.y, this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 14, LIGHTNING, 0.1, 1.4, 5);
      }
    } else {
      // Retour vers Thor, à travers les murs.
      const o = this.owner;
      const dx = o.x - this.x;
      const dy = o.y - this.y;
      const d = Math.hypot(dx, dy);
      const step = THROW.recallSpeed * dt;
      this.spin -= dt * 26;
      if (d <= Math.max(THROW.catchRadius, step)) {
        this.done = true;
        o.catchHammer(ctx);
        return false;
      }
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      for (const c of ctx.targets) {
        if (!c.alive || !hostile(this, c) || this.hit.has(c)) continue;
        if (distToCircle(this.x, this.y, c.circle()) > THROW.recallHitRadius) continue;
        this.hit.add(c);
        ctx.damage(c, THROW.recallDamage, o);
        ctx.effects.sparks(c.x, c.y, LIGHTNING, 10, 260);
        ctx.effects.bolt(this.x, this.y, c.x, c.y, LIGHTNING, 0.12, 2, 8);
      }
    }
    return true;
  }

  /** Impact : foudre en zone (plus forte au centre), le marteau reste planté au sol. */
  private land(ctx: GameContext): void {
    this.phase = 'landed';
    this.x = this.toX;
    this.y = this.toY;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      const d = distToCircle(this.x, this.y, c.circle());
      if (d > THROW.radius) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      const k = d / THROW.radius;
      ctx.damage(c, THROW.damage - (THROW.damage - THROW.minDamage) * k, this.owner);
      const ax = c.x - this.x;
      const ay = c.y - this.y;
      const n = Math.hypot(ax, ay) || 1;
      c.applyImpulse((ax / n) * THROW.knockback, (ay / n) * THROW.knockback, this.owner);
      ctx.effects.bolt(this.x, this.y - 60, c.x, c.y, LIGHTNING, 0.25, 2.5, 12);
    }
    // L'éclair tombe du ciel sur le marteau, puis se répand autour.
    ctx.effects.bolt(this.x + randRange(-20, 20), this.y - 260, this.x, this.y, LIGHTNING, 0.3, 4, 26);
    ctx.effects.lightningBurst(this.x, this.y, THROW.radius, LIGHTNING, 8, 0.3);
    ctx.effects.ring(this.x, this.y, LIGHTNING, THROW.radius, 0.35);
    ctx.effects.sparks(this.x, this.y, '#f4fbff', 16, 320);
    ctx.shake(6, this);
  }

  drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'recall') return;
    ctx.save();
    if (this.phase === 'flight') {
      // Zone d'impact visible pendant le vol.
      ctx.strokeStyle = this.owner.outline;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.arc(this.toX, this.toY, THROW.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      // Ombre du marteau sous sa position en vol
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(this.x + 4, this.y + 6, 12, 0, TAU);
      ctx.fill();
    } else {
      // Au sol : lueur électrique
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 9);
      ctx.globalAlpha = 0.18 + 0.12 * pulse;
      ctx.fillStyle = LIGHTNING;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 26, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'landed') return;
    // Couché au sol dans le sens du lancer, la tête au point d'impact.
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.dir);
    ctx.translate(-HAMMER_LEN, 0);
    thorHammer(ctx);
    ctx.restore();
  }

  /** En vol et pendant le retour : au-dessus de tout (murs compris), en tournoyant. */
  drawSky(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'landed') return;
    let lift = 18;
    if (this.phase === 'flight') {
      const u = Math.min(1, this.t / this.flight);
      lift = 10 + Math.sin(Math.PI * u) * THROW.arcHeight;
    }
    // Il tournoie autour du milieu du manche ; vu de dessus, il grossit en montant.
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(1 + lift / 70, 1 + lift / 70);
    ctx.rotate(this.spin);
    ctx.translate(-HAMMER_LEN * 0.6, 0);
    thorHammer(ctx);
    ctx.restore();
    // Traînée de foudre
    if (Math.random() < 0.6) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = LIGHTNING;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      for (let i = 1; i <= 3; i++) ctx.lineTo(this.x + randRange(-14, 14), this.y + randRange(-14, 14));
      ctx.stroke();
      ctx.restore();
    }
  }
}
