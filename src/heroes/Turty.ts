import type { GameContext } from '../core/GameContext';
import { circlesOverlap, distToCircle } from '../core/geometry';
import { clamp, degToRad, randRange, rotateTowards, TAU } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import { Projectile } from '../entities/Projectile';
import type { Team } from '../entities/Team';
import type { WorldObject } from '../entities/WorldObject';
import { WET, type WetGround } from '../game/WetGround';
import { t } from '../i18n';
import { cached, drawTeamMarker, hand, head, inked, LINE, turtyHair, turtyShell, waterGun } from '../render/topdown';
import { lineOfSight } from '../world/Visibility';
import { WEAPON as FLUX_WEAPON } from './Flux';
import { Hero, MOVE_SPEED_SCALE, type AbilitySlot, type WeaponHud } from './Hero';
import { Magazine } from './Magazine';
import { SKATE_AURA } from './Skater';

/** Rayon de la boule (= hitbox) et peau verte (d'après son croquis). */
const R = 15;
const SKIN = '#69c7a1';
/** Forme tortue / carapace : rayon de la carapace (unités monde). */
const SHELL_R = 16;

const WATER_COLOR = '#5fd6ea';
const FOAM_COLOR = '#d8fbff';

export const TURTY = {
  /** Forme humaine : entre Rempart (220) et le Skater (365). */
  speed: 295,
  /** Forme tortue : moitié moins vite sur le sec, 1,8 fois plus vite sur l'eau. */
  turtleDry: 0.5,
  turtleWet: 1.8,
  /** Après le passage en tortue : aucune compétence pendant ce temps. */
  formLock: 0.5,
  /** Durée de l'animation de transformation. */
  morphTime: 0.22,
};

/**
 * Clic G : pistolet à eau, sur le modèle du lanceur de base de Splatoon : un tir
 * rapide et peu précis (dispersion plus forte en marchant, comme en saut là-bas) qui
 * sème des gouttes au sol tout le long de sa course. Chaque goutte part dans un cône
 * large et ses taches grossissent avec la distance : en rafale, l'eau forme un V
 * ouvert devant Turty.
 * Les gouttes touchent aussi loin que le pistolet de Flux, mais ne mouillent le sol
 * que jusqu'à 2 × le rayon de l'aura du Skater.
 */
export const WATER_GUN = {
  magSize: 90,
  fireRate: 9, // gouttes/s
  damage: 20,
  speed: 900,
  range: FLUX_WEAPON.range, // 720
  radius: 5,
  /** Dispersion (cône total, degrés) : à l'arrêt / en mouvement. */
  spreadDeg: 24,
  moveSpreadDeg: 30,
  reloadTime: 1.6,
  /** Distance (depuis Turty) jusqu'à laquelle les gouttes mouillent le sol. */
  paintRange: SKATE_AURA.radius * 2, // 340
  /**
   * Traînée : une tache tous les `trailStep` px, de rayon tiré dans `trailRadius`,
   * décalée au hasard sur le côté (± `trailJitter`) : une bande irrégulière, pas un trait.
   * Près de Turty, taches, décalage et éclaboussures sont réduits à `nearScale` et
   * grandissent jusqu'à la taille pleine à `paintRange` : la pointe du V est fine.
   */
  nearScale: 0.4,
  trailRadius: [20, 28] as const,
  trailStep: 24,
  trailJitter: 9,
  /** Éclaboussures projetées sur les côtés de la traînée (chance par tache, écart, rayon). */
  sprayChance: 0.55,
  sprayOffset: [16, 30] as const,
  sprayRadius: [9, 14] as const,
  /** Grosse tache à l'endroit où la goutte tombe. */
  splashRadius: 46,
};

/** Espace : carapace lancée qui ricoche sur les murs (2 rebonds max), façon Charge de Rempart. */
export const SHELL = {
  cooldown: 12,
  /** Préparation : la carapace tourne sur place, on peut encore viser. */
  windup: 0.55,
  windupTurnRate: 4,
  speed: 780 * MOVE_SPEED_SCALE, // ralentie comme la marche (546)
  maxBounces: 2,
  maxDuration: 1.5,
  damage: 75,
  /** Ennemis touchés : éjectés sur le côté. */
  knockback: 360,
};

/**
 * Maj : bombe à eau lancée en l'air jusqu'au point visé (passe au-dessus de tout).
 * Une zone d'ombre montre l'impact pendant tout le vol. Dégâts 120 au centre → 60 au bord.
 */
export const BOMB = {
  cooldown: 8,
  /** Portée du lancer : plus loin que ce que le pistolet peut mouiller. */
  range: 560,
  flightBase: 0.45,
  flightPerPx: 0.0008,
  arcHeight: 120, // hauteur de la cloche : vue de dessus, la bombe grossit en montant
  /** Posée au sol, elle s'amorce un court instant avant d'exploser. */
  prime: 0.32,
  blastTime: 0.5,
  radius: 115,
  maxDamage: 120,
  minDamage: 60,
  knockback: 240,
  /** Flaque laissée par l'explosion. */
  wetRadius: 135,
};

type Form = 'human' | 'turtle';

interface ShellState {
  windup: number;
  t: number;
  dir: number;
  vx: number;
  vy: number;
  bounces: number;
  /** Ennemis déjà touchés depuis le dernier rebond. */
  hit: Set<Combatant>;
  spin: number;
  trailTimer: number;
}

/**
 * Turty — dégâts, pistolet à eau. Deux formes, comme un calamar d'encre :
 * humaine pour se battre, tortue pour filer sur l'eau qu'elle a répandue.
 * Clic G : pistolet à eau · Clic D : forme tortue / humaine · Espace : carapace qui ricoche · Maj : bombe à eau.
 */
export class Turty extends Hero {
  form: Form = 'human';
  private readonly mag = new Magazine(WATER_GUN.magSize, WATER_GUN.reloadTime);
  private fireTimer = 0;
  private recoil = 0;
  private formLock = 0;
  private morph = 0;
  private morphFrom: Form = 'human';
  private shellCooldown = 0;
  private shell: ShellState | null = null;
  private bombCooldown = 0;
  private throwAnim = 0;
  /** Sur l'eau en ce moment (mis à jour chaque frame). */
  onWet = false;
  private walkAnim = 0;
  private dripTimer = 0;
  /** Sol mouillé et temps de jeu, gardés pour l'IA (wetAt). */
  private wetRef: WetGround | null = null;
  private now = 0;
  private bombAimPreview: { x: number; y: number } | null = null;

  constructor() {
    super({
      name: 'Turty',
      maxHp: 200,
      radius: R,
      speed: TURTY.speed,
      acceleration: 14,
      color: '#4fd1a5',
    });
  }

  override get spreadDeg(): number {
    if (this.form !== 'human') return 0;
    return Math.hypot(this.vx, this.vy) > 40 ? WATER_GUN.moveSpreadDeg : WATER_GUN.spreadDeg;
  }

  // ---- état lu par l'IA ----
  get ammo(): number {
    return this.mag.ammo;
  }
  get reloading(): boolean {
    return this.mag.reloading;
  }
  get shellReady(): boolean {
    return this.shellCooldown <= 0 && this.shell === null && this.formLock <= 0;
  }
  get bombReady(): boolean {
    return this.bombCooldown <= 0 && this.formLock <= 0;
  }
  get isShelling(): boolean {
    return this.shell !== null;
  }
  /** Le sol est-il mouillé à cet endroit ? */
  wetAt(x: number, y: number): boolean {
    return this.wetRef?.isWet(x, y, this.now) ?? false;
  }

  override hasQuickMelee(): boolean {
    return this.form === 'human';
  }

  // ------------------------------------------------------------ boucle

  protected override tick(dt: number, ctx: GameContext): void {
    this.wetRef = ctx.wet;
    this.now = ctx.time;
    this.mag.update(dt);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.recoil = Math.max(0, this.recoil - dt);
    this.formLock = Math.max(0, this.formLock - dt);
    this.morph = Math.max(0, this.morph - dt);
    this.shellCooldown = Math.max(0, this.shellCooldown - dt);
    this.bombCooldown = Math.max(0, this.bombCooldown - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    this.onWet = ctx.wet.isWet(this.x, this.y, ctx.time);
    if (this.pinned) this.shell = null;

    const speed = Math.hypot(this.vx, this.vy);
    this.walkAnim = speed > 30 ? this.walkAnim + dt * (speed / (TURTY.speed * MOVE_SPEED_SCALE)) : 0;

    // Tortue sur l'eau : gerbes d'eau derrière elle.
    if (this.form === 'turtle' && this.onWet && speed > 150 && !this.shell) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.05;
        ctx.effects.sparks(this.x - (this.vx / speed) * 10, this.y, WATER_COLOR, 2, 90);
      }
    }
    this.bombAimPreview = this.isLocalPlayer && this.form === 'human' && this.bombReady ? this.bombTarget(ctx) : null;
  }

  /** Turty elle-même : sur n'importe quelle eau (pas seulement celle de son équipe). */
  protected override passiveRegenDelay(ctx: GameContext): number {
    return this.onWet ? WET.regenDelay : super.passiveRegenDelay(ctx);
  }

  protected override speedMultiplier(): number {
    if (this.form === 'human') return 1;
    return this.onWet ? TURTY.turtleWet : TURTY.turtleDry;
  }

  protected override isLocked(): boolean {
    return this.shell !== null;
  }

  protected override onStunned(): void {
    if (this.shell) this.form = 'human';
    this.shell = null;
  }

  protected handleInput(_dt: number, ctx: GameContext): void {
    const c = this.controls;
    if (c.pressed('reload') && !c.held('primary')) this.mag.startReload();

    // Clic D maintenu : forme tortue ; relâché : forme humaine.
    // Clic G pendant qu'elle est en tortue : elle se relève et tire aussitôt.
    this.setForm(c.held('secondary') && !c.held('primary') ? 'turtle' : 'human', ctx);

    if (c.held('primary') && !this.isMeleeing) {
      while (this.fireTimer <= 0 && this.mag.consume()) {
        this.fire(ctx);
        this.fireTimer += 1 / WATER_GUN.fireRate;
      }
    }
    if (this.mag.ammo === 0) this.mag.startReload();

    if (this.formLock > 0) return; // juste après le passage en tortue : pas de compétence
    if (c.pressed('ability1') && this.shellCooldown <= 0) this.startShell(ctx);
    else if (c.pressed('ability2') && this.bombCooldown <= 0) this.throwBomb(ctx);
  }

  protected override onRespawn(): void {
    this.form = 'human';
    this.mag.refill();
    this.fireTimer = 0;
    this.formLock = 0;
    this.morph = 0;
    this.shell = null;
    this.shellCooldown = 0;
    this.bombCooldown = 0;
    this.throwAnim = 0;
  }

  private setForm(form: Form, ctx: GameContext): void {
    if (form === this.form) return;
    this.morphFrom = this.form;
    this.form = form;
    this.morph = TURTY.morphTime;
    if (form === 'turtle') this.formLock = TURTY.formLock;
    // Petite gerbe d'eau à la transformation
    ctx.effects.ring(this.x, this.y, WATER_COLOR, 34, 0.25);
    ctx.effects.sparks(this.x, this.y, WATER_COLOR, 8, 140);
    ctx.effects.sparks(this.x, this.y, FOAM_COLOR, 4, 100);
  }

  // ------------------------------------------------------------ pistolet à eau

  private muzzle(): { x: number; y: number } {
    const fx = Math.cos(this.aim);
    const fy = Math.sin(this.aim);
    // Bout du canon du pistolet à eau (tenu à droite, devant elle).
    return { x: this.x + fx * R * 2.3 - fy * R * 0.35, y: this.y + fy * R * 2.3 + fx * R * 0.35 };
  }

  private fire(ctx: GameContext): void {
    this.recoil = 0.09;
    const m = this.muzzle();
    if (ctx.arena.pointInWall(m.x, m.y)) {
      ctx.effects.sparks(m.x, m.y, WATER_COLOR, 4, 120);
      return;
    }
    const G = WATER_GUN;
    const half = degToRad(this.spreadDeg) / 2;
    const angle = this.aim + randRange(-half, half);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Le sol est mouillé depuis Turty : on compte la distance depuis elle, pas depuis le canon.
    const offset = Math.hypot(m.x - this.x, m.y - this.y);
    const sx = m.x;
    const sy = m.y;
    // Première tache un peu devant le canon, puis une tous les trailStep px (pas réguliers).
    let painted = randRange(0, G.trailStep * 0.5);
    const paintTo = (d: number) => {
      const until = Math.min(d, G.paintRange - offset);
      while (painted <= until) {
        // Taille selon la distance à Turty : fine près d'elle, pleine au bout (forme en V).
        const k = G.nearScale + (1 - G.nearScale) * clamp((painted + offset) / G.paintRange, 0, 1);
        // Tache de la traînée, décalée sur le côté…
        const side = randRange(-G.trailJitter, G.trailJitter) * k;
        const px = sx + dx * painted - dy * side;
        const py = sy + dy * painted + dx * side;
        ctx.wet.splash(px, py, randRange(G.trailRadius[0], G.trailRadius[1]) * k, ctx.time, this.team);
        // …et parfois une éclaboussure projetée plus loin sur le côté.
        if (Math.random() < G.sprayChance) {
          const s = (Math.random() < 0.5 ? -1 : 1) * randRange(G.sprayOffset[0], G.sprayOffset[1]) * k;
          const qx = sx + dx * painted - dy * s;
          const qy = sy + dy * painted + dx * s;
          if (!ctx.arena.pointInWall(qx, qy)) ctx.wet.splash(qx, qy, randRange(G.sprayRadius[0], G.sprayRadius[1]) * k, ctx.time, this.team);
        }
        painted += G.trailStep * randRange(0.8, 1.2);
      }
    };
    ctx.spawnProjectile(
      new Projectile({
        x: sx,
        y: sy,
        angle,
        speed: WATER_GUN.speed,
        damage: WATER_GUN.damage,
        team: this.team,
        owner: this,
        range: WATER_GUN.range,
        radius: WATER_GUN.radius,
        style: 'water',
        onUpdate: (p) => paintTo(p.traveled),
        onEnd: (p) => {
          // Un peu en arrière : la goutte s'écrase devant le mur, pas dedans.
          const ex = p.x - dx * 6;
          const ey = p.y - dy * 6;
          if (p.traveled + offset <= WATER_GUN.paintRange + WATER_GUN.splashRadius) {
            ctx.wet.splash(ex, ey, WATER_GUN.splashRadius * (p.traveled + offset <= WATER_GUN.paintRange ? 1 : 0.6), ctx.time, this.team);
          }
          ctx.effects.sparks(ex, ey, WATER_COLOR, 6, 150);
          ctx.effects.sparks(ex, ey, FOAM_COLOR, 3, 110);
        },
      }),
    );
    ctx.effects.sparks(m.x, m.y, FOAM_COLOR, 2, 90);
  }

  // ------------------------------------------------------------ bombe à eau

  /** Point d'impact : le curseur, ramené à la portée max (et hors des murs). */
  private bombTarget(ctx: GameContext): { x: number; y: number } {
    const c = this.controls;
    let dx = c.aimX - this.x;
    let dy = c.aimY - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const dist = Math.min(d, BOMB.range);
    dx /= d;
    dy /= d;
    // Recule jusqu'au premier point libre si le curseur est dans un mur.
    for (let k = dist; k > 0; k -= 8) {
      const x = this.x + dx * k;
      const y = this.y + dy * k;
      if (!ctx.arena.pointInWall(x, y)) return { x, y };
    }
    return { x: this.x, y: this.y };
  }

  private throwBomb(ctx: GameContext): void {
    if (this.form === 'turtle') this.setForm('human', ctx);
    this.bombCooldown = BOMB.cooldown;
    this.throwAnim = 0.25;
    const to = this.bombTarget(ctx);
    ctx.spawnObject(new WaterBomb(this, this.x, this.y, to.x, to.y));
  }

  // ------------------------------------------------------------ carapace

  private startShell(ctx: GameContext): void {
    if (this.form === 'human') {
      this.morphFrom = 'human';
      this.morph = TURTY.morphTime;
    }
    this.form = 'turtle';
    this.shell = {
      windup: SHELL.windup,
      t: 0,
      dir: this.aim,
      vx: 0,
      vy: 0,
      bounces: 0,
      hit: new Set(),
      spin: 0,
      trailTimer: 0,
    };
    this.vx = this.vy = 0;
    ctx.effects.ring(this.x, this.y, FOAM_COLOR, 40, 0.3);
  }

  get shellWindupProgress(): number {
    const s = this.shell;
    return s && s.windup > 0 ? 1 - s.windup / SHELL.windup : 1;
  }

  protected override updateLocked(dt: number, ctx: GameContext): void {
    const s = this.shell;
    if (!s) return;
    // Préparation : la carapace tourne sur place de plus en plus vite ; on oriente le lancer.
    if (s.windup > 0) {
      s.windup -= dt;
      s.dir = rotateTowards(s.dir, this.aim, SHELL.windupTurnRate * dt);
      s.spin += dt * (6 + 30 * this.shellWindupProgress);
      this.vx = this.vy = 0;
      if (s.windup <= 0) {
        s.vx = Math.cos(s.dir) * SHELL.speed;
        s.vy = Math.sin(s.dir) * SHELL.speed;
        ctx.effects.ring(this.x, this.y, '#ffffff', 50, 0.25);
        ctx.effects.sparks(this.x, this.y, '#cfd8e3', 10, 220);
        ctx.shake(3, this);
      }
      return;
    }

    s.t += dt;
    s.spin += dt * 36;
    const dist = SHELL.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 5));
    const h = dt / steps;
    // Collisions avec le hitbox du héros : murs, portes de spawn et bords de lave font rebondir.
    const blocked = (x: number, y: number) => ctx.arena.circleCollides(x, y, this.radius - 0.5, this.team);
    for (let i = 0; i < steps; i++) {
      let bounced = false;
      const nx = this.x + s.vx * h;
      if (blocked(nx, this.y)) {
        s.vx = -s.vx;
        bounced = true;
      } else this.x = nx;
      const ny = this.y + s.vy * h;
      if (blocked(this.x, ny)) {
        s.vy = -s.vy;
        bounced = true;
      } else this.y = ny;
      if (bounced) {
        s.bounces++;
        ctx.effects.sparks(this.x, this.y, '#e8eef5', 10, 240);
        ctx.effects.ring(this.x, this.y, '#ffffff', 36, 0.2);
        ctx.shake(3, this);
        if (s.bounces > SHELL.maxBounces) {
          this.endShell(ctx);
          return;
        }
        s.hit.clear(); // après un rebond, la carapace peut toucher à nouveau
      }
      this.hitWithShell(ctx);
    }
    this.vx = s.vx;
    this.vy = s.vy;
    s.trailTimer -= dt;
    if (s.trailTimer <= 0) {
      s.trailTimer = 0.035;
      ctx.effects.afterimage(this.x, this.y, 14, '#7fe3c4', 0.22);
      if (this.onWet) ctx.effects.sparks(this.x, this.y, WATER_COLOR, 3, 140);
    }
    if (s.t >= SHELL.maxDuration) this.endShell(ctx);
  }

  private hitWithShell(ctx: GameContext): void {
    const s = this.shell!;
    const speed = Math.hypot(s.vx, s.vy) || 1;
    const dx = s.vx / speed;
    const dy = s.vy / speed;
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c) || s.hit.has(c)) continue;
      if (!circlesOverlap(this.circle(), c.circle(), 4)) continue;
      s.hit.add(c);
      ctx.damage(c, SHELL.damage, this);
      // Éjecté sur le côté (gauche ou droite selon sa position) : la carapace continue.
      const ox = c.x - this.x;
      const oy = c.y - this.y;
      const side = dx * oy - dy * ox >= 0 ? 1 : -1;
      c.applyImpulse((-dy * side + dx * 0.4) * SHELL.knockback, (dx * side + dy * 0.4) * SHELL.knockback, this);
      ctx.effects.sparks(c.x, c.y, '#ffffff', 12, 260);
      ctx.effects.ring(c.x, c.y, '#7fe3c4', 40, 0.25);
      ctx.shake(5, this);
    }
  }

  private endShell(ctx: GameContext): void {
    const s = this.shell;
    if (!s) return;
    this.shell = null;
    this.shellCooldown = SHELL.cooldown;
    this.vx = s.vx * 0.15;
    this.vy = s.vy * 0.15;
    ctx.arena.resolveCircle(this, this.radius, this.team);
    // Clic D toujours maintenu : elle reste en tortue, sinon elle se relève.
    if (!this.controls.held('secondary')) {
      this.morphFrom = 'turtle';
      this.form = 'human';
      this.morph = TURTY.morphTime;
    }
    ctx.effects.sparks(this.x, this.y, FOAM_COLOR, 6, 120);
  }

  // ------------------------------------------------------------ HUD

  abilitySlots(): AbilitySlot[] {
    const lock = this.formLock;
    return [
      {
        input: 'secondary',
        name: t('turty.form'),
        icon: 'turtle',
        active: this.form === 'turtle',
        label: t(this.form === 'turtle' ? (this.onWet ? 'turty.form.wet' : 'turty.form.dry') : 'turty.form.human'),
      },
      {
        input: 'ability1',
        name: t('turty.shell'),
        icon: 'shell',
        cooldown: this.shell ? 0 : Math.max(this.shellCooldown, lock),
        cooldownMax: this.shellCooldown > lock ? SHELL.cooldown : TURTY.formLock,
        active: this.shell !== null,
      },
      {
        input: 'ability2',
        name: t('turty.bomb'),
        icon: 'bomb',
        cooldown: Math.max(this.bombCooldown, lock),
        cooldownMax: this.bombCooldown > lock ? BOMB.cooldown : TURTY.formLock,
      },
    ];
  }

  weaponHud(): WeaponHud {
    return {
      name: t('turty.weapon'),
      ammo: this.mag.ammo,
      magSize: WATER_GUN.magSize,
      reloadProgress: this.mag.reloading ? this.mag.progress : undefined,
    };
  }

  // ------------------------------------------------------------ rendu

  override drawUnder(ctx: CanvasRenderingContext2D): void {
    const s = this.shell;
    if (this.dead || !s || s.windup <= 0) return;
    // Préparation de la carapace : couloir de lancer « télégraphié » au sol.
    const p = this.shellWindupProgress;
    const len = 320;
    const w = 16;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(s.dir);
    ctx.globalAlpha = 0.1 + 0.15 * p;
    ctx.fillStyle = '#7fe3c4';
    ctx.fillRect(0, -w, len, w * 2);
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, -w, len * p, w * 2);
    ctx.globalAlpha = 0.5 + 0.4 * p;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    for (let i = 1; i <= 4; i++) {
      const cx = i * (len / 5);
      ctx.beginPath();
      ctx.moveTo(cx - 8, -w * 0.5);
      ctx.lineTo(cx + 5, 0);
      ctx.lineTo(cx - 8, w * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Repère local de la forme humaine (draw() choisit la forme). */
  protected drawTop(ctx: CanvasRenderingContext2D): void {
    this.drawHuman(ctx, false);
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    const moving = Math.hypot(this.vx, this.vy) > 40;
    drawTeamMarker(ctx, this.x, this.y, this.form === 'human' && !this.shell ? R : SHELL_R, this.outline);
    const flash = this.hurtTimer > 0.2;

    const s = this.shell;
    if (s) {
      // Dans la carapace : elle tourne sur elle-même (le motif tourne).
      this.inFrame(ctx, s.dir, 1, () => {
        ctx.rotate(s.spin);
        cached(ctx, 'turty.shell', SHELL_R * 1.05, (c) => turtyShell(c, SHELL_R));
      }, flash ? SHELL_R : 0);
      return;
    }
    // Transformation : l'ancienne forme rétrécit, la nouvelle grandit, dans une gerbe d'eau.
    if (this.morph > 0) {
      const u = 1 - this.morph / TURTY.morphTime; // 0 → 1
      const k = u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2;
      this.drawForm(ctx, u < 0.5 ? this.morphFrom : this.form, 0.25 + 0.75 * k, moving, false);
      ctx.fillStyle = 'rgba(216,251,255,0.75)';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + u * 3;
        ctx.beginPath();
        ctx.arc(this.x + Math.cos(a) * 20 * u, this.y + Math.sin(a) * 20 * u, 2.6 * (1 - u * 0.5), 0, TAU);
        ctx.fill();
      }
      return;
    }
    this.drawForm(ctx, this.form, 1, moving, flash);
  }

  /** Dessine `draw` dans un repère tourné vers `angle` et mis à l'échelle (flash : disque blanc). */
  private inFrame(ctx: CanvasRenderingContext2D, angle: number, scale: number, draw: () => void, flashR = 0): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw();
    if (flashR > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, flashR, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawForm(ctx: CanvasRenderingContext2D, form: Form, scale: number, moving: boolean, flash: boolean): void {
    if (form === 'turtle') {
      const dir = moving ? Math.atan2(this.vy, this.vx) : this.aim;
      this.inFrame(ctx, dir, scale, () => this.drawTurtle(ctx, moving), flash ? SHELL_R : 0);
      return;
    }
    // Forme humaine : elle grossit un peu pendant le saut du lancer de bombe (vue de dessus).
    const hop = this.throwAnim > 0 ? Math.sin((1 - this.throwAnim / 0.25) * Math.PI) * 0.12 : 0;
    this.inFrame(ctx, this.aim, scale * (1 + hop), () => this.drawHuman(ctx, moving), flash ? R : 0);
  }

  /**
   * Forme humaine (repère local, regard vers +x) : carapace sur le dos, pistolet à eau tenu
   * à deux mains, qui recule à chaque tir (jet d'eau au bout du canon) ; lancer de bombe :
   * une main tendue en avant.
   */
  private drawHuman(ctx: CanvasRenderingContext2D, moving: boolean): void {
    const rot = this.aim;
    const hr = R * 0.3;
    // Carapace sur le dos (dépasse derrière la chevelure)
    ctx.save();
    ctx.translate(-R * 1.0, 0);
    cached(ctx, 'turty.backShell', R * 0.82, (c) => turtyShell(c, R * 0.78));
    ctx.restore();
    if (this.meleeAnim > 0) {
      cached(ctx, 'turty.head', R * 2.3, (c) => {
        head(c, R, SKIN);
        turtyHair(c, R);
      });
      this.idleHands(ctx, R, SKIN, rot);
      return;
    }
    const kick = this.recoil > 0 ? this.recoil / 0.09 : 0;
    const throwing = this.throwAnim > 0 ? Math.sin((1 - this.throwAnim / 0.25) * Math.PI) : 0;
    const sway = moving ? Math.sin(this.walkAnim * 10) * R * 0.08 : 0;
    ctx.save();
    ctx.translate(R * (0.95 - kick * 0.2) + sway, R * 0.35);
    cached(ctx, 'turty.gun', R * 1.85, (c) => waterGun(c, R * 1.7));
    if (kick > 0.3) {
      ctx.fillStyle = 'rgba(95,214,234,0.9)';
      for (const [x, y, r] of [[R * 2.0, 0, 3.5], [R * 2.25, -3, 2.5], [R * 2.3, 3, 2]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    cached(ctx, 'turty.head', R * 2.3, (c) => {
      head(c, R, SKIN);
      turtyHair(c, R);
    });
    hand(ctx, R * (0.95 - kick * 0.2) + sway, R * 0.35, hr, SKIN, rot);
    if (throwing > 0) hand(ctx, R * (0.7 + throwing * 0.9), -R * (0.75 - throwing * 0.3), hr, SKIN, rot);
    else hand(ctx, R * (1.75 - kick * 0.2) + sway, R * 0.35, hr, SKIN, rot);
  }

  /**
   * Forme tortue (repère local, vers +x) : carapace ronde, tête et quatre pattes qui
   * trottinent ; sur l'eau, elle file en laissant des gerbes d'eau derrière elle.
   */
  private drawTurtle(ctx: CanvasRenderingContext2D, moving: boolean): void {
    const S = SHELL_R;
    const fast = this.onWet && moving;
    const step = moving ? this.walkAnim * (fast ? 16 : 9) : 0;
    if (fast) {
      ctx.fillStyle = 'rgba(216,251,255,0.85)';
      for (let i = 0; i < 5; i++) {
        const k = (step * 0.4 + i * 0.2) % 1;
        const side = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.arc(-S * (1.05 + k * 0.9), side * S * (0.35 + k * 0.4), 2.6 * (1 - k), 0, TAU);
        ctx.fill();
      }
    }
    for (const [f, sd] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const swing = Math.sin(step + (f * sd > 0 ? 0 : Math.PI)) * S * 0.15;
      inked(ctx, SKIN, () => ctx.ellipse(f * S * 0.7 + swing, sd * S * 0.82, S * 0.3, S * 0.2, sd * f * 0.4, 0, TAU), 1.6);
    }
    inked(ctx, SKIN, () => ctx.arc(S * 1.12, 0, S * 0.4, 0, TAU), 1.8);
    // Grands yeux sur le dessus de la tête (comme sur le croquis)
    for (const sd of [-1, 1]) {
      inked(ctx, '#ffffff', () => ctx.arc(S * 1.22, sd * S * 0.2, S * 0.13, 0, TAU), 1.2);
      ctx.fillStyle = LINE;
      ctx.beginPath();
      ctx.arc(S * 1.27, sd * S * 0.2, S * 0.07, 0, TAU);
      ctx.fill();
    }
    cached(ctx, 'turty.shell', S * 1.05, (c) => turtyShell(c, S));
  }

  override drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.dead) return;
    // Aperçu du point d'impact de la bombe (joueur seulement)
    const p = this.bombAimPreview;
    if (p) {
      ctx.save();
      ctx.strokeStyle = WATER_COLOR;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, BOMB.radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
}


/**
 * Bombe à eau : vole en cloche jusqu'au point visé (au-dessus des murs et des joueurs),
 * s'écrase, s'amorce un instant, puis explose. Une zone d'ombre au sol montre
 * l'impact pendant tout le vol. L'explosion mouille le sol.
 */
class WaterBomb implements WorldObject {
  readonly team: Team;
  private phase: 'air' | 'prime' | 'blast' = 'air';
  private t = 0;
  private readonly flight: number;
  private readonly dir: number;
  private readonly height: number;

  constructor(
    private readonly owner: Turty,
    private readonly fromX: number,
    private readonly fromY: number,
    readonly x: number,
    readonly y: number,
  ) {
    this.team = owner.team;
    const d = Math.hypot(x - fromX, y - fromY);
    this.flight = BOMB.flightBase + d * BOMB.flightPerPx;
    this.dir = Math.atan2(y - fromY, x - fromX);
    this.height = BOMB.arcHeight * clamp(0.4 + d / BOMB.range, 0.4, 1);
  }

  update(dt: number, ctx: GameContext): boolean {
    this.t += dt;
    if (this.phase === 'air' && this.t >= this.flight) {
      this.phase = 'prime';
      this.t = 0;
      ctx.wet.splash(this.x, this.y, 30, ctx.time, this.team);
      ctx.effects.sparks(this.x, this.y, WATER_COLOR, 8, 140);
    } else if (this.phase === 'prime' && this.t >= BOMB.prime) {
      this.phase = 'blast';
      this.t = 0;
      this.explode(ctx);
    } else if (this.phase === 'blast' && this.t >= BOMB.blastTime) {
      return false;
    }
    return true;
  }

  private explode(ctx: GameContext): void {
    for (const c of ctx.targets) {
      if (!c.alive || !hostile(this, c)) continue;
      const d = distToCircle(this.x, this.y, c.circle());
      if (d > BOMB.radius) continue;
      if (!lineOfSight(ctx.arena, this.x, this.y, c.x, c.y)) continue;
      const k = d / BOMB.radius; // 0 au centre → 1 au bord
      ctx.damage(c, BOMB.maxDamage - (BOMB.maxDamage - BOMB.minDamage) * k, this.owner);
      const ax = c.x - this.x;
      const ay = c.y - this.y;
      const n = Math.hypot(ax, ay) || 1;
      c.applyImpulse((ax / n) * BOMB.knockback * (1 - k * 0.5), (ay / n) * BOMB.knockback * (1 - k * 0.5), this.owner);
    }
    ctx.wet.splash(this.x, this.y, BOMB.wetRadius, ctx.time, this.team);
    ctx.effects.ring(this.x, this.y, WATER_COLOR, BOMB.radius, 0.35);
    ctx.effects.sparks(this.x, this.y, WATER_COLOR, 26, 360);
    ctx.effects.sparks(this.x, this.y, FOAM_COLOR, 14, 260);
    ctx.effects.sparks(this.x, this.y, '#e8893a', 8, 240); // éclats de la carapace orange
    ctx.shake(7, this);
  }

  drawUnder(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'blast') return;
    // Zone d'ombre : où la bombe va tomber, visible par tous pendant tout le vol.
    const u = this.phase === 'air' ? this.t / this.flight : 1;
    ctx.save();
    ctx.fillStyle = 'rgba(0,6,12,0.34)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, BOMB.radius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,6,12,0.3)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, BOMB.radius * u, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.owner.outline;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, BOMB.radius, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // Ombre de la bombe elle-même (sous sa position en vol)
    if (this.phase === 'air') {
      const bx = this.fromX + (this.x - this.fromX) * u;
      const by = this.fromY + (this.y - this.fromY) * u;
      const z = Math.sin(Math.PI * u);
      ctx.fillStyle = `rgba(0,0,0,${0.35 - z * 0.15})`;
      ctx.beginPath();
      ctx.arc(bx + z * 6, by + z * 9, 9 * (1 - z * 0.35), 0, TAU);
      ctx.fill();
    }
  }

  /**
   * En vol : au-dessus de tout, murs compris (elle est lancée en l'air). Vue de dessus, elle
   * grossit en montant et se dandine dans les airs.
   */
  drawSky(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'air') return;
    const u = this.t / this.flight;
    const bx = this.fromX + (this.x - this.fromX) * u;
    const by = this.fromY + (this.y - this.fromY) * u;
    const s = 1 + (Math.sin(Math.PI * u) * this.height) / 220; // plus haut = plus gros
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.dir + Math.sin(u * TAU * 2) * 0.25);
    ctx.scale(s, s);
    cached(ctx, 'turty.balloon', 13, drawWaterBalloon);
    ctx.restore();
  }

  drawOver(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'air') return;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.phase === 'prime') {
      // Posée au sol : elle tremble et gonfle avant d'éclater.
      const k = this.t / BOMB.prime;
      const wob = Math.sin(this.t * 40) * 0.12 * k;
      ctx.rotate(this.dir);
      ctx.scale(1 + k * 0.25 + wob, 1 + k * 0.25 - wob);
      cached(ctx, 'turty.balloon', 13, drawWaterBalloon);
    } else {
      // Éclaboussure : une couronne de gouttes qui part dans tous les sens, et la flaque qui s'étale.
      const k = Math.min(1, this.t / BOMB.blastTime);
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.fillStyle = 'rgba(95,214,234,0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, BOMB.radius * (0.35 + 0.55 * k), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = FOAM_COLOR;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + (i % 2) * 0.2;
        const d = BOMB.radius * (0.3 + k * (0.75 + (i % 3) * 0.12));
        inked(ctx, i % 2 ? WATER_COLOR : FOAM_COLOR, () => ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 5 * (1 - k) + 1.5, 0, TAU), 1.2);
      }
    }
    ctx.restore();
  }
}

/** Bombe à eau vue de dessus (nœud vers -x) : ballon bleu translucide, reflet, nœud orange. */
function drawWaterBalloon(ctx: CanvasRenderingContext2D): void {
  inked(ctx, '#f07a28', () => {
    ctx.moveTo(-8, 0);
    ctx.lineTo(-12.5, -3);
    ctx.lineTo(-12.5, 3);
    ctx.closePath();
  }, 1.4);
  inked(ctx, '#3fb8e0', () => ctx.ellipse(0, 0, 9.5, 8.5, 0, 0, TAU), 2);
  ctx.fillStyle = 'rgba(160,235,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(1.5, 1.5, 5.5, 4.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(-2.5, -3, 2.6, 1.6, -0.6, 0, TAU);
  ctx.fill();
}
