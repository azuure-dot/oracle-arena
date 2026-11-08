import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { boxesOverlap, boxInCone, distToBox } from '../core/geometry';
import { angleDiff, degToRad, TAU } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import { Projectile } from '../entities/Projectile';
import { t, type TKey } from '../i18n';
import { deckImage, dir8, gearImage, GEAR as GEAR_GRIDS, skaterFrame, type DeckFace } from '../sprites/skater';
import { addBuff } from '../ui/healthBar';
import { lineOfSight } from '../world/Visibility';
import { BLINK } from './Flux';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';

/** Taille d'un pixel de la planche de sprites (unités monde) et hitbox du corps (sans la planche). */
// 1,3 → 1,8 : même hauteur à l'écran que Turty (~60 unités au-dessus des pieds).
const PX = 1.8;
/** Hauteur de sa plus haute pose au-dessus des pieds (calculée au premier besoin). */
let skaterHeight = 0;
const DIRS8 = ['down', 'downLeft', 'left', 'upLeft', 'up', 'upRight', 'right', 'downRight'] as const;
const HITBOX = { hw: 10, hh: 21 };

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
  pushDistance: BLINK.distance * 0.88,
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
      px: PX,
      hitbox: HITBOX,
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
        ctx.effects.afterimage(this.x, this.y + this.hh * 0.5, this.hw, COLORS.auraSpeed, 0.25);
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
      if (distToBox(this.x, this.y, c.box()) > SKATE_AURA.radius) continue;
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

    const reach = this.hw + hit.reach;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    let touched = false;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      if (!boxInCone(this.x, this.y, this.aim, hit.halfArc, reach, c.box())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      ctx.damage(c, hit.damage, this);
      c.applyImpulse(dx * hit.knockback, dy * hit.knockback, this);
      ctx.effects.sparks(c.x, c.y, '#ffffff', hit.sweep === 0 ? 16 : 8, hit.sweep === 0 ? 320 : 220);
      touched = true;
    }
    if (hit.sweep === 0) {
      // Fracas : onde au sol devant lui
      const fx = this.x + dx * (this.hw + hit.reach * 0.6);
      const fy = this.y + dy * (this.hw + hit.reach * 0.6);
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
    this.gearIndex = (this.gearIndex + 1) % GEAR_GRIDS.length;
    const ox = this.x + Math.cos(this.aim) * (this.hw + 10);
    const oy = this.y - 6 + Math.sin(this.aim) * (this.hw + 10);
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
        style: 'sprite',
        sprite: { img: gearImage(i, this.outline), px: 2.2, spin: 0.035 * (i % 2 ? -1 : 1) },
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
      if (wantEnemy && c.safe) continue; // ennemi protégé dans son spawn
      if (c === this.lastTrickTarget && this.sinceTrick < TRICK.sameTargetLock) continue;
      const d = distToBox(this.x, this.y, c.box());
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
      ctx.effects.text(this.x, this.spriteTop() - 22, 'PUSH', '#e9eef5', 13, 0.6); // au-dessus de la barre de vie
    }
    ctx.effects.ring(this.x, this.y + this.hh, '#e9eef5', 34, 0.25);
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
        ctx.arena.resolveBox(this, this.hw, this.hh, this.team);
        if (boxesOverlap(this.box(), target.box(), 6)) {
          this.landOn(target, ctx);
          return;
        }
        if (Math.hypot(this.x - px, this.y - py) < step / n / 3) break; // bloqué par un mur
      }
      this.vx = tr.dx * TRICK.dashSpeed;
      this.vy = tr.dy * TRICK.dashSpeed;
      ctx.effects.afterimage(this.x, this.y + this.hh * 0.4, this.hw, '#e9eef5', 0.2);
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
      ctx.arena.resolveBox(this, this.hw, this.hh, this.team);
      this.vx = tr.dx * speed;
      this.vy = tr.dy * speed;
      ctx.effects.afterimage(px, py + this.hh * 0.4, this.hw, '#e9eef5', 0.18);
      const blocked = step > 0 && Math.hypot(this.x - px, this.y - py) < step / 3;
      if (tr.t >= TRICK.pushTime || blocked) {
        this.trick = null;
        // Garde un peu d'élan : il glisse encore un instant au lieu de s'arrêter net.
        this.vx = tr.dx * speed * 0.45;
        this.vy = tr.dy * speed * 0.45;
        ctx.effects.sparks(this.x, this.y + this.hh, '#cfd8e3', 5, 120);
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
    ctx.arena.resolveBox(this, this.hw, this.hh, this.team);
    if (tr.t >= TRICK.airTime) {
      this.trick = null;
      ctx.effects.ring(this.x, this.y + this.hh, '#cfd8e3', 30, 0.2);
      ctx.effects.sparks(this.x, this.y + this.hh, '#cfd8e3', 6, 140);
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
      ctx.effects.text(target.x, target.y - target.hh - 18, `${name} ×${this.speedStacks}`, COLORS.auraSpeed, 16, 1);
    } else {
      target.heal(TRICK.allyHeal);
      this.healStacks = Math.min(3, this.healStacks + 1);
      this.healTimer = TRICK.stackTime[this.healStacks];
      ctx.effects.ring(target.x, target.y, COLORS.auraHeal, 60, 0.35);
      ctx.effects.text(target.x, target.y - target.hh - 18, name, COLORS.auraHeal, 16, 1);
      ctx.effects.text(target.x, target.y - target.hh - 2, `+${TRICK.allyHeal}`, '#7dff9a', 14, 0.9);
    }
    ctx.effects.sparks(target.x, target.y - target.hh, '#ffffff', 12, 260);
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
    const feetY = this.y + this.hh;
    const tr = this.trick;
    // Hauteur du saut
    const z = tr && tr.phase === 'air' ? Math.sin(Math.PI * Math.min(1, tr.t / TRICK.airTime)) * TRICK.jumpHeight : 0;

    // Ombre + anneau d'équipe (au sol, même en l'air)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(this.x, feetY, this.hw * 1.3 * (1 - z / 80), this.hw * 0.5 * (1 - z / 80), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.outline;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(this.x, feetY, this.hw * 1.5, this.hw * 0.62, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const moving = Math.hypot(this.vx, this.vy) > 60;
    const throwing = this.throwAnim > 0 && !this.onFoot && !tr;
    const facing = this.swing || this.onFoot || throwing || !moving ? this.aim : Math.atan2(this.vy, this.vx);
    const dir = dir8(tr ? Math.atan2(tr.phase === 'dash' ? tr.dy : this.vy || tr.dy, tr.phase === 'dash' ? tr.dx : this.vx || tr.dx) : facing);
    const flash = this.hurtTimer > 0.2;
    const v = { outline: this.outline };

    if (tr && tr.phase === 'air') {
      this.drawFlippingDeck(ctx, feetY - z * 0.9 - 1, tr);
      this.blitPose(ctx, 'body', dir, 0, feetY - z - 3 * PX, v, flash);
    } else if (this.swing) {
      this.drawSwing(ctx, feetY, dir, v, flash);
    } else if (this.onFoot) {
      const frame = this.walkAnim > 0 ? Math.floor(this.walkAnim * 5) % 2 : 0;
      this.blitPose(ctx, 'foot', dir, frame, feetY, v, flash);
    } else {
      // Sur la planche : l'image B passe de temps en temps (poussée), sinon il glisse.
      const pushing = tr?.phase === 'push';
      const frame = pushing || (moving && Math.floor(this.walkAnim * 2.2) % 3 === 2) ? 1 : 0;
      const bob = moving ? Math.round(Math.sin(this.walkAnim * 9)) * 0.5 : 0;
      if (throwing) {
        const sh = this.blitPose(ctx, 'throw', dir, 0, feetY + 3 * PX + bob, v, flash);
        this.drawThrowArm(ctx, sh.x, sh.y);
      } else this.blitPose(ctx, 'ride', dir, frame, feetY + 3 * PX + bob, v, flash);
    }
  }

  /**
   * Bras droit qui lance : armé derrière et au-dessus de l'épaule, fouetté vers la visée
   * (le lancer part à cet instant), tenu un instant, puis il retombe le long du corps.
   */
  private drawThrowArm(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const u = 1 - this.throwAnim / THROW_TIME; // 0 → 1
    const L = 8 * PX;
    const ax = Math.cos(this.aim);
    const ay = Math.sin(this.aim);
    const back = { x: sx - ax * L * 0.6, y: sy - ay * L * 0.4 - L * 0.7 };
    // Visée vers le haut / le bas : le bras se tend devant le corps (vers son centre), sinon
    // il se confondrait avec un bras pendant.
    const front = { x: sx + ax * L + (this.x - sx) * 0.6 * (1 - Math.abs(ax)), y: sy + ay * L * 0.75 - L * 0.1 };
    const rest = { x: sx + ax * L * 0.2, y: sy + L * 0.85 };
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    let hand: { x: number; y: number };
    if (u < 0.2) hand = lerp(back, front, 1 - (1 - u / 0.2) ** 2);
    else if (u < 0.55) hand = front;
    else hand = lerp(front, rest, (u - 0.55) / 0.45);
    this.drawArm(ctx, sx, sy, hand.x, hand.y);
    ctx.fillStyle = '#020202';
    ctx.fillRect(hand.x - 2 * PX, hand.y - 2 * PX, 4 * PX, 4 * PX);
    ctx.fillStyle = '#d8ae95';
    ctx.fillRect(hand.x - 1.2 * PX, hand.y - 1.2 * PX, 2.4 * PX, 2.4 * PX);
  }

  /** Dessine une pose : `bottom` = bas de l'image (pieds ou roues). Retourne la 1re épaule (monde). */
  private blitPose(
    ctx: CanvasRenderingContext2D,
    look: 'ride' | 'foot' | 'body' | 'throw',
    dir: ReturnType<typeof dir8>,
    frame: number,
    bottom: number,
    v: { outline: string },
    flash: boolean,
  ): { x: number; y: number } {
    const f = skaterFrame(look, dir, frame, v);
    const left = this.x - f.anchorX * PX;
    const top = bottom + f.drop * PX - f.rows * PX;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.img, left, top, f.img.width * PX, f.img.height * PX);
    if (flash) {
      const s = skaterFrame(look, dir, frame, { outline: v.outline, silhouette: '#ffffff' });
      ctx.drawImage(s.img, left, top, s.img.width * PX, s.img.height * PX);
    }
    ctx.restore();
    const sh = f.shoulders[0];
    return sh ? { x: left + (sh.x + 0.5) * PX, y: top + (sh.y + 0.5) * PX } : { x: this.x, y: top };
  }

  /** Planche sous les pieds pendant un trick : elle roule (flip) et/ou pivote (shove-it). */
  private drawFlippingDeck(ctx: CanvasRenderingContext2D, y: number, tr: TrickState): void {
    const u = Math.min(1, tr.t / TRICK.airTime);
    const kind = TRICKS[tr.variant];
    const ease = u < 0.85 ? u / 0.85 : 1; // la planche est rattrapée un peu avant l'atterrissage
    const roll = Math.cos(ease * TAU * Math.abs(kind.roll)); // 1 = grip dessus, -1 = dessous
    const spin = ease * TAU * kind.spin;
    let face: DeckFace = roll > 0.35 ? 'grip' : roll < -0.35 ? 'under' : 'edge';
    if (kind.roll === 0) face = 'grip';
    const img = deckImage(face);
    const s = PX * 1.1; // même échelle que les poses (un poil plus grande pour bien lire le flip)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.x, y);
    ctx.rotate(Math.sin(spin) * 0.6 + (kind.roll < 0 ? -0.15 : 0.15) * Math.sin(u * Math.PI));
    ctx.scale(Math.cos(spin) >= 0 ? 1 : -1, face === 'edge' ? 1 : Math.max(0.35, Math.abs(roll)));
    ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
  }

  /**
   * Coup de planche : le corps (sans ses bras pendants) + des bras redessinés qui partent
   * des épaules et tiennent la planche à deux mains par la queue ; la planche suit le coup.
   */
  private drawSwing(ctx: CanvasRenderingContext2D, feetY: number, dir: ReturnType<typeof dir8>, v: { outline: string }, flash: boolean): void {
    const sw = this.swing!;
    const hit = COMBO.hits[sw.step];
    const u = Math.min(1, sw.t / COMBO.swingTime);
    const e = 1 - (1 - u) * (1 - u); // départ vif, fin amortie
    const behind = dir === 'up' || dir === 'upLeft' || dir === 'upRight';

    // Angle de la planche et hauteur des mains
    let angle: number;
    let lift = 0;
    if (hit.sweep !== 0) {
      angle = sw.aim + hit.sweep * (1.2 - 2.4 * e);
    } else {
      // Fracas : planche levée au-dessus de la tête, puis abattue devant lui
      const up = -Math.PI / 2;
      if (u < 0.35) {
        angle = up;
        lift = (u / 0.35) * 7.7; // en pixels de sprite
      } else {
        const k = (u - 0.35) / 0.65;
        const s2 = k * k; // accélère en descendant
        angle = up + angleDiff(up, sw.aim) * s2;
        lift = 7.7 * (1 - s2);
      }
    }
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const lean = Math.cos(sw.aim) * 2.3 * PX * e; // le corps accompagne le coup

    const f = skaterFrame('swing', dir, 0, v);
    const left = this.x + lean - f.anchorX * PX;
    const top = feetY - f.rows * PX;
    const shoulders = f.shoulders.map((s) => ({ x: left + (s.x + 0.5) * PX, y: top + (s.y + 0.5) * PX }));
    const mid = shoulders.reduce((a, s) => ({ x: a.x + s.x / shoulders.length, y: a.y + s.y / shoulders.length }), { x: 0, y: 0 });
    // Prise : à une longueur de bras des épaules, dans la direction de la planche
    const grip = { x: mid.x + dx * 9.2 * PX, y: mid.y + dy * 7 * PX - lift * PX };

    const drawBody = () => {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(f.img, left, top, f.img.width * PX, f.img.height * PX);
      if (flash) {
        const s = skaterFrame('swing', dir, 0, { outline: v.outline, silhouette: '#ffffff' });
        ctx.drawImage(s.img, left, top, s.img.width * PX, s.img.height * PX);
      }
      ctx.restore();
    };
    const drawBoard = () => {
      const img = deckImage('grip');
      const s = PX * 1.1;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(grip.x, grip.y);
      ctx.rotate(angle);
      // Tenue par la queue : les mains sont à ~3 pixels du bout
      ctx.drawImage(img, -3 * s, (-img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
    };
    const drawArms = () => {
      for (const sh of shoulders) this.drawArm(ctx, sh.x, sh.y, grip.x, grip.y);
      // Mains (peau, contour noir) par-dessus la planche
      ctx.fillStyle = '#020202';
      ctx.fillRect(grip.x - 2 * PX, grip.y - 2 * PX, 4 * PX, 4 * PX);
      ctx.fillStyle = '#d8ae95';
      ctx.fillRect(grip.x - 1.2 * PX, grip.y - 1.2 * PX, 2.4 * PX, 2.4 * PX);
    };

    if (behind) {
      // De dos : bras et planche passent derrière le corps
      drawBoard();
      drawArms();
      drawBody();
    } else {
      drawBody();
      drawBoard();
      drawArms();
    }
  }

  /** Bras pixel art : manche grise (contour noir) de l'épaule jusqu'à la main. */
  private drawArm(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.ceil(len / (PX * 0.7)));
    ctx.save();
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass === 0 ? '#020202' : '#c8caca';
      const r = pass === 0 ? 1.6 * PX : 0.9 * PX;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const x = x0 + (x1 - x0) * k;
        const y = y0 + (y1 - y0) * k;
        if (pass === 1 && k > 0.55) ctx.fillStyle = '#b3a99d'; // ombre de la manche vers le poignet
        ctx.fillRect(Math.round((x - r) / PX * 2) * PX / 2, Math.round((y - r) / PX * 2) * PX / 2, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    // Traînée du coup (croissant net, style « lame »)
    const sw = this.swing;
    if (sw) {
      const hit = COMBO.hits[sw.step];
      const u = Math.min(1, sw.t / COMBO.swingTime);
      const R = this.hw + hit.reach;
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
        const fx = this.x + Math.cos(sw.aim) * (this.hw + hit.reach * 0.6);
        const fy = this.y + Math.sin(sw.aim) * (this.hw + hit.reach * 0.6);
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
      ctx.ellipse(tp.x, tp.y + tp.hh, tp.hw * 1.8, tp.hw * 0.8, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Haut du sprite : la plus haute de ses poses au sol (sur la planche ou à pied). */
  protected override spriteTop(): number {
    if (skaterHeight === 0) {
      for (const d of DIRS8) {
        const ride = skaterFrame('ride', d, 0, { outline: COLORS.ally });
        const foot = skaterFrame('foot', d, 0, { outline: COLORS.ally });
        skaterHeight = Math.max(skaterHeight, (ride.rows - ride.drop - 3) * PX, foot.rows * PX);
      }
    }
    return this.y + this.hh - skaterHeight;
  }

  override drawOverlay(ctx: CanvasRenderingContext2D): void {
    super.drawOverlay(ctx);
    if (this.dead || this.speedStacks === 0) return;
    // Chevrons de vitesse à gauche de la barre de vie (dessous, ils cacheraient sa tête)
    const y = this.spriteTop() - 4 - 3.5;
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
