import { COLORS } from '../config';
import type { GameContext } from '../core/GameContext';
import type { Circle } from '../core/geometry';
import { degToRad, randRange, TAU } from '../core/math';
import { hostile } from '../entities/Combatant';
import type { Decoy } from '../entities/Decoy';
import { Projectile } from '../entities/Projectile';
import type { Team } from '../entities/Team';
import { t } from '../i18n';
import { blaster, cached, drawTeamMarker, FLUX_LOOK, fluxCap, hand, head } from '../render/topdown';
import { drawHealthBar } from '../ui/healthBar';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';
import type { BuffKind } from '../ui/healthBar';
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

/**
 * Clic D — Frappe fantôme : 2 téléportations courtes (distance réduite comme la marche,
 * 170 → 101). La première rend Flux invisible 0,5 s pour l'adversaire et laisse à sa place
 * un clone holographique, immortel, qui court tout droit (vers la visée) pendant 2 s ; la seconde est
 * une simple téléportation. Les deux reviennent ensemble 6 s après la première.
 */
export const PHANTOM = {
  charges: 2,
  cooldown: 6,
  distance: 170 * MOVE_SPEED_SCALE,
  stealth: 0.5,
  cloneLife: 2,
};
/**
 * Espace — Permutation : Flux échange sa place avec son clone le plus proche ; un nouveau
 * clone apparaît à son ancienne place (nouveau leurre). Sans clone actif : rien. Chaque
 * permutation rend 75 PV.
 */
export const PERMUTE = { cooldown: 10, heal: 75 };
/** Vitesse de course d'un clone : celle de Flux qui marche. */
const CLONE_SPEED = 330 * MOVE_SPEED_SCALE;

/** Rayon de la boule (= hitbox), peau, gants cyber (bracelets lumineux cyan), d'après son concept. */
const R = 13;
const SKIN = FLUX_LOOK.skin;
const GLOVE = '#2a2f42';
const CUFF = FLUX_LOOK.cyan;
/** Couleurs du « glitch » (aberration chromatique des hologrammes). */
const GLITCH_A = '#3ef2ff';
const GLITCH_B = '#ff3ec8';

/**
 * Flux — le glitcheur : leurres et faux-semblants. Les adversaires doivent deviner le vrai
 * du faux. Clic G : blasters · Clic D : Frappe fantôme · Espace : Permutation.
 * Petite boule : fragile mais difficile à toucher.
 */
export class Flux extends Hero {
  private readonly mag = new Magazine(WEAPON.magSize, WEAPON.reloadTime);
  private fireTimer = 0;
  private muzzleSide = 1;
  private muzzleFlash = 0;
  /** Recul de chaque blaster (gauche, droite), pour l'animation des mains. */
  private recoil = [0, 0];

  private phantomCharges = PHANTOM.charges;
  /** Recharge des deux Frappes fantômes (démarre à la première). */
  private phantomCooldown = 0;
  /** Invisibilité restante (Frappe fantôme). */
  private stealth = 0;
  private permuteCooldown = 0;
  /** Clones holographiques encore actifs. */
  private clones: HoloClone[] = [];
  /** Horloge des effets de glitch. */
  private glitchTime = 0;

  constructor() {
    super({
      name: 'Flux',
      maxHp: 175,
      radius: R, // petite boule : fragile mais difficile à toucher
      speed: 330,
      acceleration: 16,
      color: COLORS.accent,
    });
  }

  override get stealthed(): boolean {
    return this.stealth > 0 && !this.dead;
  }
  override get spreadDeg(): number {
    return WEAPON.spreadDeg;
  }

  // ---- état lu par l'IA ----
  get phantomReady(): boolean {
    return this.phantomCharges > 0;
  }
  /** La prochaine Frappe fantôme laissera-t-elle un clone (la première des deux) ? */
  get phantomMakesClone(): boolean {
    return this.phantomCharges === PHANTOM.charges;
  }
  /** Permutation possible maintenant (recharge prête et un clone actif). */
  get permuteReady(): boolean {
    return this.permuteCooldown <= 0 && this.permuteTarget() !== null;
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number): void {
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.recoil = this.recoil.map((r) => Math.max(0, r - dt));
    if (this.phantomCharges < PHANTOM.charges) {
      this.phantomCooldown = Math.max(0, this.phantomCooldown - dt);
      if (this.phantomCooldown <= 0) this.phantomCharges = PHANTOM.charges; // les deux reviennent ensemble
    }
    this.permuteCooldown = Math.max(0, this.permuteCooldown - dt);
    this.stealth = Math.max(0, this.stealth - dt);
    this.glitchTime += dt;
    this.clones = this.clones.filter((c) => c.alive);
  }

  protected handleInput(dt: number, ctx: GameContext): void {
    if (this.controls.pressed('secondary')) this.tryPhantom(ctx);
    if (this.controls.pressed('ability1')) this.tryPermute(ctx);
    this.updateWeapon(dt, ctx);
  }

  /** La mêlée interrompt le rechargement (comme le tir, il faudra le relancer). */
  protected override onQuickMelee(): void {
    this.mag.cancelReload();
  }

  protected override onDeath(ctx: GameContext): void {
    this.clearDecoys(ctx);
  }

  protected override onRespawn(ctx: GameContext): void {
    this.mag.refill();
    this.phantomCharges = PHANTOM.charges;
    this.phantomCooldown = 0;
    this.permuteCooldown = 0;
    this.stealth = 0;
    this.clearDecoys(ctx);
  }

  /** Les clones disparaissent (mort, nouvelle manche). */
  private clearDecoys(ctx: GameContext): void {
    for (const c of this.clones) c.vanish(ctx);
    this.clones = [];
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
    this.recoil[this.muzzleSide > 0 ? 1 : 0] = 0.07;
    const muzzle = this.muzzlePosition(this.muzzleSide);
    const half = degToRad(WEAPON.spreadDeg) / 2;

    if (ctx.arena.pointInWall(muzzle.x, muzzle.y)) {
      ctx.effects.sparks(muzzle.x, muzzle.y, CUFF, 3);
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
        style: 'cyber', // balles bleu cyan, comme ses équipements cybernétiques
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

  // ------------------------------------------------------------ Frappe fantôme

  private tryPhantom(ctx: GameContext): void {
    if (this.phantomCharges <= 0) return;
    let dir = this.moveDir;
    if (dir.x === 0 && dir.y === 0) dir = { x: Math.cos(this.aim), y: Math.sin(this.aim) };

    // Petits pas jusqu'au premier obstacle : impossible de traverser un mur.
    const dist = PHANTOM.distance;
    const steps = Math.ceil(dist / 4);
    let nx = this.x;
    let ny = this.y;
    for (let i = 1; i <= steps; i++) {
      const px = this.x + (dir.x * dist * i) / steps;
      const py = this.y + (dir.y * dist * i) / steps;
      if (ctx.arena.circleCollides(px, py, this.radius - 0.5, this.team)) break;
      nx = px;
      ny = py;
    }
    if (Math.hypot(nx - this.x, ny - this.y) < 4) return; // collé à un mur : rien de consommé

    if (this.phantomCharges === PHANTOM.charges) {
      // Première des deux : le clone prend sa place et continue sa course vers la visée ;
      // Flux, lui, disparaît. Aucun effet à l'arrivée : rien ne trahit où il est allé.
      this.spawnClone(ctx, this.x, this.y, this.aim);
      this.stealth = PHANTOM.stealth;
      this.phantomCooldown = PHANTOM.cooldown;
    } else {
      // Seconde : simple téléportation (petit grésillement au départ).
      glitchBurst(ctx, this.x, this.y, 0.4);
    }
    this.x = nx;
    this.y = ny;
    this.phantomCharges--;
  }

  private spawnClone(ctx: GameContext, x: number, y: number, dir: number): void {
    const clone = new HoloClone(this, x, y, dir);
    this.clones.push(clone);
    ctx.spawnDecoy(clone);
    glitchBurst(ctx, x, y, 0.6);
  }

  // ------------------------------------------------------------ Permutation

  /** Destination de la Permutation : le clone actif le plus proche. */
  private permuteTarget(): HoloClone | null {
    let best: HoloClone | null = null;
    let bestD = Infinity;
    for (const c of this.clones) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private tryPermute(ctx: GameContext): void {
    if (this.permuteCooldown > 0) return;
    const target = this.permuteTarget();
    if (!target) return; // pas de clone actif : rien ne se passe
    const ox = this.x;
    const oy = this.y;
    target.vanish(ctx, false);
    this.x = target.x;
    this.y = target.y;
    ctx.arena.resolveCircle(this, this.radius, this.team);
    this.vx = this.vy = 0;
    // Nouveau leurre à l'ancienne place, qui part vers la visée.
    this.spawnClone(ctx, ox, oy, this.aim);
    this.heal(PERMUTE.heal);
    this.permuteCooldown = PERMUTE.cooldown;
    glitchBurst(ctx, this.x, this.y, 1);
    ctx.effects.text(this.x, this.y - R * 2.2, `+${PERMUTE.heal}`, '#7dff9a', 14, 0.8);
  }

  // ------------------------------------------------------------ rendu

  /**
   * Flux (ou un de ses clones) en (x, y), tourné vers `face`, avec son anneau d'équipe.
   * `kicks` : recul de chaque blaster (0 = au repos).
   */
  drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number, face: number, kicks = [0, 0]): void {
    drawTeamMarker(ctx, x, y, R, this.outline);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(face);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.drawLocal(ctx, face, kicks);
    ctx.restore();
  }

  /** Repère local (regard vers +x) : un blaster dans chaque main, la tête, les mains par-dessus. */
  private drawLocal(ctx: CanvasRenderingContext2D, rot: number, kicks: number[]): void {
    [-1, 1].forEach((side, i) => {
      ctx.save();
      ctx.translate(R * (1.0 - kicks[i] * 0.3), side * R * 0.55);
      cached(ctx, 'flux.blaster', R * 1.05, (c) => blaster(c, R));
      if (kicks[i] > 0.4 && this.muzzleSide === side) {
        ctx.fillStyle = 'rgba(160,250,255,0.95)'; // éclair au canon cyan
        ctx.beginPath();
        ctx.arc(R * 1.05, 0, R * 0.25, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });
    cached(ctx, 'flux.head', R * 1.8, (c) => {
      head(c, R, SKIN);
      fluxCap(c, R);
    });
    [-1, 1].forEach((side, i) => hand(ctx, R * (1.0 - kicks[i] * 0.3), side * R * 0.55, R * 0.32, GLOVE, rot, { band: CUFF }));
  }

  /** Un blaster dans chaque main, pointés vers la visée ; la main qui tire recule (éclair au canon). */
  protected drawTop(ctx: CanvasRenderingContext2D, rot: number): void {
    if (this.meleeAnim > 0) {
      cached(ctx, 'flux.head', R * 1.8, (c) => {
        head(c, R, SKIN);
        fluxCap(c, R);
      });
      this.idleHands(ctx, R, GLOVE, rot, { band: CUFF });
      return;
    }
    this.drawLocal(ctx, rot, [-1, 1].map((side) => this.recoil[side > 0 ? 1 : 0] / 0.07));
  }

  /**
   * Invisible (Frappe fantôme) : l'adversaire ne le voit pas du tout (le monde ne le dessine
   * pas) ; lui et ses alliés le voient en hologramme translucide qui grésille.
   */
  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    if (!this.stealthed) {
      super.draw(ctx);
      return;
    }
    ctx.save();
    ctx.globalAlpha = 0.35;
    this.drawFigure(ctx, this.x, this.y, this.aim);
    ctx.restore();
    drawGlitch(ctx, this.x, this.y, R, this.glitchTime, 0.8);
  }

  /** Aperçu réservé au joueur : où le mènerait la Permutation (trait pointillé). */
  override drawUnder(ctx: CanvasRenderingContext2D): void {
    if (!this.isLocalPlayer || this.dead) return;
    const target = this.permuteTarget();
    if (!target) return;
    ctx.save();
    ctx.strokeStyle = GLITCH_A;
    ctx.globalAlpha = this.permuteCooldown > 0 ? 0.12 : 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -this.glitchTime * 30;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    const target = this.permuteTarget();
    return [
      {
        input: 'secondary',
        name: t('flux.phantom'),
        icon: 'blink',
        color: GLITCH_A,
        charges: this.phantomCharges,
        maxCharges: PHANTOM.charges,
        chargeProgress: this.phantomCharges < PHANTOM.charges ? 1 - this.phantomCooldown / PHANTOM.cooldown : 0,
        active: this.stealthed,
      },
      {
        input: 'ability1',
        name: t('flux.permute'),
        icon: 'swap',
        color: GLITCH_A,
        cooldown: this.permuteCooldown,
        cooldownMax: PERMUTE.cooldown,
        label: this.permuteCooldown > 0 ? undefined : target ? t('flux.permute.clone') : t('flux.permute.none'),
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
}

// ------------------------------------------------------------ effets de glitch

/** Grésillement d'hologramme : bandes horizontales cyan / magenta qui sautent, cercle décalé. */
function drawGlitch(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number, strength: number): void {
  const k = Math.floor(time * 24); // change ~24 fois par seconde
  const rnd = (n: number) => {
    const s = Math.sin(k * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  ctx.save();
  ctx.globalAlpha = 0.55 * strength;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = GLITCH_A;
  ctx.beginPath();
  ctx.arc(x + 1.5, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = GLITCH_B;
  ctx.beginPath();
  ctx.arc(x - 1.5, y, r, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const by = y - r + rnd(i) * r * 2;
    const off = (rnd(i + 5) - 0.5) * r * 0.8;
    ctx.fillStyle = i % 2 ? GLITCH_B : GLITCH_A;
    ctx.globalAlpha = 0.5 * strength;
    ctx.fillRect(x - r * 1.1 + off, by, r * 2.2, 1.5 + rnd(i + 9) * 2);
  }
  ctx.restore();
}

/** Éclat de glitch (apparition / disparition d'un hologramme, téléportation). */
function glitchBurst(ctx: GameContext, x: number, y: number, size: number): void {
  ctx.effects.sparks(x, y, GLITCH_A, Math.round(8 * size), 200);
  ctx.effects.sparks(x, y, GLITCH_B, Math.round(6 * size), 170);
  if (size >= 1) ctx.effects.ring(x, y, GLITCH_A, 34, 0.25);
}

// ------------------------------------------------------------ clone holographique

/**
 * Clone holographique : court tout droit pendant 1 s puis disparaît. L'adversaire le voit
 * exactement comme Flux (même dessin, même barre de vie, même nom) ; ses bots le prennent
 * pour cible. Un seul tir le fait éclater (sans compter comme une élimination). Flux et
 * ses alliés le voient translucide, qui grésille.
 */
export class HoloClone implements Decoy {
  readonly decoy = true;
  readonly team: Team;
  readonly radius: number;
  alive = true;
  visible = true;
  pinned = false;
  buffs: BuffKind[] = [];
  auraSpeedMul = 1;
  stunTimer = 0;
  private life = PHANTOM.cloneLife;
  private kvx = 0;
  private kvy = 0;
  private time = 0;

  constructor(
    private readonly owner: Flux,
    public x: number,
    public y: number,
    private readonly dir: number,
  ) {
    this.team = owner.team;
    this.radius = owner.radius;
  }

  /** Il affiche les PV du vrai Flux (l'adversaire ne doit pas pouvoir les distinguer). */
  get hp(): number {
    return this.owner.hp;
  }
  get maxHp(): number {
    return this.owner.maxHp;
  }

  circle(): Circle {
    return { x: this.x, y: this.y, r: this.radius };
  }

  /**
   * Touché : l'hologramme est immortel (il continue sa course), mais les dégâts « comptent »
   * (chiffre affiché, marqueur de touche) pour ne pas le trahir.
   */
  takeDamage(amount: number): number {
    if (!this.alive) return 0;
    return Math.min(amount, this.owner.hp);
  }
  heal(): void {}
  stun(): void {}
  applyImpulse(ix: number, iy: number): void {
    this.kvx += ix;
    this.kvy += iy;
  }

  /** Disparition (fin de course, tir, mort de Flux) ; `burst` : éclat de glitch. */
  vanish(ctx: GameContext, burst = true): void {
    if (!this.alive) return;
    this.alive = false;
    if (burst) glitchBurst(ctx, this.x, this.y, 0.8);
  }

  update(dt: number, ctx: GameContext): boolean {
    if (!this.alive) return false;
    if (this.owner.dead) {
      this.vanish(ctx);
      return false;
    }
    this.time += dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.vanish(ctx);
      return false;
    }
    // Course tout droit (il glisse le long des murs), plus un éventuel recul.
    this.x += (Math.cos(this.dir) * CLONE_SPEED + this.kvx) * dt;
    this.y += (Math.sin(this.dir) * CLONE_SPEED + this.kvy) * dt;
    const decay = Math.exp(-6 * dt);
    this.kvx *= decay;
    this.kvy *= decay;
    ctx.arena.resolveCircle(this, this.radius, this.team);
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, viewer: Hero | null): void {
    if (!this.alive) return;
    const ally = viewer !== null && !hostile(this, viewer);
    if (!ally) {
      // Vu par l'adversaire : impossible à distinguer du vrai Flux.
      this.owner.drawFigure(ctx, this.x, this.y, this.dir);
      return;
    }
    ctx.save();
    ctx.globalAlpha = 0.45;
    this.owner.drawFigure(ctx, this.x, this.y, this.dir);
    ctx.restore();
    drawGlitch(ctx, this.x, this.y, this.radius, this.time + 0.37, 1);
  }

  /** Barre de vie (et nom) comme un vrai héros, seulement pour l'adversaire. */
  drawOverlay(ctx: CanvasRenderingContext2D, viewer: Hero | null): void {
    if (!this.alive || (viewer !== null && !hostile(this, viewer))) return;
    const barBottom = this.y - this.radius * 1.4 - 4;
    const color = this.owner.outline === COLORS.ally ? COLORS.hpAlly : COLORS.hpEnemy;
    drawHealthBar(ctx, this.x, barBottom, this.hp, this.maxHp, color, 60);
    if (this.owner.label) {
      ctx.fillStyle = this.owner.outline;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.owner.label, this.x, barBottom - 13);
    }
  }
}
