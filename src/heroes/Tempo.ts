import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { boxInCone, distToBox } from '../core/geometry';
import { degToRad, randRange } from '../core/math';
import { hostile } from '../entities/Combatant';
import { Projectile } from '../entities/Projectile';
import { t } from '../i18n';
import { TEMPO_SPRITE } from '../sprites/library';
import { lineOfSight } from '../world/Visibility';
import { Hero, type AbilitySlot, type WeaponHud } from './Hero';
import { Magazine } from './Magazine';

export const SONIC = {
  magSize: 20,
  reloadTime: 1.25,
  burst: 4,
  burstInterval: 0.075,
  burstCooldown: 0.45, // pause entre deux rafales
  damage: 20,
  speed: 720, // projectiles lents
  radius: 6,
  range: 650,
  spreadDeg: 2,
};
export const BOOP = { cooldown: 4, range: 130, halfArc: degToRad(45), damage: 25, impulse: 1100 };
export const AURA = {
  radius: 170,
  heal: 10, // PV/s (réduit : 16 → 10)
  ampHeal: 50, // pendant le Surrégime (70 → 50)
  speedBonus: 0.3, // +30 %
  ampSpeedBonus: 0.7,
  swapCooldown: 0.3,
};
const AMP = { duration: 3, cooldown: 12 };

type AuraMode = 'heal' | 'speed';

/**
 * Tempo — support mobile.
 * Passif : aura (Soin / Vitesse) · Clic G : rafale de 4 · Clic D : Onde de choc (recul)
 * Espace : changer d'aura · Maj : Surrégime (aura renforcée 3 s).
 */
export class Tempo extends Hero {
  mode: AuraMode = 'heal';
  private ampTimer = 0;
  private ampCooldown = 0;
  private boopCooldown = 0;
  private swapCooldown = 0;
  private pulse = 0;

  private readonly mag = new Magazine(SONIC.magSize, SONIC.reloadTime);
  private burstLeft = 0;
  private burstTimer = 0;
  private nextBurst = 0;

  constructor() {
    super({
      name: 'Tempo',
      maxHp: 200,
      sprite: TEMPO_SPRITE,
      px: 2.2, // hitbox moyenne
      speed: 330, // même vitesse de base que Flux
      acceleration: 16,
      color: '#59d48a',
    });
  }

  get auraColor(): string {
    return this.mode === 'heal' ? COLORS.auraHeal : COLORS.auraSpeed; // jaune = Soin, vert = Vitesse
  }
  get amped(): boolean {
    return this.ampTimer > 0;
  }
  override get spreadDeg(): number {
    return SONIC.spreadDeg;
  }

  // ---- état lu par l'IA ----
  get boopReady(): boolean {
    return this.boopCooldown <= 0;
  }
  get ampReady(): boolean {
    return this.ampCooldown <= 0 && !this.amped;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number): void {
    this.ampTimer = Math.max(0, this.ampTimer - dt);
    this.ampCooldown = Math.max(0, this.ampCooldown - dt);
    this.boopCooldown = Math.max(0, this.boopCooldown - dt);
    this.swapCooldown = Math.max(0, this.swapCooldown - dt);
    this.pulse += dt;

    this.mag.update(dt);
  }

  /** L'aura affecte Tempo et tous ses alliés dans son rayon (aucun en chacun pour soi). */
  override applyAura(dt: number, ctx: GameContext): void {
    const heal = (this.amped ? AURA.ampHeal : AURA.heal) * dt;
    const speedMul = 1 + (this.amped ? AURA.ampSpeedBonus : AURA.speedBonus);
    for (const bot of ctx.targets) {
      if (bot === this || !bot.alive || hostile(this, bot)) continue;
      if (distToBox(this.x, this.y, bot.box()) > AURA.radius) continue;
      bot.buff = this.mode; // indicateur "+" ou ">>" au-dessus de la tête
      if (this.mode === 'heal') bot.heal(heal);
      else bot.auraSpeedMul = speedMul;
    }
    this.buff = this.mode;
    if (this.mode === 'heal') this.heal(heal);
  }

  protected override speedMultiplier(): number {
    if (this.mode !== 'speed') return 1;
    return 1 + (this.amped ? AURA.ampSpeedBonus : AURA.speedBonus);
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    const input = this.controls;

    if (input.pressed('reload') && this.mag.ammo < SONIC.magSize) {
      this.mag.startReload();
      this.burstLeft = 0;
    }

    // Rafale : une pression lance 4 tirs successifs, même si on relâche.
    this.nextBurst = Math.max(0, this.nextBurst - dt);
    if (
      input.held('primary') &&
      !this.isMeleeing &&
      this.burstLeft === 0 &&
      this.nextBurst <= 0 &&
      !this.mag.reloading &&
      this.mag.ammo > 0
    ) {
      this.burstLeft = SONIC.burst;
      this.burstTimer = 0;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      while (this.burstLeft > 0 && this.burstTimer <= 0) {
        if (!this.mag.consume()) {
          this.burstLeft = 0;
          break;
        }
        this.fireSonic(ctx);
        this.burstLeft--;
        this.burstTimer += SONIC.burstInterval;
      }
      if (this.burstLeft === 0) this.nextBurst = SONIC.burstCooldown;
    }
    if (this.mag.ammo === 0) this.mag.startReload();

    if (input.pressed('secondary') && this.boopCooldown <= 0) this.boop(ctx);
    if (input.pressed('ability1') && this.swapCooldown <= 0) this.swapAura(ctx);
    if (input.pressed('ability2') && this.ampCooldown <= 0) this.ampItUp(ctx);
  }

  /** La mêlée interrompt la rafale en cours et le rechargement. */
  protected override onQuickMelee(): void {
    this.burstLeft = 0;
    this.mag.cancelReload();
  }

  protected override onRespawn(): void {
    this.mag.refill();
    this.burstLeft = 0;
    this.ampTimer = 0;
    this.ampCooldown = 0;
    this.boopCooldown = 0;
  }

  // ------------------------------------------------------------ compétences

  private fireSonic(ctx: GameContext): void {
    const ox = this.x + Math.cos(this.aim) * (this.radius + 10);
    const oy = this.y + Math.sin(this.aim) * (this.radius + 10);
    if (ctx.arena.pointInWall(ox, oy)) return;
    const half = degToRad(SONIC.spreadDeg) / 2;
    ctx.spawnProjectile(
      new Projectile({
        x: ox,
        y: oy,
        angle: this.aim + randRange(-half, half),
        speed: SONIC.speed,
        damage: SONIC.damage,
        team: this.team,
        owner: this,
        range: SONIC.range,
        radius: SONIC.radius,
        style: 'sonic',
      }),
    );
  }

  /** Cône très court : peu de dégâts, gros recul. Nécessite une ligne de vue. */
  private boop(ctx: GameContext): void {
    this.boopCooldown = BOOP.cooldown;
    const reach = this.radius + BOOP.range;
    ctx.effects.wedge(this.x, this.y, this.aim, BOOP.halfArc, reach, this.auraColor, 0.25, this.radius);

    for (const bot of ctx.targets) {
      if (!bot.alive || !hostile(this, bot) || bot.pinned) continue;
      if (!boxInCone(this.x, this.y, this.aim, BOOP.halfArc, reach, bot.box())) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, bot.x, bot.y)) continue;
      ctx.damage(bot, BOOP.damage, this);
      const d = Math.hypot(bot.x - this.x, bot.y - this.y) || 1;
      bot.applyImpulse(((bot.x - this.x) / d) * BOOP.impulse, ((bot.y - this.y) / d) * BOOP.impulse, this);
    }
  }

  private swapAura(ctx: GameContext): void {
    this.swapCooldown = AURA.swapCooldown;
    this.mode = this.mode === 'heal' ? 'speed' : 'heal';
    ctx.effects.ring(this.x, this.y, this.auraColor, AURA.radius, 0.3);
  }

  private ampItUp(ctx: GameContext): void {
    this.ampTimer = AMP.duration;
    this.ampCooldown = AMP.cooldown;
    ctx.effects.ring(this.x, this.y, this.auraColor, AURA.radius + 20, 0.45);
    ctx.effects.sparks(this.x, this.y, this.auraColor, 18, 300);
  }

  // ------------------------------------------------------------ sprite

  /** Les écouteurs prennent la couleur de l'aura (jaune = Soin, vert = Vitesse). */
  protected override spriteOverrides(): Record<string, string> {
    return { a: this.auraColor };
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    return [
      {
        input: 'secondary',
        name: t('tempo.boop'),
        icon: 'boop',
        color: this.auraColor,
        cooldown: this.boopCooldown,
        cooldownMax: BOOP.cooldown,
      },
      {
        input: 'ability1',
        name: t('tempo.aura'),
        icon: 'swap',
        color: this.auraColor,
        active: true,
        label: t(this.mode === 'heal' ? 'aura.heal' : 'aura.speed'),
      },
      {
        input: 'ability2',
        name: t('tempo.amp'),
        icon: 'amp',
        color: this.auraColor,
        cooldown: this.amped ? 0 : this.ampCooldown,
        cooldownMax: AMP.cooldown,
        active: this.amped,
        bar: this.amped ? this.ampTimer / AMP.duration : undefined,
      },
    ];
  }

  weaponHud(): WeaponHud {
    return {
      name: t('tempo.weapon'),
      ammo: this.mag.ammo,
      magSize: SONIC.magSize,
      reloadProgress: this.mag.reloading ? this.mag.progress : undefined,
    };
  }

  // ------------------------------------------------------------ rendu

  override drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const color = this.auraColor;
    const R = AURA.radius;

    ctx.globalAlpha = this.amped ? 0.16 : 0.07;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, R, 0, Math.PI * 2);
    ctx.fill();

    // Anneau pointillé qui tourne + onde qui pulse
    ctx.globalAlpha = this.amped ? 0.9 : 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = this.amped ? 3 : 2;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -this.pulse * (this.amped ? 90 : 40);
    ctx.beginPath();
    ctx.arc(this.x, this.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    const wave = (this.pulse * (this.amped ? 1.6 : 0.8)) % 1;
    ctx.globalAlpha = 0.35 * (1 - wave);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + (R - this.radius) * wave, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
