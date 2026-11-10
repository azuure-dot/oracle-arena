import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { type Circle, circlesOverlap, distToCircle } from '../core/geometry';
import { angleDiff, degToRad, randRange, TAU, type Vec2 } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Decoy } from '../entities/Decoy';
import { Projectile } from '../entities/Projectile';
import type { Team } from '../entities/Team';
import type { WorldObject } from '../entities/WorldObject';
import { t } from '../i18n';
import {
  angelWing,
  cached,
  CAMELLIA,
  camelliaHairBack,
  camelliaHairTop,
  drawTeamMarker,
  feather,
  goldPauldrons,
  halo,
  hand,
  head,
  littleAngel,
} from '../render/topdown';
import { addBuff, drawHealthBar, type BuffKind } from '../ui/healthBar';
import { lineOfSight } from '../world/Visibility';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';
import { Magazine } from './Magazine';

/** Rayon de la boule (= hitbox). */
const R = 14;

/** Clic G — rafale de plumes, comme un fusil d'assaut : 10 dégâts par plume sur un ennemi, 30 PV rendus à un allié. */
export const FEATHER_GUN = {
  magSize: 30,
  fireRate: 9, // balles/s
  damage: 10, // 90 dégâts/s
  /** Une plume qui touche un allié le soigne d'autant (270 PV/s en rafale). */
  heal: 30,
  spreadDeg: 3,
  speed: 1300,
  range: 760,
  reloadTime: 1.6,
  radius: 4,
};

/**
 * Maj — Sanctuaire de plumes : un ange gardien (100 PV) se pose sous la souris (portée max,
 * arrêtée par les murs) et ouvre une zone où tombe une pluie de plumes. Elle ne soigne pas :
 * c'est un anti-mort — les alliés à l'intérieur (Camellia comprise) ne peuvent pas descendre
 * sous 50 PV. L'ange perd ses PV petit à petit (0 au bout de 10 s) et peut être tué : la zone
 * disparaît avec lui.
 */
export const SANCTUARY = { cooldown: 20, radius: 110, range: 420, angelHp: 100, life: 10, hpFloor: 50 };

/**
 * Espace — Envol : Camellia vole jusqu'à l'allié visé (le plus proche de la ligne de visée,
 * en vue, à portée). Personne de visé : rien ne se passe (recharge non consommée).
 */
export const FLIGHT = {
  cooldown: 5,
  range: 460,
  speed: 1250 * MOVE_SPEED_SCALE,
  maxTime: 1,
  /** Tolérance de visée autour de la ligne de visée. */
  cone: degToRad(14),
};

/**
 * Clic D — Petit ange : lancé sur la souris. Si un joueur est sous la souris, il file droit sur
 * lui ; sinon il va jusqu'au point visé puis rejoint le joueur le plus proche (allié ou
 * ennemi). Il se colle à son dos : allié +35 PV/s, ennemi 20 dégâts/s, pendant 5 s.
 * 2 charges, rechargées une par une.
 */
export const ANGEL = {
  charges: 2,
  rechargeTime: 8,
  speed: 430,
  radius: 7,
  /** Joueur « visé » : centre à moins de (rayon + aimAssist) de la souris. */
  aimAssist: 30,
  /** Rayon de recherche autour du point d'arrivée. */
  search: 260,
  /** Sans personne autour : il attend ce temps puis disparaît. */
  idle: 3,
  /** Poursuite maximale avant de renoncer. */
  chaseMax: 4,
  attachTime: 5,
  heal: 35,
  dps: 20,
};

interface Flight {
  target: Combatant;
  t: number;
  dx: number;
  dy: number;
}

/**
 * Les cibles possibles d'un petit ange : tout le monde sauf Camellia, ses leurres alliés et les
 * ennemis protégés. Un ange gardien adverse ne compte que s'il est visé directement (pas un joueur).
 */
function angelCanTarget(owner: Hero, c: Combatant, aimed = false): boolean {
  if (c === owner || !c.alive) return false;
  if (hostile(owner, c)) return !c.safe && (aimed || !(c instanceof SanctuaryAngel));
  return !c.decoy;
}

/**
 * Camellia — l'archange : soutien à distance.
 * Clic G : rafale de plumes · Clic D : petit ange (2 charges) ·
 * Espace : Envol vers un allié visé · Maj : Sanctuaire de plumes (ange gardien et zone de soin).
 */
export class Camellia extends Hero {
  private readonly mag = new Magazine(FEATHER_GUN.magSize, FEATHER_GUN.reloadTime);
  private fireTimer = 0;
  private muzzleFlash = 0;
  private recoil = 0;
  private sanctuaryCooldown = 0;
  /** Ange gardien du Sanctuaire en place. */
  private guardian: SanctuaryAngel | null = null;
  private flightCooldown = 0;
  private flight: Flight | null = null;
  angelCharges = ANGEL.charges;
  private angelRecharge = 0;
  private castAnim = 0;
  private wingTime = 0;
  /** Allié que viserait l'Envol maintenant (aperçu pour le joueur). */
  private flightPreview: Combatant | null = null;

  constructor() {
    super({ name: 'Camellia', maxHp: 200, radius: R, speed: 330, acceleration: 15, color: '#ff8f9c' });
  }

  override get spreadDeg(): number {
    return FEATHER_GUN.spreadDeg;
  }

  // ---- état lu par l'IA ----
  get sanctuaryReady(): boolean {
    return this.sanctuaryCooldown <= 0;
  }
  get flightReady(): boolean {
    return this.flightCooldown <= 0;
  }
  get isFlying(): boolean {
    return this.flight !== null;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number, ctx: GameContext): void {
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.recoil = Math.max(0, this.recoil - dt);
    this.castAnim = Math.max(0, this.castAnim - dt);
    this.sanctuaryCooldown = Math.max(0, this.sanctuaryCooldown - dt);
    this.flightCooldown = Math.max(0, this.flightCooldown - dt);
    this.wingTime += dt;
    if (this.angelCharges < ANGEL.charges) {
      this.angelRecharge += dt;
      if (this.angelRecharge >= ANGEL.rechargeTime) {
        this.angelCharges++;
        this.angelRecharge = this.angelCharges < ANGEL.charges ? this.angelRecharge - ANGEL.rechargeTime : 0;
      }
    }
    if (this.pinned) this.flight = null;
    this.flightPreview = this.isLocalPlayer && this.flightCooldown <= 0 && !this.flight ? this.flightTarget(ctx) : null;
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    const c = this.controls;
    if (c.pressed('secondary') && this.angelCharges > 0) this.throwAngel(ctx);
    if (c.pressed('ability1') && this.flightCooldown <= 0) this.startFlight(ctx);
    if (c.pressed('ability2') && this.sanctuaryCooldown <= 0) this.castSanctuary(ctx);
    this.updateWeapon(dt, ctx);
  }

  protected override isLocked(): boolean {
    return this.flight !== null;
  }

  protected override onStunned(): void {
    this.flight = null;
  }

  protected override onQuickMelee(): void {
    this.mag.cancelReload();
  }

  protected override onRespawn(): void {
    this.mag.refill();
    this.sanctuaryCooldown = 0;
    this.flightCooldown = 0;
    this.flight = null;
    this.angelCharges = ANGEL.charges;
    this.angelRecharge = 0;
    this.castAnim = 0;
    this.guardian = null; // un ange déjà posé reste en place jusqu'à sa fin
  }

  protected override facingAngle(): number {
    return this.flight ? Math.atan2(this.flight.dy, this.flight.dx) : this.aim;
  }

  // ------------------------------------------------------------ rafale de plumes

  private updateWeapon(dt: number, ctx: GameContext): void {
    this.mag.update(dt);
    if (this.controls.pressed('reload')) this.mag.startReload();
    this.fireTimer -= dt;
    if (this.controls.held('primary') && !this.isMeleeing) {
      while (this.fireTimer <= 0 && this.mag.consume()) {
        this.fire(ctx);
        this.fireTimer += 1 / FEATHER_GUN.fireRate;
      }
    }
    if (this.fireTimer < 0) this.fireTimer = 0;
    if (this.mag.ammo === 0) this.mag.startReload();
  }

  private fire(ctx: GameContext): void {
    this.muzzleFlash = 0.05;
    this.recoil = 0.08;
    const fx = Math.cos(this.aim);
    const fy = Math.sin(this.aim);
    const mx = this.x + fx * (R * 1.55);
    const my = this.y + fy * (R * 1.55);
    if (ctx.arena.pointInWall(mx, my)) {
      ctx.effects.sparks(mx, my, CAMELLIA.halo, 3);
      return;
    }
    const half = degToRad(FEATHER_GUN.spreadDeg) / 2;
    ctx.spawnProjectile(
      new Projectile({
        x: mx,
        y: my,
        angle: this.aim + randRange(-half, half),
        speed: FEATHER_GUN.speed,
        damage: FEATHER_GUN.damage,
        team: this.team,
        owner: this,
        range: FEATHER_GUN.range,
        radius: FEATHER_GUN.radius,
        style: 'feather',
        allyHeal: FEATHER_GUN.heal,
      }),
    );
  }

  // ------------------------------------------------------------ Sanctuaire de plumes

  /** Point visé, à portée max et sans traverser de mur (s'arrête juste avant). */
  private reachablePoint(ctx: GameContext, range: number): Vec2 {
    const c = this.controls;
    let dx = c.aimX - this.x;
    let dy = c.aimY - this.y;
    const d = Math.hypot(dx, dy);
    if (d > range) {
      dx *= range / d;
      dy *= range / d;
    }
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 8));
    let px = this.x;
    let py = this.y;
    for (let i = 1; i <= steps; i++) {
      const x = this.x + (dx * i) / steps;
      const y = this.y + (dy * i) / steps;
      if (ctx.arena.pointInWall(x, y)) break;
      px = x;
      py = y;
    }
    return { x: px, y: py };
  }

  private castSanctuary(ctx: GameContext): void {
    const p = this.reachablePoint(ctx, SANCTUARY.range);
    this.sanctuaryCooldown = SANCTUARY.cooldown;
    this.castAnim = 0.3;
    // Un seul ange gardien à la fois (la recharge est plus longue que sa vie, par sécurité).
    if (this.guardian?.alive) this.guardian.takeDamage(1e6, ctx);
    const angel = new SanctuaryAngel(this, p.x, p.y);
    this.guardian = angel;
    ctx.spawnDecoy(angel);
    ctx.spawnObject(angel.zone);
    ctx.effects.ring(p.x, p.y, CAMELLIA.halo, SANCTUARY.radius, 0.4);
  }

  // ------------------------------------------------------------ Envol

  /**
   * Allié visé par l'Envol : le plus proche de la ligne de visée (dans un cône étroit, élargi
   * pour les alliés proches), à portée et en vue. Sert aussi à l'IA.
   */
  flightTarget(w: { arena: GameContext['arena']; targets: readonly Combatant[] }): Combatant | null {
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const c of w.targets) {
      if (c === this || !c.alive || c.decoy || hostile(this, c)) continue;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < 1 || distToCircle(this.x, this.y, c.circle()) > FLIGHT.range) continue;
      const off = Math.abs(angleDiff(this.aim, Math.atan2(c.y - this.y, c.x - this.x)));
      const tol = Math.max(FLIGHT.cone, Math.asin(Math.min(1, (c.radius + 14) / d)));
      if (off > tol) continue;
      if (!lineOfSight(w.arena, this.x, this.y, c.x, c.y)) continue;
      const score = off / tol + d / 5000;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  private startFlight(ctx: GameContext): void {
    const target = this.flightTarget(ctx);
    if (!target) return; // personne de visé : rien de consommé
    const d = Math.hypot(target.x - this.x, target.y - this.y) || 1;
    this.flight = { target, t: 0, dx: (target.x - this.x) / d, dy: (target.y - this.y) / d };
    this.flightCooldown = FLIGHT.cooldown;
    this.mag.cancelReload();
    ctx.effects.ring(this.x, this.y, CAMELLIA.feather, 36, 0.25);
    featherBurst(ctx, this.x, this.y, 6);
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    const f = this.flight!;
    f.t += dt;
    const target = f.target;
    if (!target.alive || f.t > FLIGHT.maxTime) {
      this.endFlight(ctx, 0.3);
      return;
    }
    const d = Math.hypot(target.x - this.x, target.y - this.y) || 1;
    f.dx = (target.x - this.x) / d;
    f.dy = (target.y - this.y) / d;
    const step = FLIGHT.speed * dt;
    const n = Math.max(1, Math.ceil(step / 8));
    for (let i = 0; i < n; i++) {
      const px = this.x;
      const py = this.y;
      this.x += (f.dx * step) / n;
      this.y += (f.dy * step) / n;
      ctx.arena.resolveCircle(this, this.radius, this.team);
      if (circlesOverlap(this.circle(), target.circle(), 8)) {
        this.endFlight(ctx, 0.15);
        ctx.effects.ring(target.x, target.y, CAMELLIA.halo, 40, 0.3);
        return;
      }
      if (Math.hypot(this.x - px, this.y - py) < step / n / 3) {
        this.endFlight(ctx, 0.2); // bloquée par un mur
        return;
      }
    }
    this.vx = f.dx * FLIGHT.speed;
    this.vy = f.dy * FLIGHT.speed;
    ctx.effects.afterimage(this.x, this.y, this.radius, '#fff6d6', 0.22);
    if (Math.random() < dt * 14) featherBurst(ctx, this.x - f.dx * R, this.y - f.dy * R, 1);
  }

  /** Fin du vol : garde un peu d'élan (`keep` : fraction de la vitesse de vol). */
  private endFlight(ctx: GameContext, keep: number): void {
    const f = this.flight;
    this.flight = null;
    if (!f) return;
    this.vx = f.dx * FLIGHT.speed * keep;
    this.vy = f.dy * FLIGHT.speed * keep;
    featherBurst(ctx, this.x, this.y, 4);
  }

  // ------------------------------------------------------------ petit ange

  private throwAngel(ctx: GameContext): void {
    this.angelCharges--;
    this.castAnim = 0.3;
    const c = this.controls;
    // Joueur sous la souris : l'ange file droit sur lui.
    let aimed: Combatant | null = null;
    let best = Infinity;
    for (const o of ctx.targets) {
      if (!angelCanTarget(this, o, true)) continue;
      const d = Math.hypot(o.x - c.aimX, o.y - c.aimY);
      if (d < o.radius + ANGEL.aimAssist && d < best) {
        best = d;
        aimed = o;
      }
    }
    const sx = this.x + Math.cos(this.aim) * R * 1.3;
    const sy = this.y + Math.sin(this.aim) * R * 1.3;
    ctx.spawnObject(new LittleAngel(this, sx, sy, c.aimX, c.aimY, aimed));
    ctx.effects.ring(sx, sy, '#ffd23f', 22, 0.2);
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    return [
      {
        input: 'secondary',
        name: t('camellia.angel'),
        icon: 'angel',
        color: '#ffd23f',
        charges: this.angelCharges,
        maxCharges: ANGEL.charges,
        chargeProgress: this.angelRecharge / ANGEL.rechargeTime,
      },
      {
        input: 'ability1',
        name: t('camellia.flight'),
        icon: 'wing',
        color: '#ffffff',
        cooldown: this.flightCooldown,
        cooldownMax: FLIGHT.cooldown,
        active: this.flight !== null,
        label: this.flightCooldown <= 0 && !this.flight && !this.flightPreview && this.isLocalPlayer ? t('camellia.flight.none') : undefined,
      },
      {
        input: 'ability2',
        name: t('camellia.sanctuary'),
        icon: 'feather',
        color: CAMELLIA.halo,
        cooldown: this.sanctuaryCooldown,
        cooldownMax: SANCTUARY.cooldown,
        active: this.guardian?.alive ?? false,
        bar: this.guardian?.alive ? this.guardian.hp / this.guardian.maxHp : undefined,
      },
    ];
  }

  weaponHud(): WeaponHud {
    return {
      name: t('camellia.weapon'),
      ammo: this.mag.ammo,
      magSize: FEATHER_GUN.magSize,
      reloadProgress: this.mag.reloading ? this.mag.progress : undefined,
    };
  }

  // ------------------------------------------------------------ rendu

  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    // En vol : elle s'élève un peu (ombre décalée, boule plus grosse).
    const lift = this.flight ? Math.min(1, this.flight.t / 0.12) * 14 : 0;
    if (lift === 0) {
      super.draw(ctx);
      return;
    }
    const face = this.facingAngle();
    drawTeamMarker(ctx, this.x, this.y, R, this.outline, lift);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(face);
    const s = 1 + lift / 90;
    ctx.scale(s, s);
    this.drawTop(ctx, face);
    ctx.restore();
  }

  /** Ouverture des ailes : à demi repliées au repos, battement en marchant, grandes ouvertes en vol. */
  private wingOpen(): number {
    if (this.flight) return 0.85 + Math.sin(this.wingTime * 22) * 0.15;
    if (this.castAnim > 0) return 0.9;
    const walk = this.isWalking() ? Math.sin(this.animTime * 7) * 0.08 : 0;
    return 0.6 + walk + Math.sin(this.wingTime * 2) * 0.03;
  }

  protected drawTop(ctx: CanvasRenderingContext2D, rot: number): void {
    // Ailes (image en cache par degré d'ouverture), cheveux du dos et épaulières dessous.
    const q = Math.round(Math.max(0, Math.min(1, this.wingOpen())) * 12) / 12;
    cached(ctx, `camellia.wings.${q}`, R * 3.4, (c) => {
      angelWing(c, R, 1, q);
      angelWing(c, R, -1, q);
    });
    cached(ctx, 'camellia.back', R * 2.4, (c) => {
      camelliaHairBack(c, R);
      goldPauldrons(c, R);
    });
    // Mains jointes devant elle, une orbe de lumière entre les deux (d'où partent les plumes).
    const k = this.recoil / 0.08;
    const fx = this.flight ? R * 0.55 : R * (1.0 - k * 0.15);
    const cast = this.castAnim > 0 ? Math.sin((1 - this.castAnim / 0.3) * Math.PI) : 0;
    if (!this.flight) {
      ctx.save();
      ctx.translate(R * (1.5 + cast * 0.3), 0);
      const glow = this.muzzleFlash > 0 ? 1.35 : 1 + Math.sin(this.wingTime * 6) * 0.06;
      ctx.scale(glow, glow);
      cached(ctx, 'camellia.orb', R * 0.6, (c) => {
        c.fillStyle = 'rgba(255,224,102,0.35)';
        c.beginPath();
        c.arc(0, 0, R * 0.55, 0, TAU);
        c.fill();
        c.fillStyle = '#fff6c9';
        c.strokeStyle = CAMELLIA.goldDark;
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(0, 0, R * 0.26, 0, TAU);
        c.fill();
        c.stroke();
      });
      ctx.restore();
    }
    cached(ctx, 'camellia.head', R * 1.6, (c) => {
      head(c, R, CAMELLIA.skin);
      camelliaHairTop(c, R);
    });
    // Auréole au-dessus de la tête (un peu en arrière), lueur qui respire.
    ctx.save();
    ctx.translate(-R * 0.12, 0);
    cached(ctx, 'camellia.halo', R * 1.1, (c) => halo(c, R * 0.64, R * 0.12));
    ctx.restore();
    const opts = { wrap: CAMELLIA.wrap };
    if (this.flight) {
      // Bras tendus vers l'allié
      hand(ctx, fx + R * 0.5, R * 0.45, R * 0.3, CAMELLIA.skin, rot, opts);
      hand(ctx, fx + R * 0.5, -R * 0.45, R * 0.3, CAMELLIA.skin, rot, opts);
    } else if (this.meleeAnim > 0) {
      this.idleHands(ctx, R, CAMELLIA.skin, rot, opts);
    } else {
      hand(ctx, fx + cast * R * 0.35, R * 0.42, R * 0.3, CAMELLIA.skin, rot, opts);
      hand(ctx, fx, -R * 0.42, R * 0.3, CAMELLIA.skin, rot, opts);
    }
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const tp = this.flightPreview;
    if (tp && tp.alive) {
      ctx.save();
      ctx.strokeStyle = CAMELLIA.halo;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.wingTime * 30;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.radius + 9, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Quelques plumes qui s'envolent (vol, apparition). */
function featherBurst(ctx: GameContext, x: number, y: number, n: number): void {
  ctx.effects.sparks(x, y, '#ffffff', n, 140);
}

// ------------------------------------------------------------ Sanctuaire de plumes

interface FallingFeather {
  x: number;
  y: number;
  rot: number;
  spin: number;
  t: number;
  life: number;
}

/** Rayon de la boule de l'ange gardien (= hitbox). */
const GUARDIAN_R = 12;

/**
 * Ange gardien du Sanctuaire : il flotte au centre de la zone et la fait exister. C'est un leurre
 * au sens du jeu (touchable, hors score et fil des éliminations) : les adversaires peuvent le
 * viser, le frapper, et les bots le prennent pour cible. Ses PV baissent petit à petit (100 → 0
 * en 10 s) ; à 0, cassé ou épuisé, il disparaît et la zone avec lui.
 *
 * Tant qu'il vit, les alliés dans la zone ne peuvent pas descendre sous 50 PV (pas de soin :
 * voir `Combatant.guard`, appliqué par le monde à chaque dégât).
 */
export class SanctuaryAngel implements Decoy {
  readonly decoy = true;
  readonly team: Team;
  readonly radius = GUARDIAN_R;
  readonly maxHp = SANCTUARY.angelHp;
  hp: number = SANCTUARY.angelHp;
  alive = true;
  visible = true;
  pinned = false;
  buffs: BuffKind[] = [];
  auraSpeedMul = 1;
  stunTimer = 0;
  /** Temps écoulé depuis la pose. */
  t = 0;
  private hurt = 0;
  private spawn = 0;
  readonly feathers: FallingFeather[] = [];
  /** Partie au sol (cercle doré, plumes qui tombent), dessinée sous / sur les entités. */
  readonly zone: WorldObject;

  constructor(
    private readonly owner: Camellia,
    public x: number,
    public y: number,
  ) {
    this.team = owner.team;
    this.zone = new SanctuaryZone(this);
  }

  /** Liseré vu par le joueur (couleur de l'ange). */
  get outline(): string {
    return this.owner.outline;
  }

  circle(): Circle {
    return { x: this.x, y: this.y, r: this.radius };
  }

  takeDamage(amount: number, ctx: GameContext): number {
    if (!this.alive || amount <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.hurt = 0.15;
    if (this.hp <= 0) this.shatter(ctx);
    return dealt;
  }
  heal(): void {}
  stun(): void {}
  applyImpulse(): void {} // il ne bouge pas

  private shatter(ctx: GameContext): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    ctx.effects.ring(this.x, this.y, '#ffe066', 60, 0.4);
    ctx.effects.sparks(this.x, this.y, '#ffffff', 18, 260);
    ctx.effects.sparks(this.x, this.y, this.owner.outline, 10, 200);
  }

  update(dt: number, ctx: GameContext): boolean {
    if (!this.alive) return false;
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    // Il s'épuise : 100 PV perdus en 10 s.
    this.hp -= (SANCTUARY.angelHp / SANCTUARY.life) * dt;
    if (this.hp <= 0) {
      this.shatter(ctx);
      return false;
    }
    for (const c of ctx.targets) {
      if (!c.alive || c.decoy || c.team !== this.team) continue;
      if (distToCircle(this.x, this.y, c.circle()) > SANCTUARY.radius) continue;
      c.guard = { floor: SANCTUARY.hpFloor, until: ctx.time + 0.1 };
    }
    // Pluie de plumes
    this.spawn -= dt;
    while (this.spawn <= 0) {
      this.spawn += 0.11;
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * SANCTUARY.radius * 0.92;
      this.feathers.push({ x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r, rot: Math.random() * TAU, spin: randRange(-2, 2), t: 0, life: randRange(0.8, 1.2) });
    }
    for (const f of this.feathers) {
      f.t += dt;
      f.rot += f.spin * dt;
    }
    for (let i = this.feathers.length - 1; i >= 0; i--) if (this.feathers[i].t >= this.feathers[i].life) this.feathers.splice(i, 1);
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const bob = Math.sin(this.t * 2.5) * 2;
    // Ombre au sol : il flotte
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(this.x + 5, this.y + 8, GUARDIAN_R * 0.9, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(this.x, this.y - 6 + bob);
    ctx.rotate(-Math.PI / 2); // tourné vers le haut de l'écran, ailes ouvertes de chaque côté
    littleAngel(ctx, GUARDIAN_R, Math.sin(this.t * 5) * 0.6, this.owner.outline);
    if (this.hurt > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, GUARDIAN_R, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Barre de vie (elle baisse toute seule) pour tout le monde : alliés comme adversaires. */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const color = this.owner.outline === COLORS.ally ? COLORS.hpAlly : COLORS.hpEnemy;
    drawHealthBar(ctx, this.x, this.y - GUARDIAN_R * 2.4, this.hp, this.maxHp, color, 40);
  }
}

/** Partie au sol du Sanctuaire : cercle doré sous les entités, plumes qui tombent par-dessus. */
class SanctuaryZone implements WorldObject {
  readonly team: Team;

  constructor(private readonly angel: SanctuaryAngel) {
    this.team = angel.team;
  }
  get x(): number {
    return this.angel.x;
  }
  get y(): number {
    return this.angel.y;
  }

  update(): boolean {
    return this.angel.alive; // l'ange cassé ou épuisé : la zone disparaît
  }

  /** Fondu d'apparition, et la zone pâlit avec les PV de l'ange. */
  private get fade(): number {
    const a = this.angel;
    return Math.min(1, a.t / 0.2) * (0.45 + 0.55 * (a.hp / a.maxHp));
  }

  drawUnder(ctx: CanvasRenderingContext2D): void {
    const a = this.fade;
    const { x, y } = this.angel;
    ctx.save();
    ctx.globalAlpha = 0.14 * a;
    ctx.fillStyle = CAMELLIA.halo;
    ctx.beginPath();
    ctx.arc(x, y, SANCTUARY.radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.85 * a;
    ctx.strokeStyle = CAMELLIA.halo;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, SANCTUARY.radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.5 * a;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 9]);
    ctx.lineDashOffset = -this.angel.t * 25;
    ctx.beginPath();
    ctx.arc(x, y, SANCTUARY.radius - 9, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // Plumes posées au sol (fin de chute)
    for (const f of this.angel.feathers) {
      const u = f.t / f.life;
      if (u < 0.75) continue;
      drawFallingFeather(ctx, f, 1, (1 - (u - 0.75) / 0.25) * a);
    }
  }

  drawOver(ctx: CanvasRenderingContext2D): void {
    const a = this.fade;
    for (const f of this.angel.feathers) {
      const u = f.t / f.life;
      if (u >= 0.75) continue;
      // Elle tombe : vue de dessus, elle rapetisse en approchant du sol et se balance.
      drawFallingFeather(ctx, f, 1.25 - (u / 0.75) * 0.45, Math.min(1, u * 5) * a * 0.8);
    }
  }
}

function drawFallingFeather(ctx: CanvasRenderingContext2D, f: FallingFeather, scale: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(f.x + Math.sin(f.t * 5 + f.rot) * 4, f.y);
  ctx.rotate(f.rot);
  ctx.scale(scale, scale);
  cached(ctx, 'camellia.fallingFeather', 7, (c) => feather(c, 10));
  ctx.restore();
}

// ------------------------------------------------------------ petit ange

/** Orientation d'une cible (pour se coller dans son dos) : visée d'un héros, regard d'un robot. */
function facingOf(c: Combatant): number | null {
  const o = c as unknown as { aim?: number; facing?: number };
  return o.aim ?? o.facing ?? null;
}

export class LittleAngel implements WorldObject {
  readonly team: Team;
  x: number;
  y: number;
  private phase: 'fly' | 'seek' | 'attached' = 'fly';
  private t = 0;
  private phaseT = 0;
  private dir: number;
  private target: Combatant | null;
  private searchTimer = 0;
  private done = false;
  private lastBack = Math.PI;

  constructor(
    private readonly owner: Camellia,
    x: number,
    y: number,
    private readonly toX: number,
    private readonly toY: number,
    aimed: Combatant | null,
  ) {
    this.team = owner.team;
    this.x = x;
    this.y = y;
    this.target = aimed;
    this.dir = Math.atan2(toY - y, toX - x);
  }

  /** Point où se coller : dans le dos de la cible (à l'opposé de son regard). */
  private backPoint(c: Combatant): Vec2 {
    const f = facingOf(c);
    if (f !== null) this.lastBack = f + Math.PI;
    const d = c.radius + ANGEL.radius * 0.4;
    return { x: c.x + Math.cos(this.lastBack) * d, y: c.y + Math.sin(this.lastBack) * d };
  }

  private nearest(ctx: GameContext): Combatant | null {
    let best: Combatant | null = null;
    let bestD = ANGEL.search;
    for (const c of ctx.targets) {
      if (!angelCanTarget(this.owner, c)) continue;
      const d = distToCircle(this.x, this.y, c.circle());
      if (d > bestD) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  private moveTo(p: Vec2, dt: number): boolean {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = ANGEL.speed * dt;
    if (d > 0.5) this.dir = Math.atan2(dy, dx);
    if (d <= step) {
      this.x = p.x;
      this.y = p.y;
      return true;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  private vanish(ctx: GameContext): void {
    this.done = true;
    ctx.effects.sparks(this.x, this.y, '#ffd23f', 8, 140);
    ctx.effects.ring(this.x, this.y, '#ffe066', 18, 0.25);
  }

  update(dt: number, ctx: GameContext): boolean {
    if (this.done) return false;
    this.t += dt;
    this.phaseT += dt;
    const tg = this.target;
    if (tg && !tg.alive) {
      // Cible morte : en vol, il cherche quelqu'un d'autre ; collé, il disparaît.
      if (this.phase === 'attached') {
        this.vanish(ctx);
        return false;
      }
      this.target = null;
      this.phase = 'seek';
      this.phaseT = 0;
    }

    if (this.phase === 'fly' || this.phase === 'seek') {
      if (this.target) {
        // Poursuite : droit sur le dos de la cible (il vole par-dessus les murs).
        if (this.moveTo(this.backPoint(this.target), dt) || circlesOverlap({ x: this.x, y: this.y, r: ANGEL.radius }, this.target.circle(), 2)) {
          this.phase = 'attached';
          this.phaseT = 0;
          const ally = !hostile(this.owner, this.target);
          ctx.effects.ring(this.target.x, this.target.y, ally ? COLORS.auraHeal : '#ffd23f', 34, 0.3);
        } else if (this.phaseT > ANGEL.chaseMax) {
          this.vanish(ctx);
          return false;
        }
      } else if (this.phase === 'fly') {
        if (this.moveTo({ x: this.toX, y: this.toY }, dt)) {
          this.phase = 'seek';
          this.phaseT = 0;
        }
      } else {
        // Au point visé : il cherche le joueur le plus proche, puis abandonne.
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) {
          this.searchTimer = 0.1;
          const n = this.nearest(ctx);
          if (n) {
            this.target = n;
            this.phaseT = 0;
          }
        }
        if (!this.target && this.phaseT > ANGEL.idle) {
          this.vanish(ctx);
          return false;
        }
      }
      return true;
    }

    // Collé dans le dos : soigne un allié, blesse un ennemi.
    const c = this.target!;
    const p = this.backPoint(c);
    this.x = p.x;
    this.y = p.y;
    this.dir = this.lastBack + Math.PI;
    if (hostile(this.owner, c)) ctx.damage(c, ANGEL.dps * dt, this.owner);
    else {
      c.heal(ANGEL.heal * dt);
      addBuff(c, 'heal');
    }
    if (this.phaseT >= ANGEL.attachTime) {
      this.vanish(ctx);
      return false;
    }
    return true;
  }

  drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'attached') return;
    // Ombre au sol (il vole)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(this.x + 6, this.y + 9, ANGEL.radius * 0.8, 0, TAU);
    ctx.fill();
  }

  drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'attached') return;
    const c = this.target;
    const enemy = c ? hostile(this.owner, c) : false;
    // Lien lumineux avec la cible : vert (soin) ou doré pulsant (dégâts)
    const pulse = 0.5 + Math.sin(this.t * 10) * 0.5;
    if (c) {
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.strokeStyle = enemy ? '#ffb02e' : COLORS.auraHeal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius + 5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    this.drawAngel(ctx, 1);
    // Temps restant : petit arc autour de l'ange
    const left = 1 - this.phaseT / ANGEL.attachTime;
    ctx.save();
    ctx.strokeStyle = enemy ? '#ffb02e' : COLORS.auraHeal;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, ANGEL.radius + 5, -Math.PI / 2, -Math.PI / 2 + TAU * left);
    ctx.stroke();
    ctx.restore();
  }

  drawSky(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'attached') return;
    this.drawAngel(ctx, 1.1);
  }

  private drawAngel(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.translate(this.x, this.y - (this.phase === 'attached' ? 0 : 4 + Math.sin(this.t * 6) * 2));
    ctx.rotate(this.dir);
    ctx.scale(scale, scale);
    littleAngel(ctx, ANGEL.radius, Math.sin(this.t * (this.phase === 'attached' ? 12 : 20)), this.owner.outline);
    ctx.restore();
  }
}
