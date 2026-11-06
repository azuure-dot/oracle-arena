import { COLORS, PLAYER_SPAWN } from './config';
import { Camera } from './core/Camera';
import type { GameContext } from './core/GameContext';
import { Input } from './core/Input';
import { damp } from './core/math';
import { Effects } from './effects/Effects';
import { Bot, type BotContext, type BotOptions } from './entities/Bot';
import type { Projectile } from './entities/Projectile';
import type { Team } from './entities/Team';
import type { Hero } from './heroes/Hero';
import { HEROES, type HeroEntry } from './heroes/registry';
import { HUD } from './ui/HUD';
import { SelectScreen } from './ui/SelectScreen';
import { Stats } from './ui/Stats';
import { Arena } from './world/Arena';
import { Fog } from './world/Fog';
import { canSeeBox, computeVisibility, inVisionRange, lineOfSight, type VisPoint } from './world/Visibility';
import { circleIntersectsBox } from './core/geometry';

/** Delta max pour éviter les "téléportations" après un onglet en arrière-plan. */
const MAX_DT = 1 / 20;

type GameState = 'select' | 'playing';

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: Input;
  private readonly arena = new Arena();
  private readonly camera: Camera;
  private readonly effects = new Effects();
  private readonly hud = new HUD();
  private readonly stats = new Stats();
  private readonly fog = new Fog();
  private readonly selectScreen: SelectScreen;

  private state: GameState = 'select';
  private hero: Hero | null = null;
  private bots: Bot[];
  private projectiles: Projectile[] = [];
  private visibility: VisPoint[] = [];
  private turretsEnabled = true;
  /** Touche X : affiche les hitbox (débogage / réglage des sprites). */
  private showHitboxes = false;

  private time = 0;
  private lastTs = 0;
  private fps = 60;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  private aimX = 0;
  private aimY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D non supporté');
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.camera = new Camera();
    this.bots = this.createBots();
    this.selectScreen = new SelectScreen(overlay, HEROES, (h) => this.startWith(h));

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.camera.centerOn(this.arena.width / 2, this.arena.height / 2);
    this.selectScreen.show();
  }

  start(): void {
    requestAnimationFrame((ts) => {
      this.lastTs = ts;
      requestAnimationFrame(this.loop);
    });
  }

  // ------------------------------------------------------------ états

  private startWith(entry: HeroEntry): void {
    this.hero = entry.create();
    this.bots = this.createBots();
    this.projectiles = [];
    this.effects.clear();
    this.stats.reset();
    this.state = 'playing';
    this.selectScreen.hide();
    this.camera.centerOn(this.hero.x, this.hero.y);
    this.input.endFrame();
  }

  private backToSelect(): void {
    this.state = 'select';
    this.hero = null;
    this.projectiles = [];
    for (const b of this.bots) b.visible = true;
    this.selectScreen.show();
  }

  // ------------------------------------------------------------ setup

  private createBots(): Bot[] {
    const faceSpawn = (x: number, y: number) => Math.atan2(PLAYER_SPAWN.y - y, PLAYER_SPAWN.x - x);
    const bot = (team: Team, x: number, y: number, extra: Partial<BotOptions> = {}) =>
      new Bot({ team, x, y, facing: faceSpawn(x, y), ...extra });

    return [
      // Cibles immobiles
      bot('enemy', 760, 650),
      bot('enemy', 1000, 650), // dans la salle centrale
      bot('enemy', 1350, 400),
      bot('enemy', 1350, 900),
      bot('enemy', 1715, 650), // collé au mur du fond : parfait pour la Charge
      // Cachées derrière des murs : à débusquer en contournant
      bot('enemy', 1880, 650),
      bot('enemy', 1600, 100),
      // Tourelles : tirent seulement si elles VOIENT le joueur
      bot('enemy', 1300, 650, { kind: 'turret' }),
      bot('enemy', 1600, 300, { kind: 'turret' }),
      // Alliés (invulnérables à nos tirs) — deux blessés pour tester les soins
      bot('ally', 450, 300, { wounded: true }),
      bot('ally', 450, 1000, { wounded: true }),
      bot('ally', 1250, 1000),
      // Patrouilles
      bot('enemy', 700, 120, { patrol: { ax: 700, ay: 120, bx: 1350, by: 120 } }),
      bot('enemy', 1950, 250, { patrol: { ax: 1950, ay: 250, bx: 1950, by: 1050 } }),
      bot('ally', 700, 1200, { patrol: { ax: 700, ay: 1200, bx: 1350, by: 1200 } }),
    ];
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.camera.setViewport(this.viewW, this.viewH);
    this.fog.resize(this.viewW, this.viewH);
  }

  // ------------------------------------------------------------ boucle

  private loop = (ts: number): void => {
    const dt = Math.min((ts - this.lastTs) / 1000, MAX_DT);
    this.lastTs = ts;
    if (dt > 0) this.fps = damp(this.fps, 1 / dt, 4, dt);

    this.update(dt);
    this.draw();
    this.input.endFrame();

    requestAnimationFrame(this.loop);
  };

  private botContext(): BotContext {
    return {
      arena: this.arena,
      effects: this.effects,
      hero: this.hero,
      turretsEnabled: this.turretsEnabled,
      spawnProjectile: (p) => this.projectiles.push(p),
    };
  }

  private gameContext(): GameContext {
    return {
      input: this.input,
      aimX: this.aimX,
      aimY: this.aimY,
      arena: this.arena,
      effects: this.effects,
      time: this.time,
      bots: this.bots,
      spawnProjectile: (p) => this.projectiles.push(p),
      damageBot: (bot, amount) => this.damageBot(bot, amount),
      shake: (m) => this.camera.shake(m),
    };
  }

  private update(dt: number): void {
    this.time += dt;

    if (this.state === 'select' || !this.hero) {
      const bctx = this.botContext();
      for (const b of this.bots) b.update(dt, bctx);
      this.effects.update(dt);
      this.camera.centerOn(this.arena.width / 2, this.arena.height / 2);
      this.camera.update(dt);
      return;
    }

    const hero = this.hero;
    if (this.input.wasPressed('Escape')) {
      this.backToSelect();
      return;
    }
    if (this.input.wasPressed('KeyH')) this.hud.showHelp = !this.hud.showHelp;
    if (this.input.wasPressed('KeyT')) this.stats.reset();
    if (this.input.wasPressed('KeyB')) this.turretsEnabled = !this.turretsEnabled;
    if (this.input.wasPressed('KeyX')) this.showHitboxes = !this.showHitboxes;

    const aim = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    this.aimX = aim.x;
    this.aimY = aim.y;

    // Les buffs d'aura sont réappliqués à chaque frame par Tempo.
    for (const b of this.bots) b.resetBuffs();

    const gctx = this.gameContext();
    hero.update(dt, gctx);

    const bctx = this.botContext();
    for (const b of this.bots) b.update(dt, bctx);

    this.updateProjectiles(dt, gctx);

    // Vision : dans le périmètre 16:9 ET pas caché par un mur.
    this.visibility = computeVisibility(hero.x, hero.y, this.arena);
    for (const b of this.bots) {
      b.visible =
        inVisionRange(hero.x, hero.y, b.x, b.y, b.hw, b.hh) && canSeeBox(this.arena, hero.x, hero.y, b.box());
    }

    this.effects.update(dt);
    this.hud.update(dt);

    // Caméra verrouillée sur le joueur (sans lissage ni décalage vers la souris).
    this.camera.centerOn(hero.x, hero.y);
    this.camera.update(dt);
  }

  private damageBot(bot: Bot, amount: number): number {
    const dealt = bot.takeDamage(amount);
    if (dealt <= 0) return 0;
    const killed = !bot.alive;
    this.stats.record(this.time, dealt, killed);
    this.hud.onHit(killed);
    this.effects.damageNumber(bot.x, bot.y - bot.hh, dealt);
    if (killed) {
      this.effects.sparks(bot.x, bot.y, COLORS.enemy, 26, 320);
      this.effects.ring(bot.x, bot.y, COLORS.enemy, 60, 0.4);
    }
    return dealt;
  }

  private updateProjectiles(dt: number, gctx: GameContext): void {
    const hero = this.hero;
    for (const p of this.projectiles) {
      const dx = p.vx * dt;
      const dy = p.vy * dt;
      const dist = Math.hypot(dx, dy);
      // Sous-pas : un projectile ne "saute" jamais par-dessus un mur, un bot ou un bouclier.
      const steps = Math.max(1, Math.ceil(dist / 8));

      for (let s = 0; s < steps && !p.dead; s++) {
        p.x += dx / steps;
        p.y += dy / steps;
        p.traveled += dist / steps;

        if (this.arena.pointInWall(p.x, p.y)) {
          p.dead = true;
          this.effects.sparks(p.x, p.y, p.color, p.style === 'fire' ? 14 : 3, 160);
          break;
        }

        if (p.team === 'ally') {
          this.hitBots(p);
        } else if (hero && !hero.dead) {
          if (hero.shieldBlocks(p)) {
            p.dead = true;
            this.effects.sparks(p.x, p.y, COLORS.shield, 5, 160);
          } else if (circleIntersectsBox(p.x, p.y, p.radius, hero.box())) {
            hero.takeDamage(p.damage, gctx);
            p.dead = true;
            this.effects.sparks(p.x, p.y, COLORS.enemyBullet, 5, 160);
          }
        }

        if (p.traveled >= p.maxRange) p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  /** Projectile allié contre les bots ennemis (les alliés sont traversés). */
  private hitBots(p: Projectile): void {
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === p.team) continue;
      if (!circleIntersectsBox(p.x, p.y, p.radius, bot.box())) continue;
      if (p.pierce) {
        if (p.hits.has(bot)) continue;
        p.hits.add(bot);
        this.damageBot(bot, p.damage);
        this.effects.sparks(bot.x, bot.y, p.color, 10, 220);
      } else {
        this.damageBot(bot, p.damage);
        this.effects.sparks(p.x, p.y, COLORS.enemy, 4, 180);
        p.dead = true;
        return;
      }
    }
  }

  // ------------------------------------------------------------ rendu

  private drawHitboxes(ctx: CanvasRenderingContext2D, hero: Hero): void {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#00ff9c';
    const boxes = [hero.box(), ...this.bots.filter((b) => b.visible && b.alive).map((b) => b.box())];
    for (const b of boxes) ctx.strokeRect(b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 2);
    ctx.restore();
  }

  private draw(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const view = this.camera.transform();
    const toWorld = () => ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    const toScreen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hero = this.state === 'playing' ? this.hero : null;

    // --- 1. Monde (sol, entités visibles, effets)
    toWorld();
    this.arena.drawFloor(ctx);
    this.effects.drawUnder(ctx);
    hero?.drawUnder(ctx, this.time);
    for (const b of this.bots) if (b.visible) b.draw(ctx);
    hero?.draw(ctx);
    for (const p of this.projectiles) {
      // Projectiles ennemis hors de vue (mur ou périmètre) : non affichés.
      if (
        p.team === 'enemy' &&
        hero &&
        (!inVisionRange(hero.x, hero.y, p.x, p.y) || !lineOfSight(this.arena, hero.x, hero.y, p.x, p.y))
      ) {
        continue;
      }
      p.draw(ctx);
    }
    this.effects.drawOver(ctx);
    hero?.drawOver(ctx);
    if (hero && this.showHitboxes) this.drawHitboxes(ctx, hero);

    // --- 2. Ombre des murs (ligne de vue)
    toScreen();
    if (hero) this.fog.drawLineOfSight(ctx, this.visibility, view, hero.x, hero.y, this.viewW, this.viewH);

    // --- 3. Murs par-dessus l'ombre (la map proche reste lisible)
    toWorld();
    this.arena.drawWalls(ctx);

    // --- 4. Périmètre de vision : au-delà, tout est dans l'ombre (murs compris)
    toScreen();
    if (hero) this.fog.drawVisionLimit(ctx, view, hero.x, hero.y, this.viewW, this.viewH);

    // --- 5. Barres de vie (seulement ce qui est visible)
    toWorld();
    for (const b of this.bots) if (b.visible) b.drawOverlay(ctx);
    hero?.drawOverlay(ctx);

    // --- 6. HUD (espace écran)
    toScreen();
    if (hero) {
      this.hud.draw(ctx, {
        width: this.viewW,
        height: this.viewH,
        mouseX: this.input.mouseX,
        mouseY: this.input.mouseY,
        // distance à l'écran (px) : le cercle de dispersion du viseur suit le zoom
        aimDistance: Math.hypot(this.aimX - hero.x, this.aimY - hero.y) * view.scale,
        hero,
        stats: this.stats,
        time: this.time,
        fps: this.fps,
        turretsEnabled: this.turretsEnabled,
      });
    }
  }
}
