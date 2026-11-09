import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { circleInCone, circlesOverlap, distToCircle } from '../core/geometry';
import { degToRad, TAU } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import { Projectile } from '../entities/Projectile';
import { t, type TKey } from '../i18n';
import { cached, deck, drawTeamMarker, hand, head, inked, skaterBeanie, skaterHeadphones } from '../render/topdown';
import { addBuff } from '../ui/healthBar';
import { lineOfSight } from '../world/Visibility';
import { PHANTOM } from './Flux';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';

/** Rayon de la boule (= hitbox), peau, bracelets (d'après son croquis). */
const R = 15;
const SKIN = '#f1c9a5';
const BAND = '#2a2a30';
/** Planche de skate (longueur, largeur). */
const DECK = { L: 52, W: 15 };

/** Planche (dessus ou dessous), en cache. */
function skaterDeck(ctx: CanvasRenderingContext2D, side: 'top' | 'bottom'): void {
  cached(ctx, `skater.deck.${side}`, DECK.L * 0.55, (c) => deck(c, DECK.L, DECK.W, side));
}

export const SKATER = {
  /** Sur la planche : un peu plus rapide que les autres héros (330). */
  speed: 365,
  /** À pied (pendant les coups) : plus lent. */
  footSpeed: 0.85,
};

/** Clic G : combo de 3 coups de planche (le dernier, plus lent, repousse fort), puis 1,5 s de recharge. */
export const COMBO = {
  hits: [
    // Portée réduite de 40 % (88 → 53, 100 → 60)
    // Dégâts 35 - 35 - 60
    { damage: 35, reach: 53, halfArc: degToRad(65), knockback: 140, sweep: 1 }, // coup en travers
    { damage: 35, reach: 53, halfArc: degToRad(65), knockback: 140, sweep: -1 }, // revers
    { damage: 60, reach: 60, halfArc: degToRad(45), knockback: 520, sweep: 0 }, // fracas vertical
  ],
  /** Délai minimal entre deux coups. */
  interval: 0.34,
  /** Sans nouveau coup pendant ce temps, le combo s'arrête (et la recharge démarre). */
  window: 0.9,
  cooldown: 1.5,
  /** Durée de l'animation d'un coup. */
  swingTime: 0.24,
  /** Reste à pied (planche à la main) ce temps après le dernier coup. */
  footLinger: 0.8,
};

/** Clic D : équipement lancé, toujours dans le même ordre (casque, genouillère, coudière, protège-poignet). */
export const GEAR = { damage: 75, cooldown: 1, speed: 560, radius: 11, range: 760 };
/** Animation du bras droit qui lance (s) : armé derrière l'épaule, lancé vers la visée, puis retombe. */
const THROW_TIME = 0.34;
const GEAR_NAMES: TKey[] = ['skater.gear.helmet', 'skater.gear.knee', 'skater.gear.elbow', 'skater.gear.wrist'];

/**
 * Espace : trick sur le joueur le plus proche dans la zone de l'aura :
 * un allié si l'aura est en mode Soin (+75 PV), un ennemi en mode Vitesse (75 dégâts + vitesse cumulable).
 * Personne à portée → poussée en avant sur la planche (même distance que le Transfert
 * de Flux, mais parcourue en un quart de seconde au lieu d'une téléportation) + coup de boost.
 * Un nouveau trick dans les 2 s vise forcément quelqu'un d'autre que le précédent.
 * 3 charges, rechargées une par une (6 s chacune).
 */
export const TRICK = {
  maxCharges: 3,
  rechargeTime: 6,
  /** Pendant ce temps après un trick, la même cible ne peut pas être reprise. */
  sameTargetLock: 2,
  /** Course vers la cible, ralentie comme la marche (770). */
  dashSpeed: 1100 * MOVE_SPEED_SCALE,
  /** Élan quand la cible est perdue pendant la course. */
  soloSpeed: 300 * MOVE_SPEED_SCALE,
  /**
   * Trick sans cible : poussée en avant (direction du déplacement, sinon de la visée)
   * en `pushTime` secondes, puis une courte glissade : au total, la distance du
   * Transfert de Flux (la poussée en fait 88 %, la glissade le reste).
   */
  pushDistance: PHANTOM.distance * 0.88,
  pushTime: 0.24,
  dashMax: 0.35,
  airTime: 0.42,
  jumpHeight: 26,
  /**
   * Rebond vers l'arrière après le trick sur une cible : petit (~33 px sur le saut),
   * pour que la cible reste à portée des coups de planche.
   */
  bounceSpeed: 120,
  allyHeal: 75,
  /** Dégâts d'un trick sur un ennemi. */
  enemyDamage: 75,
  /**
   * Durée d'un palier (vitesse ou soin) selon le nombre de tricks enchaînés :
   * 1 trick → 3 s, 2 tricks → 5 s, 3 tricks → 8 s. Chaque trick relance le chrono.
   */
  stackTime: [0, 3, 5, 8],
};
/**
 * Multiplicateur de vitesse du Skater selon le nombre de tricks enchaînés sur des ennemis (0 à 3).
 * Bonus réduits d'environ 25 % (avant : +20 / +35 / +50 %).
 */
export const TRICK_SPEED = [1, 1.15, 1.26, 1.37];

/**
 * Passif : aura pour les alliés proches, active en permanence.
 * Niveau de base (aucun trick), puis 3 paliers selon les tricks enchaînés
 * (sur des ennemis → aura de vitesse, sur des alliés → aura de soin).
 */
export const SKATE_AURA = {
  radius: 170,
  // Vitesse réduite de 20 à 30 % (avant : +10/15/22/30 %) ; soin réduit puis remonté de 20 %
  // (8/10/13/18 → 9,6/12/15,6/21,6 PV/s). Chaque palier reste au-dessus du précédent.
  //          base  palier 1  palier 2  palier 3
  speedBonus: [0.08, 0.11, 0.16, 0.22],
  heal: [8, 10, 13, 18].map((h) => h * 1.2), // PV/s
  swapCooldown: 0.3,
};

const TRICKS: { name: string; roll: number; spin: number }[] = [
  { name: 'KICKFLIP', roll: 1, spin: 0 },
  { name: 'SHOVE-IT', roll: 0, spin: 0.5 },
  { name: 'HEELFLIP', roll: -1, spin: 0 },
  { name: '360 FLIP', roll: 1, spin: 1 },
  { name: 'VARIAL', roll: 1, spin: 0.5 },
  { name: 'POP SHOVE-IT', roll: 0, spin: 1 },
];

type AuraMode = 'speed' | 'heal';
type TrickKind = 'enemy' | 'ally' | 'solo';

interface TrickState {
  /** dash : course vers la cible · air : saut du trick · push : poussée sans cible. */
  phase: 'dash' | 'air' | 'push';
  t: number;
  target: Combatant | null;
  kind: TrickKind;
  /** Direction de la course (dash) puis du rebond. */
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  variant: number;
}

interface Swing {
  step: number;
  t: number;
  aim: number;
}

/**
 * Skater — soutien rapide au corps à corps, sur sa planche.
 * Clic G : combo de coups de planche · Clic D : lancer d'équipement · Espace : trick (3 charges)
 * Maj : mode d'aura (Vitesse / Soin) · Passif : aura à 3 paliers selon les tricks enchaînés.
 */
export class Skater extends Hero {
  mode: AuraMode = 'speed';

  private comboStep = 0;
  private comboTimer = 0;
  private swingTimer = 0;
  private comboCooldown = 0;
  private swing: Swing | null = null;
  private footTimer = 0;

  private gearCooldown = 0;
  private gearIndex = 0;
  private throwAnim = 0;

  charges = TRICK.maxCharges;
  private rechargeTimer = 0;
  private trick: TrickState | null = null;
  private trickCount = 0;
  /** Dernière cible d'un trick et temps écoulé depuis (pas deux fois la même cible en moins de 2 s). */
  private lastTrickTarget: Combatant | null = null;
  private sinceTrick = Infinity;
  /** Tricks enchaînés : sur des ennemis (vitesse) et sur des alliés (soin). */
  speedStacks = 0;
  private speedTimer = 0;
  healStacks = 0;
  private healTimer = 0;

  private swapCooldown = 0;
  private pulse = 0;
  private trailTimer = 0;
  private walkAnim = 0;
  /** Cible que viserait un trick maintenant (aperçu pour le joueur). */
  private trickPreview: Combatant | null = null;

  constructor() {
    super({
      name: 'Skater',
      maxHp: 200,
      radius: R,
      speed: SKATER.speed,
      acceleration: 12, // glisse un peu plus que les autres : il roule
      color: '#c7a3ff',
    });
  }

  get auraColor(): string {
    return this.mode === 'heal' ? COLORS.auraHeal : COLORS.auraSpeed;
  }
  /** 0 = aura de base, puis paliers 1 à 3. */
  get auraTier(): number {
    return this.mode === 'speed' ? this.speedStacks : this.healStacks;
  }
  get onFoot(): boolean {
    return this.footTimer > 0 || this.swing !== null;
  }
  get isTricking(): boolean {
    return this.trick !== null;
  }
  // ---- état lu par l'IA ----
  get comboReady(): boolean {
    return this.comboCooldown <= 0 && this.swingTimer <= 0 && this.comboStep < COMBO.hits.length;
  }
  get inCombo(): boolean {
    return this.comboStep > 0;
  }
  get gearReady(): boolean {
    return this.gearCooldown <= 0;
  }
  get meleeReach(): number {
    return COMBO.hits[Math.min(this.comboStep, 2)].reach;
  }

  override hasQuickMelee(): boolean {
    return false;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number, ctx: GameContext): void {
    this.pulse += dt;
    this.sinceTrick += dt;
    this.gearCooldown = Math.max(0, this.gearCooldown - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    this.swapCooldown = Math.max(0, this.swapCooldown - dt);
    this.comboCooldown = Math.max(0, this.comboCooldown - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.footTimer = Math.max(0, this.footTimer - dt);

    // Combo interrompu : la recharge démarre.
    if (this.comboStep > 0) {
      this.comboTimer += dt;
      if (this.comboTimer > COMBO.window) this.endCombo();
    }
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t >= COMBO.swingTime) this.swing = null;
    }

    // Charges de trick : une à la fois
    if (this.charges < TRICK.maxCharges) {
      this.rechargeTimer += dt;
      if (this.rechargeTimer >= TRICK.rechargeTime) {
        this.charges++;
        this.rechargeTimer = this.charges < TRICK.maxCharges ? this.rechargeTimer - TRICK.rechargeTime : 0;
      }
    }

    // Paliers de tricks
    this.speedTimer -= dt;
    if (this.speedTimer <= 0) this.speedStacks = 0;
    this.healTimer -= dt;
    if (this.healTimer <= 0) this.healStacks = 0;

    if (this.pinned) this.trick = null;
    this.trickPreview = this.isLocalPlayer && this.charges > 0 && !this.trick ? this.trickTarget(ctx) : null;

    // Traînée de vitesse quand les tricks l'accélèrent
    const moving = Math.hypot(this.vx, this.vy) > 120;
    this.walkAnim = moving ? this.walkAnim + dt : 0;
    if (this.speedStacks > 0 && moving) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.06 - this.speedStacks * 0.01;
        ctx.effects.afterimage(this.x, this.y, this.radius, COLORS.auraSpeed, 0.25);
      }
    }
  }

  /**
   * Aura : le Skater lui-même et ses alliés proches (comme Tempo).
   * Vitesse : prend le meilleur bonus d'aura reçu (pas de cumul avec l'aura de Tempo).
   */
  override applyAura(dt: number, ctx: GameContext): void {
    const tier = this.auraTier;
    for (const c of ctx.targets) {
      if (!c.alive || hostile(this, c)) continue;
      if (distToCircle(this.x, this.y, c.circle()) > SKATE_AURA.radius) continue;
      addBuff(c, this.mode);
      if (this.mode === 'heal') c.heal(SKATE_AURA.heal[tier] * dt);
      else c.auraSpeedMul = Math.max(c.auraSpeedMul, 1 + SKATE_AURA.speedBonus[tier]);
    }
  }

  protected override speedMultiplier(): number {
    return (this.onFoot ? SKATER.footSpeed : 1) * TRICK_SPEED[this.speedStacks];
  }

  protected override isLocked(): boolean {
    return this.trick !== null;
  }

  protected override onStunned(): void {
    this.trick = null;
    this.swing = null;
  }

  protected override isWalking(): boolean {
    return Math.hypot(this.vx, this.vy) > 30;
  }

  protected handleInput(_dt: number, ctx: GameContext): void {
    const c = this.controls;
    if (c.held('primary') && this.comboReady) this.strike(ctx);
    if (c.held('secondary') && this.gearCooldown <= 0 && !this.swing) this.throwGear(ctx);
    if (c.pressed('ability1') && this.charges > 0) this.startTrick(ctx);
    if (c.pressed('ability2') && this.swapCooldown <= 0) {
      this.swapCooldown = SKATE_AURA.swapCooldown;
      this.mode = this.mode === 'speed' ? 'heal' : 'speed';
      ctx.effects.ring(this.x, this.y, this.auraColor, SKATE_AURA.radius, 0.3);
    }
  }

  protected override onRespawn(): void {
    this.charges = TRICK.maxCharges;
    this.rechargeTimer = 0;
    this.trick = null;
    this.lastTrickTarget = null;
    this.sinceTrick = Infinity;
    this.speedStacks = this.healStacks = 0;
    this.speedTimer = this.healTimer = 0;
    this.comboStep = 0;
    this.comboCooldown = 0;
    this.swing = null;
    this.footTimer = 0;
    this.gearCooldown = 0;
    this.throwAnim = 0;
  }

  // ------------------------------------------------------------ coups de planche

  private strike(ctx: GameContext): void {
    const hit = COMBO.hits[this.comboStep];
    this.comboStep++;
    this.comboTimer = 0;
    this.swingTimer = COMBO.interval * (hit.sweep === 0 ? 1.25 : 1);
    this.footTimer = COMBO.footLinger;
    this.swing = { step: this.comboStep - 1, t: 0, aim: this.aim };

    const reach = this.radius + hit.reach;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    let touched = false;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!circleInCone(this.x, this.y, this.aim, hit.halfArc, reach, c.circle())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      ctx.damage(c, hit.damage, this);
      c.applyImpulse(dx * hit.knockback, dy * hit.knockback, this);
      ctx.effects.sparks(c.x, c.y, '#ffffff', hit.sweep === 0 ? 16 : 8, hit.sweep === 0 ? 320 : 220);
      touched = true;
    }
    if (hit.sweep === 0) {
      // Fracas : onde au sol devant lui
      const fx = this.x + dx * (this.radius + hit.reach * 0.6);
      const fy = this.y + dy * (this.radius + hit.reach * 0.6);
      ctx.effects.ring(fx, fy, '#ffffff', 70, 0.3);
      ctx.effects.sparks(fx, fy, '#cfd8e3', 14, 260);
      ctx.shake(touched ? 7 : 4, this);
    } else if (touched) {
      ctx.shake(2, this);
    }
    if (this.comboStep >= COMBO.hits.length) this.endCombo();
  }

  private endCombo(): void {
    this.comboStep = 0;
    this.comboTimer = 0;
    this.comboCooldown = COMBO.cooldown;
  }

  // ------------------------------------------------------------ équipement

  private throwGear(ctx: GameContext): void {
    this.gearCooldown = GEAR.cooldown;
    this.throwAnim = THROW_TIME;
    const i = this.gearIndex;
    this.gearIndex = (this.gearIndex + 1) % GEAR_NAMES.length;
    const ox = this.x + Math.cos(this.aim) * (this.radius + 10);
    const oy = this.y + Math.sin(this.aim) * (this.radius + 10);
    if (ctx.arena.pointInWall(ox, oy)) return;
    ctx.spawnProjectile(
      new Projectile({
        x: ox,
        y: oy,
        angle: this.aim,
        speed: GEAR.speed,
        damage: GEAR.damage,
        team: this.team,
        owner: this,
        range: GEAR.range,
        radius: GEAR.radius,
        style: 'gear',
        gear: { index: i, spin: 0.035 * (i % 2 ? -1 : 1) },
      }),
    );
  }

  // ------------------------------------------------------------ tricks

  /**
   * Cible du prochain trick : le joueur le plus proche dans la zone de l'aura (en vue),
   * allié en mode Soin, ennemi en mode Vitesse. Moins de 2 s après un trick, la cible
   * précédente est exclue. Sert aussi à l'IA (même règle que pour le joueur).
   */
  trickTarget(w: { arena: GameContext['arena']; targets: readonly Combatant[] }): Combatant | null {
    const wantEnemy = this.mode === 'speed';
    let best: Combatant | null = null;
    let bestD = SKATE_AURA.radius;
    for (const c of w.targets) {
      if (c === this || !c.alive || c.pinned) continue;
      if (hostile(this, c) !== wantEnemy) continue;
      if (!wantEnemy && c.decoy) continue; // pas de soin sur un leurre allié
      if (wantEnemy && c.safe) continue; // ennemi protégé dans son spawn
      if (c === this.lastTrickTarget && this.sinceTrick < TRICK.sameTargetLock) continue;
      const d = distToCircle(this.x, this.y, c.circle());
      if (d > bestD) continue;
      if (!lineOfSight(w.arena, this.x, this.y, c.x, c.y)) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  private startTrick(ctx: GameContext): void {
    const target = this.trickTarget(ctx);
    this.lastTrickTarget = target;
    this.sinceTrick = 0;
    this.charges--;
    this.swing = null;
    this.footTimer = 0;
    const variant = this.trickCount++ % TRICKS.length;
    if (target) {
      const d = Math.hypot(target.x - this.x, target.y - this.y) || 1;
      this.trick = {
        phase: 'dash',
        t: 0,
        target,
        kind: hostile(this, target) ? 'enemy' : 'ally',
        dx: (target.x - this.x) / d,
        dy: (target.y - this.y) / d,
        vx: 0,
        vy: 0,
        variant,
      };
    } else {
      // Personne à portée : il se pousse vite sur sa planche, dans la direction où il va.
      let dx = this.moveDir.x;
      let dy = this.moveDir.y;
      if (dx === 0 && dy === 0) {
        dx = Math.cos(this.aim);
        dy = Math.sin(this.aim);
      }
      const n = Math.hypot(dx, dy) || 1;
      this.trick = { phase: 'push', t: 0, target: null, kind: 'solo', dx: dx / n, dy: dy / n, vx: 0, vy: 0, variant };
      this.boost();
      ctx.effects.text(this.x, this.bodyTop() - 22, 'PUSH', '#e9eef5', 13, 0.6); // au-dessus de la barre de vie
    }
    ctx.effects.ring(this.x, this.y, '#e9eef5', 34, 0.25);
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    const tr = this.trick!;
    tr.t += dt;
    if (tr.phase === 'dash') {
      const target = tr.target;
      if (!target || !target.alive || tr.t > TRICK.dashMax) {
        // Cible perdue : le trick se fait sur place
        tr.phase = 'air';
        tr.t = 0;
        tr.kind = 'solo';
        tr.vx = tr.dx * TRICK.soloSpeed;
        tr.vy = tr.dy * TRICK.soloSpeed;
        this.boost();
        return;
      }
      const d = Math.hypot(target.x - this.x, target.y - this.y) || 1;
      tr.dx = (target.x - this.x) / d;
      tr.dy = (target.y - this.y) / d;
      const step = TRICK.dashSpeed * dt;
      const n = Math.max(1, Math.ceil(step / 8));
      for (let i = 0; i < n; i++) {
        const px = this.x;
        const py = this.y;
        this.x += (tr.dx * step) / n;
        this.y += (tr.dy * step) / n;
        ctx.arena.resolveCircle(this, this.radius, this.team);
        if (circlesOverlap(this.circle(), target.circle(), 6)) {
          this.landOn(target, ctx);
          return;
        }
        if (Math.hypot(this.x - px, this.y - py) < step / n / 3) break; // bloqué par un mur
      }
      this.vx = tr.dx * TRICK.dashSpeed;
      this.vy = tr.dy * TRICK.dashSpeed;
      ctx.effects.afterimage(this.x, this.y, this.radius, '#e9eef5', 0.2);
      return;
    }
    if (tr.phase === 'push') {
      // Poussée : vitesse constante sur la distance du Transfert ; s'arrête contre un mur.
      const speed = TRICK.pushDistance / TRICK.pushTime;
      const step = speed * Math.min(dt, Math.max(0, TRICK.pushTime - (tr.t - dt)));
      const px = this.x;
      const py = this.y;
      this.x += tr.dx * step;
      this.y += tr.dy * step;
      ctx.arena.resolveCircle(this, this.radius, this.team);
      this.vx = tr.dx * speed;
      this.vy = tr.dy * speed;
      ctx.effects.afterimage(px, py, this.radius, '#e9eef5', 0.18);
      const blocked = step > 0 && Math.hypot(this.x - px, this.y - py) < step / 3;
      if (tr.t >= TRICK.pushTime || blocked) {
        this.trick = null;
        // Garde un peu d'élan : il glisse encore un instant au lieu de s'arrêter net.
        this.vx = tr.dx * speed * 0.45;
        this.vy = tr.dy * speed * 0.45;
        ctx.effects.sparks(this.x, this.y, '#cfd8e3', 5, 120);
      }
      return;
    }
    // En l'air : le Skater continue sur sa lancée (rebond), puis retombe.
    const decay = Math.exp(-2.2 * dt);
    tr.vx *= decay;
    tr.vy *= decay;
    this.vx = tr.vx;
    this.vy = tr.vy;
    this.x += tr.vx * dt;
    this.y += tr.vy * dt;
    ctx.arena.resolveCircle(this, this.radius, this.team);
    if (tr.t >= TRICK.airTime) {
      this.trick = null;
      ctx.effects.ring(this.x, this.y, '#cfd8e3', 30, 0.2);
      ctx.effects.sparks(this.x, this.y, '#cfd8e3', 6, 140);
    }
  }

  /** Le trick réussi sur une cible : effet, petit texte, puis rebond vers l'arrière. */
  private landOn(target: Combatant, ctx: GameContext): void {
    const tr = this.trick!;
    const name = TRICKS[tr.variant].name;
    if (tr.kind === 'enemy') {
      ctx.damage(target, TRICK.enemyDamage, this);
      this.speedStacks = Math.min(3, this.speedStacks + 1);
      this.speedTimer = TRICK.stackTime[this.speedStacks];
      ctx.effects.ring(target.x, target.y, COLORS.auraSpeed, 60, 0.35);
      ctx.effects.text(target.x, target.y - target.radius - 18, `${name} ×${this.speedStacks}`, COLORS.auraSpeed, 16, 1);
    } else {
      target.heal(TRICK.allyHeal);
      this.healStacks = Math.min(3, this.healStacks + 1);
      this.healTimer = TRICK.stackTime[this.healStacks];
      ctx.effects.ring(target.x, target.y, COLORS.auraHeal, 60, 0.35);
      ctx.effects.text(target.x, target.y - target.radius - 18, name, COLORS.auraHeal, 16, 1);
      ctx.effects.text(target.x, target.y - target.radius - 2, `+${TRICK.allyHeal}`, '#7dff9a', 14, 0.9);
    }
    ctx.effects.sparks(target.x, target.y - target.radius, '#ffffff', 12, 260);
    ctx.shake(3, this);
    tr.phase = 'air';
    tr.t = 0;
    tr.vx = -tr.dx * TRICK.bounceSpeed;
    tr.vy = -tr.dy * TRICK.bounceSpeed;
  }

  /** Coup de boost d'un trick sans ennemi : au moins un palier de vitesse pendant 2 s. */
  private boost(): void {
    // En mode Soin, le trick renforce l'aura de soin ; en mode Vitesse, la vitesse.
    if (this.mode === 'heal') {
      if (this.healStacks === 0) {
        this.healStacks = 1;
        this.healTimer = TRICK.stackTime[1];
      }
    } else if (this.speedStacks === 0) {
      this.speedStacks = 1;
      this.speedTimer = TRICK.stackTime[1];
    }
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    // Case du trick : charges (pastilles une par une) et palier du mode d'aura en cours.
    // Pas de grande jauge du chrono des paliers : elle cachait la recharge des charges.
    const heal = this.mode === 'heal';
    const stacks = heal ? this.healStacks : this.speedStacks;
    return [
      {
        input: 'secondary',
        name: t('skater.gear'),
        icon: 'gear',
        color: '#e9eef5',
        cooldown: this.gearCooldown,
        cooldownMax: GEAR.cooldown,
        label: t(GEAR_NAMES[this.gearIndex]),
      },
      {
        input: 'ability1',
        name: t('skater.trick'),
        icon: 'trick',
        color: COLORS.auraSpeed,
        charges: this.charges,
        maxCharges: TRICK.maxCharges,
        chargeProgress: this.rechargeTimer / TRICK.rechargeTime,
        active: stacks > 0,
        label: stacks > 0 ? t(heal ? 'skater.healStacks' : 'skater.speedStacks', { n: stacks }) : undefined,
      },
      {
        input: 'ability2',
        name: t('skater.mode'),
        icon: 'swap',
        color: this.auraColor,
        active: true,
        label:
          this.auraTier > 0
            ? t('skater.modeLabel', { mode: t(this.mode === 'heal' ? 'aura.heal' : 'aura.speed'), n: this.auraTier })
            : t('skater.modeBase', { mode: t(this.mode === 'heal' ? 'aura.heal' : 'aura.speed') }),
      },
    ];
  }

  weaponHud(): WeaponHud {
    return {
      name: t('skater.weapon'),
      ammo: COMBO.hits.length - this.comboStep,
      magSize: COMBO.hits.length,
      reloadProgress: this.comboCooldown > 0 ? 1 - this.comboCooldown / COMBO.cooldown : undefined,
    };
  }

  // ------------------------------------------------------------ rendu

  override drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const color = this.auraColor;
    const R = SKATE_AURA.radius;
    const tier = this.auraTier + 1; // un anneau pour l'aura de base, un de plus par palier
    ctx.save();
    ctx.globalAlpha = 0.04 + tier * 0.02;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, R, 0, TAU);
    ctx.fill();
    // Un anneau pointillé par palier, qui tourne plus vite à chaque palier
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    for (let i = 0; i < tier; i++) {
      ctx.globalAlpha = 0.6 - i * 0.12;
      ctx.lineDashOffset = -this.pulse * (30 + tier * 25) * (i % 2 ? -1 : 1);
      ctx.beginPath();
      ctx.arc(this.x, this.y, R - i * 9, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const tr = this.trick;
    // Hauteur du saut : vu de dessus, il grossit et son ombre s'éloigne.
    const z = tr && tr.phase === 'air' ? Math.sin(Math.PI * Math.min(1, tr.t / TRICK.airTime)) * TRICK.jumpHeight : 0;
    drawTeamMarker(ctx, this.x, this.y, R, this.outline, z);

    const moving = Math.hypot(this.vx, this.vy) > 60;
    const throwing = this.throwAnim > 0 && !this.onFoot && !tr;
    const face = this.swing || this.onFoot || throwing || !moving ? this.aim : Math.atan2(this.vy, this.vx);
    // Sens de la planche : la course (trick), sinon le déplacement, sinon la visée.
    const rideDir = tr
      ? Math.atan2(tr.phase === 'dash' ? tr.dy : this.vy || tr.dy, tr.phase === 'dash' ? tr.dx : this.vx || tr.dx)
      : moving
        ? Math.atan2(this.vy, this.vx)
        : this.aim;
    const lift = 1 + z / 70;

    if (!this.onFoot) {
      // La planche, sous ses pieds (au sol, ou qui tourne sous lui pendant le saut).
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(1 + z / 120, 1 + z / 120);
      ctx.rotate(rideDir);
      if (tr && tr.phase === 'air') this.flipDeck(ctx, tr);
      else skaterDeck(ctx, 'top');
      ctx.restore();
    }
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(tr && tr.phase === 'air' ? rideDir : face);
    ctx.scale(lift, lift);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const rot = tr && tr.phase === 'air' ? rideDir : face;
    if (this.onFoot && this.swing) this.drawSwing(ctx, rot);
    else {
      if (!this.onFoot && (tr?.phase === 'push' || (moving && Math.floor(this.walkAnim * 2.2) % 3 === 2))) this.drawPushFoot(ctx, face, rideDir);
      if (this.onFoot) this.drawCarriedDeck(ctx);
      this.drawHead(ctx);
      if (throwing) this.drawThrow(ctx, rot);
      else if (this.onFoot) this.idleHands(ctx, R, SKIN, rot, { band: BAND });
      else this.drawBalance(ctx, rot, moving);
    }
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
    this.drawHead(ctx);
    this.drawBalance(ctx, rot, false);
  }

  /** Tête : casque audio autour du cou, bonnet violet. */
  private drawHead(ctx: CanvasRenderingContext2D): void {
    cached(ctx, 'skater.head', R * 1.5, (c) => {
      skaterHeadphones(c, R);
      head(c, R, SKIN);
      skaterBeanie(c, R);
    });
  }

  /** Sur la planche : bras écartés pour l'équilibre, qui se balancent en roulant. */
  private drawBalance(ctx: CanvasRenderingContext2D, rot: number, moving: boolean): void {
    const sway = Math.sin(this.walkAnim * 5) * (moving ? 0.25 : 0.1);
    hand(ctx, R * sway, R * 1.15, R * 0.3, SKIN, rot, { band: BAND });
    hand(ctx, -R * sway, -R * 1.15, R * 0.3, SKIN, rot, { band: BAND });
  }

  /** Pied qui pousse sur le sol, à côté de la planche, derrière (repère tourné vers `face`). */
  private drawPushFoot(ctx: CanvasRenderingContext2D, face: number, rideDir: number): void {
    const a = rideDir - face;
    const k = Math.sin(this.walkAnim * 14) * 0.5 + 0.5;
    const fx = -Math.cos(a) * R * (0.6 + k * 0.8) - Math.sin(a) * R * 0.7;
    const fy = -Math.sin(a) * R * (0.6 + k * 0.8) + Math.cos(a) * R * 0.7;
    inked(ctx, '#f2f2f2', () => ctx.ellipse(fx, fy, R * 0.38, R * 0.22, a, 0, TAU), 1.6);
    ctx.fillStyle = '#1c1c22';
    ctx.beginPath();
    ctx.ellipse(fx, fy, R * 0.26, R * 0.12, a, 0, TAU);
    ctx.fill();
  }

  /** À pied, entre deux coups : la planche tenue le long du corps, côté droit. */
  private drawCarriedDeck(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(R * 0.2, R * 1.25);
    skaterDeck(ctx, 'bottom');
    ctx.restore();
  }

  /**
   * Coup de planche, tenue à deux mains par la queue : en travers (de droite à gauche, puis
   * en revers), puis le fracas : levée (elle grossit, vue de dessus) et abattue devant lui.
   */
  private drawSwing(ctx: CanvasRenderingContext2D, rot: number): void {
    const sw = this.swing!;
    const hit = COMBO.hits[sw.step];
    const u = Math.min(1, sw.t / COMBO.swingTime);
    const e = 1 - (1 - u) * (1 - u); // départ vif, fin amortie
    let a: number;
    let up = 0;
    if (hit.sweep !== 0) {
      a = hit.sweep * (1.2 - 2.4 * e);
    } else {
      a = 0;
      up = u < 0.35 ? u / 0.35 : 1 - ((u - 0.35) / 0.65) ** 2;
    }
    const gx = Math.cos(a) * R * (1.0 - up * 0.4);
    const gy = Math.sin(a) * R * (1.0 - up * 0.4);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(a);
    ctx.scale(1 + up * 0.25, 1 + up * 0.25);
    ctx.translate(DECK.L * 0.45 * (1 - up * 0.6), 0);
    skaterDeck(ctx, 'bottom');
    ctx.restore();
    this.drawHead(ctx);
    hand(ctx, gx, gy, R * 0.3, SKIN, rot, { band: BAND });
    hand(ctx, gx + Math.cos(a) * R * 0.45, gy + Math.sin(a) * R * 0.45, R * 0.3, SKIN, rot, { band: BAND });
  }

  /**
   * Lancer d'équipement : la main droite part en arrière, fouette vers la visée (le lancer
   * part à cet instant), reste tendue un instant, puis revient.
   */
  private drawThrow(ctx: CanvasRenderingContext2D, rot: number): void {
    const u = 1 - this.throwAnim / THROW_TIME; // 0 → 1
    const f = u < 0.2 ? -0.6 + 2 * (u / 0.2) : u < 0.55 ? 1.4 : 1.4 - 1.2 * ((u - 0.55) / 0.45);
    hand(ctx, R * f, R * 0.85, R * 0.3, SKIN, rot, { band: BAND });
    hand(ctx, 0, -R * 1.15, R * 0.3, SKIN, rot, { band: BAND });
  }

  /** Planche sous lui pendant un trick : elle roule (flip, on voit le dessous) et/ou pivote (shove-it). */
  private flipDeck(ctx: CanvasRenderingContext2D, tr: TrickState): void {
    const u = Math.min(1, tr.t / TRICK.airTime);
    const kind = TRICKS[tr.variant];
    const ease = u < 0.85 ? u / 0.85 : 1; // rattrapée un peu avant l'atterrissage
    const roll = Math.cos(ease * TAU * Math.abs(kind.roll)); // 1 = dessus, -1 = dessous
    ctx.rotate(ease * TAU * kind.spin);
    ctx.scale(1, Math.max(0.2, Math.abs(roll)));
    skaterDeck(ctx, kind.roll !== 0 && roll < 0 ? 'bottom' : 'top');
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    // Traînée du coup (croissant net, style « lame »)
    const sw = this.swing;
    if (sw) {
      const hit = COMBO.hits[sw.step];
      const u = Math.min(1, sw.t / COMBO.swingTime);
      const R = this.radius + hit.reach;
      ctx.save();
      ctx.globalAlpha = 0.75 * (1 - u);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      if (hit.sweep !== 0) {
        const a0 = sw.aim + hit.sweep * 1.15;
        const a1 = sw.aim + hit.sweep * (1.15 - 2.3 * Math.min(1, u * 1.6));
        ctx.arc(this.x, this.y, R, Math.min(a0, a1), Math.max(a0, a1));
        ctx.arc(this.x, this.y, R * 0.72, Math.max(a0, a1), Math.min(a0, a1), true);
      } else if (u > 0.4) {
        const fx = this.x + Math.cos(sw.aim) * (this.radius + hit.reach * 0.6);
        const fy = this.y + Math.sin(sw.aim) * (this.radius + hit.reach * 0.6);
        ctx.ellipse(fx, fy, 30 * (u + 0.2), 13 * (u + 0.2), sw.aim, 0, TAU);
      }
      ctx.fill();
      ctx.restore();
    }
    // Cible du prochain trick (joueur seulement)
    const tp = this.trickPreview;
    if (tp && tp.alive) {
      const color = hostile(this, tp) ? COLORS.auraSpeed : COLORS.auraHeal;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.pulse * 30;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.radius + 9, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  override drawOverlay(ctx: CanvasRenderingContext2D): void {
    super.drawOverlay(ctx);
    if (this.dead || this.speedStacks === 0) return;
    // Chevrons de vitesse à gauche de la barre de vie (dessous, ils cacheraient sa tête)
    const y = this.bodyTop() - 4 - 3.5;
    const right = this.x - 30 - 8; // barre de 60 de large
    ctx.save();
    ctx.strokeStyle = COLORS.auraSpeed;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < this.speedStacks; i++) {
      const x = right - (this.speedStacks - 1 - i) * 10;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 4);
      ctx.lineTo(x + 2, y);
      ctx.lineTo(x - 3, y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }
}
