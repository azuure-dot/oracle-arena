import type { BotControls } from '../core/Controls';
import { randRange } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import { Flux } from '../heroes/Flux';
import type { Hero } from '../heroes/Hero';
import { FIRE, HAMMER, Rempart } from '../heroes/Rempart';
import { GEAR, Skater, TRICK } from '../heroes/Skater';
import { BOOP, SONIC, Tempo } from '../heroes/Tempo';
import { SMASH, THROW, Thor } from '../heroes/Thor';
import { BOMB, SHELL, Turty, WATER_GUN } from '../heroes/Turty';
import { HeroBrain, type BrainWorld, type TargetInfo } from './HeroBrain';
import { pathClear } from './steering';

/**
 * Flux — le glitcheur, à distance moyenne : tire dès qu'il a la cible en vue.
 * - Esquive de temps en temps en Frappe fantôme (le clone attire les tirs adverses).
 * - Sous 45 % de PV : Permutation (vers un clone, +75 PV), sinon Frappe
 *   fantôme pour fuir.
 */
export class FluxBrain extends HeroBrain<Flux> {
  protected readonly preferredRange = 270;
  protected override rangeBand = 90;
  protected override strafeWeight = 1;
  protected override projectileSpeed = 1700;
  protected override turnRate = 8;

  private fleeTimer = 0;
  private dodgeTimer = randRange(2, 4);

  protected combat(dt: number, _w: BrainWorld, _t: Combatant, i: TargetInfo): void {
    const f = this.hero;
    const c = this.controls;
    this.fleeTimer = Math.max(0, this.fleeTimer - dt);
    this.dodgeTimer -= dt;
    const away = { x: -i.dir.x, y: -i.dir.y };
    const low = f.hp / f.maxHp < 0.45;

    if (low) {
      if (f.permuteReady) {
        c.press('ability1'); // vers un clone, +75 PV
        this.fleeTimer = 1.2;
      } else if (f.phantomReady) {
        this.forcedMove = away;
        c.press('secondary'); // invisible, le clone part vers la cible
        this.fleeTimer = 1.6;
      }
    }
    if (low && this.fleeTimer > 0) this.forcedMove = away; // continue de s'éloigner

    // Esquive latérale de temps en temps : le clone continue vers la cible et attire les tirs.
    if (!low && f.phantomReady && this.dodgeTimer <= 0 && this.targetVisible && i.dist < 520) {
      this.forcedMove = { x: -i.dir.y * this.strafeDir, y: i.dir.x * this.strafeDir };
      c.press('secondary');
      this.dodgeTimer = randRange(3, 6);
    }

    if (this.canShoot(i, 0.14) && i.dist < 680) c.hold('primary');
    if (this.targetVisible && i.edge < 10 && f.meleeCooldown <= 0) c.press('melee');
  }
}

/**
 * Rempart — cherche le corps à corps.
 * Bouclier (clic D) s'il est touché de loin, Onde de feu (Espace) à distance,
 * Charge (Maj) quand la ligne est dégagée jusqu'à la cible.
 */
export class RempartBrain extends HeroBrain<Rempart> {
  protected readonly preferredRange = 70;
  protected override rangeBand = 25;
  protected override strafeWeight = 0.12;
  protected override projectileSpeed = FIRE.speed;
  protected override turnRate = 5;

  private shieldTimer = 0;
  private chargeHesitation = randRange(0.3, 1.2);

  protected combat(dt: number, w: BrainWorld, t: Combatant, i: TargetInfo): void {
    const r = this.hero;
    const c = this.controls;
    if (r.isCharging) return; // préparation / course : la visée suit la cible (oriente la Charge)

    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    const reach = r.radius + HAMMER.reach;
    const inMelee = this.targetVisible && i.edge < reach * 0.9;

    // Touché de loin récemment → bouclier levé un moment en avançant.
    const hitFromRange = w.time - this.lastDamage.time < 0.3 && this.lastDamage.fromDist > 230;
    if (hitFromRange && r.shieldAvailable && r.shieldHp > 300) this.shieldTimer = randRange(1.2, 2.2);

    if (inMelee) {
      this.shieldTimer = 0; // baisse le bouclier pour frapper
      if (i.aimError < 0.5) c.hold('primary');
    } else if (this.shieldTimer > 0) {
      c.hold('secondary');
    }

    if (!this.targetVisible || this.reaction > 0) return;

    if (r.fireReady && i.dist > 260 && i.dist < 900 && this.canShoot(i, 0.07)) c.press('ability1');

    this.chargeHesitation -= dt;
    if (
      r.chargeReady &&
      this.chargeHesitation <= 0 &&
      i.dist > 200 &&
      i.dist < 620 &&
      i.aimError < 0.1 &&
      pathClear(w.arena, r, t.x, t.y)
    ) {
      c.press('ability2');
      this.chargeHesitation = randRange(0.3, 1.2);
    }
  }
}

/**
 * Thor — cherche le corps à corps comme Rempart.
 * Mur de foudre (clic D) s'il est touché de loin, Ruée (Espace) pour coller une cible
 * un peu éloignée, Lancer du marteau (Maj) à mi-distance ; une fois le marteau au sol,
 * fonce le rechercher (Ruée) s'il est près de la cible, sinon le rappelle (Maj).
 */
export class ThorBrain extends HeroBrain<Thor> {
  protected readonly preferredRange = 70;
  protected override rangeBand = 25;
  protected override strafeWeight = 0.15;
  protected override projectileSpeed = THROW.speed;
  protected override turnRate = 5;

  private shieldTimer = 0;
  private hesitation = randRange(0.4, 1.2);
  private hammerTime = 0;

  protected override always(dt: number): void {
    const h = this.hero;
    this.hammerTime = h.hammer ? this.hammerTime + dt : 0;
    // Hors combat, le marteau ne reste pas au sol : rappel au bout d'un moment.
    if (h.hammer?.phase === 'landed' && this.hammerTime > 2.5) this.controls.press('ability2');
  }

  protected combat(dt: number, w: BrainWorld, t: Combatant, i: TargetInfo): void {
    const h = this.hero;
    const c = this.controls;
    if (h.isDashing) return;

    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.hesitation -= dt;
    const reach = h.radius + h.meleeReach;
    const inMelee = this.targetVisible && i.edge < reach * 0.9;

    const hitFromRange = w.time - this.lastDamage.time < 0.3 && this.lastDamage.fromDist > 230;
    if (hitFromRange && h.barrierAvailable && h.barrierHp > 300) this.shieldTimer = randRange(1.2, 2.2);

    if (inMelee) {
      this.shieldTimer = 0; // baisse le mur pour frapper
      if (i.aimError < 0.5) c.hold('primary');
    } else if (this.shieldTimer > 0) {
      c.hold('secondary');
    }

    // Marteau au sol : ruée vers lui s'il est près de la cible (décharge), sinon rappel.
    const ham = h.hammer;
    if (ham && ham.phase === 'landed' && this.hammerTime > 0.6) {
      const nearTarget = Math.hypot(ham.x - t.x, ham.y - t.y) < SMASH.pickupRadiusAoe;
      if (nearTarget && h.dashReady) c.press('ability1');
      else if (this.hammerTime > 1.2) c.press('ability2');
      return;
    }

    if (!this.targetVisible || this.reaction > 0 || this.hesitation > 0) return;

    if (h.throwReady && i.dist > 200 && i.dist < THROW.range && i.aimError < 0.1) {
      c.press('ability2');
      this.hesitation = randRange(0.4, 1.2);
      return;
    }
    if (h.dashReady && h.hasHammer && i.dist > 110 && i.dist < 200 && i.aimError < 0.1 && pathClear(w.arena, h, t.x, t.y)) {
      c.press('ability1');
      this.hesitation = randRange(0.4, 1.2);
    }
  }
}

/**
 * Tempo — aura de Vitesse en patrouille, de Soin dès qu'il perd des PV.
 * Tire en continu sur sa cible, Onde de choc (clic D) quand l'ennemi est très proche.
 */
export class TempoBrain extends HeroBrain<Tempo> {
  protected readonly preferredRange = 300;
  protected override rangeBand = 90;
  protected override strafeWeight = 0.9;
  protected override projectileSpeed = SONIC.speed;
  protected override turnRate = 7;

  private wantHeal = false;

  /** Aura choisie selon les PV (avec hystérésis pour ne pas alterner sans arrêt). */
  protected override always(): void {
    const tp = this.hero;
    const ratio = tp.hp / tp.maxHp;
    if (ratio < 0.8) this.wantHeal = true;
    else if (ratio >= 0.98) this.wantHeal = false;
    const want = this.wantHeal ? 'heal' : 'speed';
    if (tp.mode !== want) this.controls.press('ability1');
  }

  protected combat(_dt: number, _w: BrainWorld, _t: Combatant, i: TargetInfo): void {
    const tp = this.hero;
    const c = this.controls;
    if (this.canShoot(i, 0.12) && i.dist < 620) c.hold('primary');
    if (!this.targetVisible) return;
    if (tp.boopReady && i.edge < BOOP.range * 0.7 && i.aimError < 0.4) c.press('secondary');
    if (tp.ampReady && tp.mode === 'heal' && tp.hp / tp.maxHp < 0.45) c.press('ability2');
    if (i.edge < 10 && tp.meleeCooldown <= 0 && !tp.boopReady) c.press('melee');
  }
}

/**
 * Skater — colle sa cible pour enchaîner le combo, lance son équipement à mi-distance.
 * Tricks sur l'ennemi pour fondre dessus et cumuler la vitesse, sur un allié blessé pour le soigner.
 * Aura de Soin dès qu'un allié proche est blessé, sinon Vitesse.
 */
export class SkaterBrain extends HeroBrain<Skater> {
  protected get preferredRange(): number {
    return this.hero.comboReady || this.hero.inCombo ? 55 : 230;
  }
  protected override rangeBand = 40;
  protected override strafeWeight = 0.5;
  protected override projectileSpeed = GEAR.speed;
  protected override turnRate = 8;

  private trickDelay = randRange(0.5, 1.5);

  protected override always(dt: number, w: BrainWorld): void {
    const s = this.hero;
    const c = this.controls;
    this.trickDelay -= dt;
    let hurt: Combatant | null = null;
    for (const a of w.targets) {
      if (a === s || !a.alive || hostile(s, a)) continue;
      if (Math.hypot(a.x - s.x, a.y - s.y) > 450 || a.hp / a.maxHp >= 0.7) continue;
      if (!hurt || a.hp / a.maxHp < hurt.hp / hurt.maxHp) hurt = a;
    }
    const want = hurt ? 'heal' : 'speed';
    if (s.mode !== want) c.press('ability2');
    // Aura de Soin : trick sur l'allié le plus proche dans l'aura, s'il a besoin de soin.
    if (s.mode === 'heal' && s.charges > 0 && !s.isTricking && this.trickDelay <= 0) {
      const ally = s.trickTarget(w);
      if (ally && ally.hp / ally.maxHp < 0.75) {
        c.press('ability1');
        this.trickDelay = randRange(0.8, 1.6);
      }
    }
  }

  /** Hors combat : un trick dans le vide quand toutes les charges sont là, pour aller plus vite. */
  protected override roam(): void {
    const s = this.hero;
    if (s.charges === TRICK.maxCharges && Math.hypot(s.vx, s.vy) > 200 && this.trickDelay <= 0) {
      this.controls.press('ability1');
      this.trickDelay = randRange(2, 4);
    }
  }

  protected combat(_dt: number, w: BrainWorld, _t: Combatant, i: TargetInfo): void {
    const s = this.hero;
    const c = this.controls;
    if (s.isTricking) return;
    const reach = s.radius + s.meleeReach;
    if (this.targetVisible && i.edge < reach * 0.85 && i.aimError < 0.6) {
      if (s.comboReady) c.hold('primary');
    } else if (this.canShoot(i, 0.1) && i.dist > 90 && i.dist < 650 && !s.inCombo) {
      c.hold('secondary');
    }
    // Aura de Vitesse : trick sur l'ennemi le plus proche dans l'aura (dégâts + vitesse),
    // plutôt quand il n'est pas déjà collé à lui (là, il frappe).
    if (
      s.mode === 'speed' &&
      this.reaction <= 0 &&
      s.charges > 0 &&
      this.trickDelay <= 0 &&
      (i.dist > 90 || !s.comboReady) &&
      s.trickTarget(w)
    ) {
      c.press('ability1');
      this.trickDelay = s.speedStacks > 0 ? randRange(0.4, 0.9) : randRange(1, 2.5);
    }
  }
}

/**
 * Turty — tire à distance moyenne, lance sa bombe sur les cibles un peu loin,
 * lance sa carapace quand la ligne est dégagée. Hors combat : arrose devant elle
 * puis file en tortue sur l'eau qu'elle vient de répandre.
 */
export class TurtyBrain extends HeroBrain<Turty> {
  protected readonly preferredRange = 330;
  protected override rangeBand = 90;
  protected override strafeWeight = 0.9;
  protected override projectileSpeed = WATER_GUN.speed;
  protected override turnRate = 7;

  private bombDelay = randRange(0.5, 1.5);
  private shellDelay = randRange(1, 2.5);
  private formDelay = 0;
  /** Forme voulue : clic D maintenu tant qu'elle veut rester en tortue. */
  private turtle = false;

  protected override always(dt: number): void {
    this.bombDelay -= dt;
    this.shellDelay -= dt;
    this.formDelay -= dt;
    if (this.turtle) this.controls.hold('secondary');
  }

  /** Change de forme (sans clignoter d'une forme à l'autre). */
  private want(form: 'human' | 'turtle'): void {
    const turtle = form === 'turtle';
    if (this.turtle === turtle || this.formDelay > 0) return;
    this.turtle = turtle;
    if (turtle) this.controls.hold('secondary');
    else this.controls.release('secondary');
    this.formDelay = 0.4;
  }

  override reset(): void {
    super.reset();
    this.turtle = false;
  }

  /** Hors combat : sol mouillé devant → tortue ; sinon, forme humaine et on arrose devant soi. */
  protected override roam(): void {
    const h = this.hero;
    const speed = Math.hypot(h.vx, h.vy);
    const dx = speed > 20 ? h.vx / speed : 0;
    const dy = speed > 20 ? h.vy / speed : 0;
    if (h.wetAt(h.x + dx * 50, h.y + dy * 50) && h.wetAt(h.x, h.y)) {
      this.want('turtle');
    } else {
      this.want('human');
      if (speed > 20 && !h.reloading && h.ammo > 8) this.controls.hold('primary');
    }
  }

  protected combat(_dt: number, w: BrainWorld, t: Combatant, i: TargetInfo): void {
    const h = this.hero;
    const c = this.controls;
    if (h.isShelling) return; // préparation : la visée suit la cible (oriente le lancer)

    // Peu de PV : fuite en tortue si le sol est mouillé, sinon on se bat.
    if (h.hp / h.maxHp < 0.3 && h.wetAt(h.x, h.y)) {
      this.forcedMove = { x: -i.dir.x, y: -i.dir.y };
      this.want('turtle');
      return;
    }
    if (this.canShoot(i, 0.12) && i.dist < WATER_GUN.range - 40) c.hold('primary');
    else if (h.form === 'turtle' && this.targetVisible) this.want('human');

    if (!this.targetVisible || this.reaction > 0) return;
    if (h.bombReady && this.bombDelay <= 0 && i.dist > 160 && i.dist < BOMB.range && i.aimError < 0.2) {
      c.press('ability2'); // la bombe tombe au point visé (la visée de l'IA est à la distance de la cible)
      this.bombDelay = randRange(1, 3);
      return;
    }
    if (
      h.shellReady &&
      this.shellDelay <= 0 &&
      i.dist > 90 &&
      i.dist < SHELL.speed * 0.45 &&
      i.aimError < 0.12 &&
      pathClear(w.arena, h, t.x, t.y)
    ) {
      c.press('ability1');
      this.shellDelay = randRange(1, 3);
    }
  }
}

/** L'IA adaptée au héros attribué au bot. */
export function createBrain(hero: Hero, controls: BotControls): HeroBrain {
  if (hero instanceof Flux) return new FluxBrain(hero, controls);
  if (hero instanceof Rempart) return new RempartBrain(hero, controls);
  if (hero instanceof Thor) return new ThorBrain(hero, controls);
  if (hero instanceof Tempo) return new TempoBrain(hero, controls);
  if (hero instanceof Skater) return new SkaterBrain(hero, controls);
  if (hero instanceof Turty) return new TurtyBrain(hero, controls);
  throw new Error(`Pas d'IA pour le héros ${hero.name}`);
}
