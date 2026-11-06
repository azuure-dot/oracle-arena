import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { circleInCone, degToRad, randRange } from '../core/math';
import { Projectile } from '../entities/Projectile';
import { t } from '../i18n';
import { lineOfSight } from '../world/Visibility';
import { Hero, KEYS, type AbilitySlot, type WeaponHud } from './Hero';
import { Magazine } from './Magazine';

const SONIC = {
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
const BOOP = { cooldown: 4, range: 130, halfArc: degToRad(45), damage: 25, impulse: 1100 };
const AURA = {
  radius: 170,
  heal: 16, // PV/s
  ampHeal: 70,
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
      radius: 18, // hurtbox moyenne
      speed: 330, // même vitesse de base que Flux
      acceleration: 16,
      color: '#59d48a',
      colorDark: '#2f8a55',
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

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number, ctx: GameContext): void {
    this.ampTimer = Math.max(0, this.ampTimer - dt);
    this.ampCooldown = Math.max(0, this.ampCooldown - dt);
    this.boopCooldown = Math.max(0, this.boopCooldown - dt);
    this.swapCooldown = Math.max(0, this.swapCooldown - dt);
    this.pulse += dt;

    this.mag.update(dt);

    this.applyAura(dt, ctx);
  }

  /** L'aura affecte Tempo et tous les bots alliés dans son rayon. */
  private applyAura(dt: number, ctx: GameContext): void {
    const heal = (this.amped ? AURA.ampHeal : AURA.heal) * dt;
    const speedMul = 1 + (this.amped ? AURA.ampSpeedBonus : AURA.speedBonus);
    for (const bot of ctx.bots) {
      if (!bot.alive || bot.isEnemy) continue;
      if (Math.hypot(bot.x - this.x, bot.y - this.y) > AURA.radius + bot.radius * 0.5) continue;
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
    const input = ctx.input;

    if (input.wasPressed(...KEYS.reload) && this.mag.ammo < SONIC.magSize) {
      this.mag.startReload();
      this.burstLeft = 0;
    }

    // Rafale : une pression lance 4 tirs successifs, même si on relâche.
    this.nextBurst = Math.max(0, this.nextBurst - dt);
    if (input.isMouseDown(0) && this.burstLeft === 0 && this.nextBurst <= 0 && !this.mag.reloading && this.mag.ammo > 0) {
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

    if (input.wasMousePressed(2) && this.boopCooldown <= 0) this.boop(ctx);
    if (input.wasPressed(...KEYS.ability1) && this.swapCooldown <= 0) this.swapAura(ctx);
    if (input.wasPressed(...KEYS.ability2) && this.ampCooldown <= 0) this.ampItUp(ctx);
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

    for (const bot of ctx.bots) {
      if (!bot.alive || !bot.isEnemy || bot.pinned) continue;
      if (!circleInCone(this.x, this.y, this.aim, BOOP.halfArc, reach, bot.x, bot.y, bot.radius)) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, bot.x, bot.y)) continue;
      ctx.damageBot(bot, BOOP.damage);
      const d = Math.hypot(bot.x - this.x, bot.y - this.y) || 1;
      bot.applyImpulse(((bot.x - this.x) / d) * BOOP.impulse, ((bot.y - this.y) / d) * BOOP.impulse);
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

  protected drawBody(ctx: CanvasRenderingContext2D): void {
    const { x, y, radius: r } = this;

    // Amplificateur (arme) tenu à droite
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.aim);
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(r - 4, 2, 16, 9);
    ctx.fillStyle = this.auraColor;
    ctx.fillRect(r + 8, 3, 4, 7);
    ctx.restore();

    this.drawRoundBody(ctx, this.stats.color);

    // Casque audio : deux écouteurs perpendiculaires à la visée, couleur de l'aura
    ctx.fillStyle = this.auraColor;
    for (const side of [-1, 1]) {
      const a = this.aim + side * 1.57;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
