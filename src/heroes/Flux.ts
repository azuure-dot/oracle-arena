import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import { degToRad, lerp, randRange } from '../core/math';
import { RingBuffer } from '../core/RingBuffer';
import { Projectile } from '../entities/Projectile';
import { t } from '../i18n';
import { FLUX_SPRITE } from '../sprites/library';
import type { SpriteLayout } from '../sprites/SpriteRenderer';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';
import { Magazine } from './Magazine';

export const WEAPON = {
  magSize: 40,
  fireRate: 20, // 40 balles vidées en 2 s
  damage: 6 * 1.3, // +30 % (7,8 par balle, 156 dégâts/s)
  spreadDeg: 7,
  bulletSpeed: 1700,
  range: 720,
  reloadTime: 1.15,
};
// 3 s par charge ; distance réduite comme la marche (170 → 119)
export const BLINK = { maxCharges: 3, rechargeTime: 3, distance: 170 * MOVE_SPEED_SCALE };
export const RECALL = { cooldown: 12, rewindSeconds: 3, animDuration: 0.5 };

/** Un instantané enregistré à chaque frame pour le Rappel. */
interface HistorySample {
  t: number;
  x: number;
  y: number;
  hp: number;
}

interface RecallState {
  path: HistorySample[]; // [0] = maintenant ... [n-1] = il y a ~3 s
  elapsed: number;
  trailTimer: number;
}

/** Flux — duelliste ultra-mobile : Transfert (clic D) + Rappel (Espace). Petite hurtbox. */
export class Flux extends Hero {
  private readonly mag = new Magazine(WEAPON.magSize, WEAPON.reloadTime);
  private fireTimer = 0;
  private muzzleSide = 1;
  private muzzleFlash = 0;

  private blinkCharges = BLINK.maxCharges;
  private blinkTimer = 0;

  private recallCooldown = 0;
  private recall: RecallState | null = null;
  // 3 s à 300 FPS max ; au-delà, les plus vieux échantillons sont écrasés.
  private readonly history = new RingBuffer<HistorySample>(Math.ceil(RECALL.rewindSeconds * 300) + 16);

  constructor() {
    super({
      name: 'Flux',
      maxHp: 175,
      sprite: FLUX_SPRITE,
      px: 1.8, // petit sprite = petite hitbox : fragile mais difficile à toucher
      speed: 330,
      acceleration: 16,
      color: COLORS.accent,
    });
  }

  override get invulnerable(): boolean {
    return super.invulnerable || this.recall !== null;
  }
  override get spreadDeg(): number {
    return WEAPON.spreadDeg;
  }

  // ---- état lu par l'IA ----
  get blinks(): number {
    return this.blinkCharges;
  }
  get recallReady(): boolean {
    return this.recallCooldown <= 0 && this.recall === null && this.history.size > 0;
  }
  get isRecalling(): boolean {
    return this.recall !== null;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number): void {
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    if (this.blinkCharges < BLINK.maxCharges) {
      this.blinkTimer += dt;
      if (this.blinkTimer >= BLINK.rechargeTime) {
        this.blinkCharges++;
        this.blinkTimer = this.blinkCharges < BLINK.maxCharges ? this.blinkTimer - BLINK.rechargeTime : 0;
      }
    }
    this.recallCooldown = Math.max(0, this.recallCooldown - dt);
  }

  protected override isLocked(): boolean {
    return this.recall !== null;
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    this.updateRecall(dt, ctx);
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    if (this.controls.pressed('secondary')) this.tryBlink(ctx);
    if (this.controls.pressed('ability1')) this.tryRecall(ctx);
    if (this.recall) return;
    this.updateWeapon(dt, ctx);
  }

  protected override lateUpdate(_dt: number, ctx: GameContext): void {
    if (!this.recall) this.history.push({ t: ctx.time, x: this.x, y: this.y, hp: this.hp });
  }

  /** La mêlée interrompt le rechargement (comme le tir, il faudra le relancer). */
  protected override onQuickMelee(): void {
    this.mag.cancelReload();
  }

  protected override onRespawn(): void {
    this.mag.refill();
    this.blinkCharges = BLINK.maxCharges;
    this.blinkTimer = 0;
    this.recallCooldown = 0;
    this.recall = null;
    this.history.clear();
  }

  // ------------------------------------------------------------ arme

  private updateWeapon(dt: number, ctx: GameContext): void {
    this.mag.update(dt);
    if (this.controls.pressed('reload')) this.mag.startReload();

    this.fireTimer -= dt;
    if (this.controls.held('primary') && !this.isMeleeing) {
      // Boucle "while" : même à bas FPS on tire bien 20 balles/s.
      while (this.fireTimer <= 0 && this.mag.consume()) {
        this.fire(ctx);
        this.fireTimer += 1 / WEAPON.fireRate;
      }
    }
    if (this.fireTimer < 0) this.fireTimer = 0;
    if (this.mag.ammo === 0) this.mag.startReload();
  }

  private fire(ctx: GameContext): void {
    this.muzzleSide *= -1;
    this.muzzleFlash = 0.04;
    const muzzle = this.muzzlePosition(this.muzzleSide);
    const half = degToRad(WEAPON.spreadDeg) / 2;

    if (ctx.arena.pointInWall(muzzle.x, muzzle.y)) {
      ctx.effects.sparks(muzzle.x, muzzle.y, COLORS.bullet, 3);
      return;
    }
    ctx.spawnProjectile(
      new Projectile({
        x: muzzle.x,
        y: muzzle.y,
        angle: this.aim + randRange(-half, half),
        speed: WEAPON.bulletSpeed,
        damage: WEAPON.damage,
        team: this.team,
        owner: this,
        range: WEAPON.range,
      }),
    );
  }

  private muzzlePosition(side: number): { x: number; y: number } {
    const fx = Math.cos(this.aim);
    const fy = Math.sin(this.aim);
    const forward = this.radius + 11;
    const lateral = 6 * side;
    return { x: this.x + fx * forward - fy * lateral, y: this.y + fy * forward + fx * lateral };
  }

  // ------------------------------------------------------------ Transfert

  private tryBlink(ctx: GameContext): void {
    if (this.blinkCharges <= 0) return;
    let dir = this.moveDir;
    if (dir.x === 0 && dir.y === 0) dir = { x: Math.cos(this.aim), y: Math.sin(this.aim) };

    // Petits pas jusqu'au premier obstacle : impossible de traverser un mur.
    const dist = BLINK.distance;
    const steps = Math.ceil(dist / 4);
    let nx = this.x;
    let ny = this.y;
    for (let i = 1; i <= steps; i++) {
      const px = this.x + (dir.x * dist * i) / steps;
      const py = this.y + (dir.y * dist * i) / steps;
      if (ctx.arena.boxCollides(px, py, this.hw - 0.5, this.hh - 0.5, this.team)) break;
      nx = px;
      ny = py;
    }
    const travelled = Math.hypot(nx - this.x, ny - this.y);
    if (travelled < 4) return; // collé à un mur : charge non consommée

    const ghosts = Math.max(2, Math.floor(travelled / 22));
    for (let i = 0; i < ghosts; i++) {
      const t = i / ghosts;
      ctx.effects.afterimage(lerp(this.x, nx, t), lerp(this.y, ny, t), this.radius, COLORS.accent, 0.15 + 0.25 * t);
    }
    ctx.effects.ring(this.x, this.y, COLORS.accent, 26, 0.25);
    this.x = nx;
    this.y = ny;
    this.blinkCharges--;
  }

  // ------------------------------------------------------------ Rappel

  private sampleAgo(time: number): HistorySample | undefined {
    const target = time - RECALL.rewindSeconds;
    for (let i = 0; i < this.history.size; i++) {
      const s = this.history.fromNewest(i)!;
      if (s.t <= target) return s;
    }
    return this.history.oldest();
  }

  private tryRecall(ctx: GameContext): void {
    if (this.recallCooldown > 0 || this.history.size === 0) return;
    const targetT = ctx.time - RECALL.rewindSeconds;
    const path: HistorySample[] = [];
    for (let i = 0; i < this.history.size; i++) {
      const s = this.history.fromNewest(i)!;
      path.push(s);
      if (s.t <= targetT) break;
    }
    this.recall = { path, elapsed: 0, trailTimer: 0 };
    this.mag.cancelReload();
    this.vx = this.vy = 0;
    ctx.effects.ring(this.x, this.y, COLORS.recall, 60, 0.4);
  }

  private updateRecall(dt: number, ctx: GameContext): void {
    const st = this.recall!;
    st.elapsed += dt;
    const progress = Math.min(1, st.elapsed / RECALL.animDuration);

    // Rejoue le chemin à l'envers (interpolé entre deux échantillons).
    const f = progress * (st.path.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(st.path.length - 1, i0 + 1);
    this.x = lerp(st.path[i0].x, st.path[i1].x, f - i0);
    this.y = lerp(st.path[i0].y, st.path[i1].y, f - i0);

    st.trailTimer -= dt;
    if (st.trailTimer <= 0) {
      st.trailTimer = 0.025;
      ctx.effects.afterimage(this.x, this.y, this.radius, COLORS.recall, 0.4);
    }

    if (progress >= 1) {
      const target = st.path[st.path.length - 1];
      this.x = target.x;
      this.y = target.y;
      this.hp = Math.max(this.hp, target.hp); // PV restaurés seulement s'ils étaient plus hauts
      this.recall = null;
      this.recallCooldown = RECALL.cooldown;
      this.history.clear();
      this.history.push({ t: ctx.time, x: this.x, y: this.y, hp: this.hp });
      ctx.effects.ring(this.x, this.y, COLORS.recall, 70, 0.45);
      ctx.effects.sparks(this.x, this.y, COLORS.recall, 14, 260);
    }
  }

  // ------------------------------------------------------------ sprite

  protected override spriteTint(): { color: string; alpha: number } | undefined {
    return this.recall ? { color: COLORS.recall, alpha: 0.55 } : undefined;
  }
  protected override isWalking(): boolean {
    return this.recall !== null || super.isWalking();
  }
  protected override drawSpriteExtras(ctx: CanvasRenderingContext2D, _l: SpriteLayout, front: boolean): void {
    if (!front || this.muzzleFlash <= 0) return;
    const m = this.muzzlePosition(this.muzzleSide);
    ctx.fillStyle = 'rgba(255,240,180,0.95)';
    ctx.fillRect(m.x - 3, m.y - 3, 6, 6);
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    return [
      {
        input: 'secondary',
        name: t('flux.blink'),
        icon: 'blink',
        charges: this.blinkCharges,
        maxCharges: BLINK.maxCharges,
        chargeProgress: this.blinkCharges < BLINK.maxCharges ? this.blinkTimer / BLINK.rechargeTime : 0,
      },
      {
        input: 'ability1',
        name: t('flux.recall'),
        icon: 'recall',
        color: COLORS.recall,
        cooldown: this.recallCooldown,
        cooldownMax: RECALL.cooldown,
        active: this.recall !== null,
      },
    ];
  }

  weaponHud(): WeaponHud {
    return {
      name: t('flux.weapon'),
      ammo: this.mag.ammo,
      magSize: WEAPON.magSize,
      reloadProgress: this.mag.reloading ? this.mag.progress : undefined,
    };
  }

  // ------------------------------------------------------------ rendu

  /** Aperçu du Rappel : chemin des 3 dernières secondes + fantôme à destination. */
  override drawUnder(ctx: CanvasRenderingContext2D, time: number): void {
    // Aperçu réservé au joueur (ne pas révéler la destination du Rappel d'un bot).
    if (!this.isLocalPlayer || this.dead || this.recall || this.history.size < 2) return;
    ctx.strokeStyle = COLORS.recall;
    ctx.lineWidth = 2;
    ctx.globalAlpha = this.recallCooldown > 0 ? 0.08 : 0.22;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(this.history.size / 120));
    const target = time - RECALL.rewindSeconds;
    for (let i = 0; i < this.history.size; i += step) {
      const s = this.history.fromNewest(i)!;
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
      if (s.t <= target) break;
    }
    ctx.stroke();

    const ghost = this.sampleAgo(time);
    if (ghost && this.recallCooldown <= 0) {
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(ghost.x - this.hw, ghost.y - this.hh, this.hw * 2, this.hh * 2);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}
