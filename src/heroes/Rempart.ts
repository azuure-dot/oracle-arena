import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { circleInCone, circlesOverlap } from '../core/geometry';
import { angleDiff, degToRad, rotateTowards } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import { Projectile } from '../entities/Projectile';
import { t } from '../i18n';
import { cached, hand, head, knightHelmet, rempartHammer } from '../render/topdown';
import { lineOfSight } from '../world/Visibility';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';

export const HAMMER = { damage: 75, interval: 0.95, reach: 95, halfArc: degToRad(55), knockback: 160 };
export const SHIELD = {
  maxHp: 1200,
  radius: 82, // distance du centre de Rempart à l'arc du bouclier
  halfArc: degToRad(62),
  thickness: 10,
  regenRate: 144, // PV/s
  regenDelay: 2, // s sans bouclier avant de régénérer
  brokenCooldown: 5,
  speedMul: 0.7,
};
export const FIRE = { cooldown: 8, damage: 100, speed: 950, radius: 26, range: 1000 };
export const CHARGE = {
  cooldown: 7,
  windup: 0.6, // préparation : immobile et prévisible avant de foncer
  windupTurnRate: 3, // rad/s : on peut encore viser pendant la préparation
  speed: 680 * MOVE_SPEED_SCALE, // ralentie comme la marche (476)
  maxDuration: 1.6,
  turnRate: 1.3, // rad/s : léger contrôle de trajectoire
  wallDamage: 250, // ennemi épinglé écrasé contre un mur
  wallStun: 2, // … puis étourdi
  slamRecovery: 0.5, // latence de Rempart après le plaquage
  bumpDamage: 50, // ennemis bousculés sur le côté
  bumpImpulse: 520,
};

/** Rayon de la boule (= hitbox). */
const R = 28;
const GAUNTLET = '#8e9bb0';

interface ChargeState {
  /** Temps restant de préparation (> 0 : Rempart est immobile et ne peut pas attaquer). */
  windup: number;
  t: number; // temps écoulé depuis le début de la course
  dir: number;
  pinned: Combatant | null;
  bumped: Set<Combatant>;
  trailTimer: number;
}

/**
 * Rempart — tank de mêlée.
 * Clic G : Marteau (arc) · Clic D (maintenu) : Bouclier · Espace : Onde de feu · Maj : Charge.
 */
export class Rempart extends Hero {
  private hammerTimer = 0;
  private swingAnim = 0;
  private swingSide = 1;

  shieldHp = SHIELD.maxHp;
  shieldUp = false;
  private shieldAngle = 0;
  private shieldRegenDelay = 0;
  private shieldBroken = 0;
  private shieldHitFlash = 0;

  private fireCooldown = 0;
  private fireAnim = 0;
  private chargeCooldown = 0;
  private charge: ChargeState | null = null;
  /** Latence après un plaquage contre un mur : Rempart ne peut ni bouger ni agir. */
  private slamRecovery = 0;

  constructor() {
    super({
      name: 'Rempart',
      maxHp: 600,
      radius: R, // très grosse boule
      speed: 220, // très lent
      acceleration: 10,
      mass: 2, // lourd : les reculs le déplacent deux fois moins
      color: '#a9b8c9',
    });
  }

  get isCharging(): boolean {
    return this.charge !== null;
  }

  // ---- état lu par l'IA ----
  get fireReady(): boolean {
    return this.fireCooldown <= 0;
  }
  get chargeReady(): boolean {
    return this.chargeCooldown <= 0 && this.charge === null;
  }
  get hammerReady(): boolean {
    return this.hammerTimer <= 0;
  }
  get shieldAvailable(): boolean {
    return this.shieldBroken <= 0 && this.shieldHp > 1;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number): void {
    this.hammerTimer = Math.max(0, this.hammerTimer - dt);
    this.swingAnim = Math.max(0, this.swingAnim - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.fireAnim = Math.max(0, this.fireAnim - dt);
    this.chargeCooldown = Math.max(0, this.chargeCooldown - dt);
    this.shieldBroken = Math.max(0, this.shieldBroken - dt);
    this.shieldHitFlash = Math.max(0, this.shieldHitFlash - dt);
    this.slamRecovery = Math.max(0, this.slamRecovery - dt);

    if (!this.shieldUp) {
      this.shieldRegenDelay -= dt;
      if (this.shieldRegenDelay <= 0) {
        this.shieldHp = Math.min(SHIELD.maxHp, this.shieldHp + SHIELD.regenRate * dt);
      }
    }
  }

  /** Rempart se bat déjà au corps à corps (Marteau) : pas de mêlée rapide. */
  override hasQuickMelee(): boolean {
    return false;
  }

  protected override speedMultiplier(): number {
    return this.shieldUp ? SHIELD.speedMul : 1;
  }

  protected override isLocked(): boolean {
    return this.charge !== null || this.slamRecovery > 0;
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    if (this.charge) this.updateCharge(dt, ctx);
    else this.vx = this.vy = 0; // latence après le plaquage
  }

  protected override onStunned(): void {
    this.setShield(false);
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    const input = this.controls;

    // Bouclier : maintenu tant que le clic droit est enfoncé.
    const wantShield = input.held('secondary') && this.shieldBroken <= 0 && this.shieldHp > 1;
    if (wantShield !== this.shieldUp) this.setShield(wantShield);
    if (this.shieldUp) {
      this.shieldAngle += angleDiff(this.shieldAngle, this.aim) * (1 - Math.exp(-18 * dt));
    }

    if (input.held('primary') && !this.shieldUp && this.hammerTimer <= 0) this.swing(ctx);
    if (input.pressed('ability1') && this.fireCooldown <= 0) this.fireStrike(ctx);
    if (input.pressed('ability2') && this.chargeCooldown <= 0) this.startCharge(ctx);
  }

  protected override onDeath(ctx: GameContext): void {
    if (this.charge) this.endCharge(ctx);
    this.setShield(false);
  }

  protected override onRespawn(): void {
    // Nouvelle manche en pleine Charge : on relâche tout sans dégâts.
    if (this.charge?.pinned) this.charge.pinned.pinned = false;
    this.charge = null;
    this.slamRecovery = 0;
    this.setShield(false);
    this.hammerTimer = 0;
    this.shieldHp = SHIELD.maxHp;
    this.shieldBroken = 0;
    this.fireCooldown = 0;
    this.chargeCooldown = 0;
  }

  // ------------------------------------------------------------ Marteau

  private swing(ctx: GameContext): void {
    this.hammerTimer = HAMMER.interval;
    this.swingAnim = 0.2;
    this.swingSide *= -1;
    const reach = this.radius + HAMMER.reach;
    ctx.effects.wedge(this.x, this.y, this.aim, HAMMER.halfArc, reach, '#e8eef5', 0.2, this.radius);

    let hit = false;
    for (const bot of ctx.targets) {
      if (!bot.alive || !hostile(this, bot)) continue;
      if (!circleInCone(this.x, this.y, this.aim, HAMMER.halfArc, reach, bot.circle())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, bot.x, bot.y)) continue; // pas de coup à travers un mur
      ctx.damage(bot, HAMMER.damage, this);
      const d = Math.hypot(bot.x - this.x, bot.y - this.y) || 1;
      bot.applyImpulse(((bot.x - this.x) / d) * HAMMER.knockback, ((bot.y - this.y) / d) * HAMMER.knockback, this);
      hit = true;
    }
    if (hit) ctx.shake(3, this);
  }

  // ------------------------------------------------------------ Bouclier

  private setShield(up: boolean): void {
    if (up === this.shieldUp) return;
    this.shieldUp = up;
    if (up) this.shieldAngle = this.aim;
    else this.shieldRegenDelay = SHIELD.regenDelay;
  }

  /** Arrête les projectiles ENNEMIS qui touchent l'arc du bouclier ; les tirs alliés le traversent. */
  override shieldBlocks(p: Projectile): boolean {
    if (!this.shieldUp || p.team === this.team) return false;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (Math.abs(d - SHIELD.radius) > SHIELD.thickness + p.radius) return false;
    const a = Math.atan2(p.y - this.y, p.x - this.x);
    if (Math.abs(angleDiff(this.shieldAngle, a)) > SHIELD.halfArc) return false;

    this.shieldHp -= p.damage * (p.owner?.damageMultiplier ?? 1);
    this.shieldHitFlash = 0.08;
    if (this.shieldHp <= 0) {
      this.shieldHp = 0;
      this.shieldBroken = SHIELD.brokenCooldown;
      this.setShield(false);
    }
    return true;
  }

  // ------------------------------------------------------------ Onde de feu

  private fireStrike(ctx: GameContext): void {
    this.fireCooldown = FIRE.cooldown;
    this.fireAnim = 0.3;
    const ox = this.x + Math.cos(this.aim) * (this.radius + 8);
    const oy = this.y + Math.sin(this.aim) * (this.radius + 8);
    ctx.spawnProjectile(
      new Projectile({
        x: ox,
        y: oy,
        angle: this.aim,
        speed: FIRE.speed,
        damage: FIRE.damage,
        team: this.team,
        owner: this,
        range: FIRE.range,
        radius: FIRE.radius,
        pierce: true, // traverse les ennemis, s'arrête sur les murs
        style: 'fire',
      }),
    );
    ctx.effects.wedge(this.x, this.y, this.aim, 0.5, this.radius + 50, COLORS.fire, 0.18, this.radius);
  }

  // ------------------------------------------------------------ Charge

  private startCharge(ctx: GameContext): void {
    this.setShield(false);
    this.charge = { windup: CHARGE.windup, t: 0, dir: this.aim, pinned: null, bumped: new Set(), trailTimer: 0 };
    this.vx = this.vy = 0;
    ctx.effects.ring(this.x, this.y, '#e8eef5', 50, 0.3);
  }

  get chargeWindupProgress(): number {
    return this.charge && this.charge.windup > 0 ? 1 - this.charge.windup / CHARGE.windup : 1;
  }

  private updateCharge(dt: number, ctx: GameContext): void {
    const c = this.charge!;

    // Préparation : immobile, aucune attaque, on peut encore orienter la charge.
    // Le couloir de charge est affiché pour que les adversaires puissent réagir.
    if (c.windup > 0) {
      c.windup -= dt;
      c.dir = rotateTowards(c.dir, this.aim, CHARGE.windupTurnRate * dt);
      this.vx = this.vy = 0;
      if (c.windup <= 0) {
        ctx.effects.ring(this.x, this.y, '#ffffff', 60, 0.25);
        ctx.shake(3, this);
      }
      return;
    }

    // Maj à nouveau = annuler (petit délai pour ne pas annuler sur la même pression).
    if (c.t > 0.15 && this.controls.pressed('ability2')) {
      this.endCharge(ctx);
      return;
    }
    c.t += dt;
    c.dir = rotateTowards(c.dir, this.aim, CHARGE.turnRate * dt);
    if (c.pinned && !c.pinned.alive) c.pinned = null;

    const dx = Math.cos(c.dir);
    const dy = Math.sin(c.dir);
    const dist = CHARGE.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 6)); // sous-pas : pas de traversée de mur

    for (let s = 0; s < steps; s++) {
      const nx = this.x + (dx * dist) / steps;
      const ny = this.y + (dy * dist) / steps;

      // Les murs arrêtent la charge (plaquage) ; la lave seulement Rempart, qui s'arrête au bord.
      if (ctx.arena.circleCollides(nx, ny, this.radius - 0.5, this.team, true)) {
        this.impact(ctx);
        return;
      }
      if (ctx.arena.circleCollides(nx, ny, this.radius - 0.5, this.team)) {
        // Bord d'une fosse : l'ennemi épinglé, porté devant, est lâché au-dessus de la lave.
        this.endCharge(ctx);
        return;
      }
      if (c.pinned) {
        // Ennemi collé contre l'avant de la hitbox de Rempart.
        const off = this.radius + c.pinned.radius + 2;
        const px = nx + dx * off;
        const py = ny + dy * off;
        if (ctx.arena.circleCollides(px, py, c.pinned.radius - 0.5, this.team, true)) {
          this.impact(ctx);
          return;
        }
        c.pinned.x = px;
        c.pinned.y = py;
      }
      this.x = nx;
      this.y = ny;
      this.catchOrBump(ctx, dx, dy);
    }

    c.trailTimer -= dt;
    if (c.trailTimer <= 0) {
      c.trailTimer = 0.03;
      ctx.effects.afterimage(this.x, this.y, this.radius, '#cfd8e3', 0.25);
    }

    if (c.t >= CHARGE.maxDuration) this.endCharge(ctx); // fin de course : ennemi relâché sans dégâts
  }

  /** Hitbox frontale : le 1er ennemi touché devant est épinglé, les autres sont bousculés. */
  private catchOrBump(ctx: GameContext, dx: number, dy: number): void {
    const c = this.charge!;
    for (const bot of ctx.targets) {
      if (!bot.alive || !hostile(this, bot) || bot === c.pinned) continue;
      const ox = bot.x - this.x;
      const oy = bot.y - this.y;
      const d = Math.hypot(ox, oy);
      if (!circlesOverlap(this.circle(), bot.circle(), 4)) continue;

      const frontal = (ox * dx + oy * dy) / (d || 1) > 0.35;
      if (!c.pinned && frontal) {
        c.pinned = bot;
        bot.notePush?.(this);
        bot.pinned = true;
        ctx.effects.ring(bot.x, bot.y, '#ffffff', 40, 0.25);
        ctx.shake(4, this);
      } else if (!c.bumped.has(bot)) {
        c.bumped.add(bot);
        ctx.damage(bot, CHARGE.bumpDamage, this);
        // Éjecté sur le côté (gauche ou droite selon sa position)
        const side = dx * oy - dy * ox >= 0 ? 1 : -1;
        bot.applyImpulse(-dy * side * CHARGE.bumpImpulse, dx * side * CHARGE.bumpImpulse, this);
      }
    }
  }

  private impact(ctx: GameContext): void {
    const c = this.charge!;
    const target = c.pinned && c.pinned.alive ? c.pinned : null;
    if (target) {
      ctx.damage(target, CHARGE.wallDamage, this);
      ctx.effects.ring(target.x, target.y, '#ffffff', 80, 0.4);
      ctx.effects.sparks(target.x, target.y, '#ffffff', 30, 380);
      ctx.shake(14, this);
    } else {
      ctx.effects.sparks(this.x + Math.cos(c.dir) * this.radius, this.y + Math.sin(c.dir) * this.radius, '#cfd8e3', 16, 260);
      ctx.shake(6, this);
    }
    this.endCharge(ctx);
    if (target) {
      // Plaquage réussi : la cible est étourdie, Rempart reste un instant sonné lui aussi.
      if (target.alive) target.stun(CHARGE.wallStun);
      this.slamRecovery = CHARGE.slamRecovery;
    }
  }

  private endCharge(ctx: GameContext): void {
    const c = this.charge;
    if (!c) return;
    if (c.pinned) {
      c.pinned.pinned = false;
      // Lâché tel quel au-dessus de la lave s'il y est : il y tombe.
      if (c.pinned.alive) ctx.arena.resolveCircle(c.pinned, c.pinned.radius, c.pinned.team, true);
    }
    this.charge = null;
    this.chargeCooldown = CHARGE.cooldown;
    this.vx = this.vy = 0;
    ctx.arena.resolveCircle(this, this.radius, this.team);
  }

  // ------------------------------------------------------------ rendu

  protected override facingAngle(): number {
    return this.charge ? this.charge.dir : this.aim;
  }
  protected override isWalking(): boolean {
    return (this.charge !== null && this.charge.windup <= 0) || super.isWalking();
  }
  protected override animRate(): number {
    return this.charge && this.charge.windup <= 0 ? 2.2 : 1;
  }

  /**
   * Marteau tenu à deux mains : au repos en travers devant lui, tête à droite ; frappe : arc
   * d'un côté à l'autre de la visée ; Onde de feu : projeté en avant d'un coup sec ; Charge :
   * pointé devant.
   */
  protected drawTop(ctx: CanvasRenderingContext2D, rot: number): void {
    const swingT = 1 - this.swingAnim / 0.2;
    const fire = this.fireAnim > 0 ? Math.sin((1 - this.fireAnim / 0.3) * Math.PI) : 0;
    let a = 0.75 - fire * 0.75;
    if (this.swingAnim > 0) a = this.swingSide * (1 - 2 * swingT);
    else if (this.charge && this.charge.windup <= 0) a = 0.3;
    const hx = Math.cos(a);
    const hy = Math.sin(a);
    const push = 1 + fire * 0.35;
    ctx.save();
    ctx.translate(hx * R * 0.3 * push, hy * R * 0.3 * push);
    ctx.rotate(a);
    cached(ctx, 'rempart.hammer', R * 2.3, (c) => rempartHammer(c, R * 1.9, R * 0.85));
    ctx.restore();
    cached(ctx, 'rempart.head', R * 1.15, (c) => {
      head(c, R, '#e8b493');
      knightHelmet(c, R);
    });
    hand(ctx, hx * R * 0.95 * push, hy * R * 0.95 * push, R * 0.3, GAUNTLET, rot);
    hand(ctx, hx * R * 1.35 * push, hy * R * 1.35 * push, R * 0.3, GAUNTLET, rot);
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    return [
      {
        input: 'secondary',
        name: t('rempart.shield'),
        icon: 'shield',
        color: COLORS.shield,
        cooldown: this.shieldBroken,
        cooldownMax: SHIELD.brokenCooldown,
        active: this.shieldUp,
        bar: this.shieldHp / SHIELD.maxHp,
        label: t('hud.shieldHp', { hp: Math.ceil(this.shieldHp) }),
      },
      {
        input: 'ability1',
        name: t('rempart.fire'),
        icon: 'fire',
        color: COLORS.fire,
        cooldown: this.fireCooldown,
        cooldownMax: FIRE.cooldown,
      },
      {
        input: 'ability2',
        name: t('rempart.charge'),
        icon: 'charge',
        cooldown: this.charge ? 0 : this.chargeCooldown,
        cooldownMax: CHARGE.cooldown,
        active: this.charge !== null,
      },
    ];
  }

  weaponHud(): WeaponHud {
    return { name: t('rempart.weapon'), readyRatio: 1 - this.hammerTimer / HAMMER.interval };
  }

  // ------------------------------------------------------------ rendu

  /** Pendant la préparation : couloir de charge "télégraphié" au sol. */
  override drawUnder(ctx: CanvasRenderingContext2D): void {
    const c = this.charge;
    if (this.dead || !c || c.windup <= 0) return;
    const p = this.chargeWindupProgress; // 0 → 1
    const len = 380;
    const w = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(c.dir);
    ctx.globalAlpha = 0.12 + 0.18 * p;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -w, len, w * 2);
    // Remplissage qui progresse jusqu'au départ
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, -w, len * p, w * 2);
    // Chevrons
    ctx.globalAlpha = 0.5 + 0.4 * p;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    for (let i = 1; i <= 4; i++) {
      const cx = i * (len / 5);
      ctx.beginPath();
      ctx.moveTo(cx - 10, -w * 0.5);
      ctx.lineTo(cx + 6, 0);
      ctx.lineTo(cx - 10, w * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead || !this.shieldUp) return;
    const ratio = this.shieldHp / SHIELD.maxHp;
    const a0 = this.shieldAngle - SHIELD.halfArc;
    const a1 = this.shieldAngle + SHIELD.halfArc;

    // Bande translucide
    ctx.globalAlpha = 0.18 + 0.2 * ratio + (this.shieldHitFlash > 0 ? 0.25 : 0);
    ctx.strokeStyle = COLORS.shield;
    ctx.lineWidth = SHIELD.thickness * 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, SHIELD.radius, a0, a1);
    ctx.stroke();

    // Motif hexagonal simplifié : traits radiaux
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(a) * (SHIELD.radius - SHIELD.thickness), this.y + Math.sin(a) * (SHIELD.radius - SHIELD.thickness));
      ctx.lineTo(this.x + Math.cos(a) * (SHIELD.radius + SHIELD.thickness), this.y + Math.sin(a) * (SHIELD.radius + SHIELD.thickness));
      ctx.stroke();
    }

    // Bord extérieur lumineux
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.shieldHitFlash > 0 ? '#ffffff' : COLORS.shield;
    ctx.beginPath();
    ctx.arc(this.x, this.y, SHIELD.radius + SHIELD.thickness, a0, a1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
