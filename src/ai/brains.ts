import type { BotControls } from '../core/Controls';
import { randRange } from '../core/math';
import type { Combatant } from '../entities/Combatant';
import { Flux } from '../heroes/Flux';
import type { Hero } from '../heroes/Hero';
import { FIRE, HAMMER, Rempart } from '../heroes/Rempart';
import { BOOP, SONIC, Tempo } from '../heroes/Tempo';
import { HeroBrain, type BrainWorld, type TargetInfo } from './HeroBrain';
import { pathClear } from './steering';

/**
 * Flux — distance moyenne, tire dès qu'elle a la cible en vue.
 * Sous 40 % de PV : Rappel (Espace), sinon Transfert (clic D) pour s'enfuir.
 */
export class FluxBrain extends HeroBrain<Flux> {
  protected readonly preferredRange = 270;
  protected override rangeBand = 90;
  protected override strafeWeight = 1;
  protected override projectileSpeed = 1700;
  protected override turnRate = 8;

  private fleeTimer = 0;
  private blinkDelay = 0;
  private dodgeTimer = randRange(2, 4);

  protected combat(dt: number, _w: BrainWorld, _t: Combatant, i: TargetInfo): void {
    const f = this.hero;
    const c = this.controls;
    this.fleeTimer = Math.max(0, this.fleeTimer - dt);
    this.blinkDelay = Math.max(0, this.blinkDelay - dt);
    this.dodgeTimer -= dt;
    const away = { x: -i.dir.x, y: -i.dir.y };

    const low = f.hp / f.maxHp < 0.4;
    if (low && !f.isRecalling) {
      if (f.recallReady) {
        c.press('ability1'); // Rappel : retour 3 s en arrière, PV compris
      } else if (f.blinks > 0 && this.blinkDelay <= 0) {
        this.forcedMove = away;
        c.press('secondary'); // Transfert dans la direction de fuite
        this.blinkDelay = 0.3;
        this.fleeTimer = 1.6;
      }
    }
    if (low && this.fleeTimer > 0) this.forcedMove = away; // continue de s'éloigner

    // Esquive latérale de temps en temps quand toutes les charges sont là.
    if (!low && f.blinks === 3 && this.dodgeTimer <= 0 && this.targetVisible && i.dist < 520) {
      this.forcedMove = { x: -i.dir.y * this.strafeDir, y: i.dir.x * this.strafeDir };
      c.press('secondary');
      this.dodgeTimer = randRange(2.5, 5);
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

/** L'IA adaptée au héros attribué au bot. */
export function createBrain(hero: Hero, controls: BotControls): HeroBrain {
  if (hero instanceof Flux) return new FluxBrain(hero, controls);
  if (hero instanceof Rempart) return new RempartBrain(hero, controls);
  if (hero instanceof Tempo) return new TempoBrain(hero, controls);
  throw new Error(`Pas d'IA pour le héros ${hero.name}`);
}
