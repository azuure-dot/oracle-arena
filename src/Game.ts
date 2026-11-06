import { PLAYER_SPAWN } from './config';
import { Camera } from './core/Camera';
import { Input } from './core/Input';
import { damp } from './core/math';
import { World } from './game/World';
import { HEROES, type HeroEntry } from './heroes/registry';
import { DeathmatchMode, type DeathmatchConfig } from './modes/DeathmatchMode';
import type { GameMode, ModeKind } from './modes/GameMode';
import { PracticeMode, createRangeBots } from './modes/PracticeMode';
import { DeathmatchSetup } from './ui/screens/DeathmatchSetup';
import { MainMenu } from './ui/screens/MainMenu';
import type { Screen } from './ui/screens/Screen';
import { Scoreboard, type MatchResult } from './ui/screens/Scoreboard';
import { SelectScreen } from './ui/screens/SelectScreen';
import { Arena } from './world/Arena';
import { Fog } from './world/Fog';

/** Delta max pour éviter les "téléportations" après un onglet en arrière-plan. */
const MAX_DT = 1 / 20;

/**
 * Enchaînement des scènes :
 *
 *   Menu ─┬─ Champ de tir ──────────────▶ Sélection ─▶ En jeu (Échap → Sélection)
 *         └─ Deathmatch ─▶ Configuration ─▶ Sélection ─▶ En jeu ─▶ Scores ─▶ Menu / Rejouer
 */
export type Scene = 'menu' | 'dmSetup' | 'select' | 'playing' | 'scoreboard';

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: Input;
  private readonly arena = new Arena();
  private readonly camera = new Camera();
  private readonly fog = new Fog();

  private readonly mainMenu: MainMenu;
  private readonly dmSetup: DeathmatchSetup;
  private readonly selectScreen: SelectScreen;
  private readonly scoreboard: Scoreboard;
  private readonly screens: Screen[];

  scene: Scene = 'menu';
  /** Partie en cours (aussi affichée, figée, derrière le tableau des scores). */
  mode: GameMode | null = null;
  /** Monde animé derrière les menus (le champ de tir, sans joueur). */
  private readonly backdrop: World;
  private pendingKind: ModeKind = 'practice';
  private dmConfig: DeathmatchConfig;
  private lastEntry: HeroEntry | null = null;

  private lastTs = 0;
  private fps = 60;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D non supporté');
    this.ctx = ctx;
    this.input = new Input(canvas);

    this.backdrop = new World(this.arena, this.camera, { respawnPoint: () => PLAYER_SPAWN });
    this.backdrop.bots = createRangeBots();

    this.mainMenu = new MainMenu(overlay, (choice) => {
      if (choice === 'practice') {
        this.pendingKind = 'practice';
        this.goTo('select');
      } else {
        this.goTo('dmSetup');
      }
    });
    this.dmSetup = new DeathmatchSetup(
      overlay,
      (config) => {
        this.dmConfig = config;
        this.pendingKind = 'deathmatch';
        this.goTo('select');
      },
      () => this.goTo('menu'),
    );
    this.dmConfig = this.dmSetup.config;
    this.selectScreen = new SelectScreen(
      overlay,
      HEROES,
      (entry) => this.startMode(entry),
      () => this.goTo(this.pendingKind === 'deathmatch' ? 'dmSetup' : 'menu'),
    );
    this.scoreboard = new Scoreboard(
      overlay,
      () => this.goTo('menu'),
      () => this.lastEntry && this.startMode(this.lastEntry),
    );
    this.screens = [this.mainMenu, this.dmSetup, this.selectScreen, this.scoreboard];

    // Le clavier des menus va à l'écran affiché (un seul à la fois).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const screen = this.screens.find((s) => s.visible);
      if (screen?.handleKey(e)) e.preventDefault();
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.goTo('menu');
  }

  start(): void {
    requestAnimationFrame((ts) => {
      this.lastTs = ts;
      requestAnimationFrame(this.loop);
    });
  }

  // ------------------------------------------------------------ scènes

  goTo(scene: Scene): void {
    this.scene = scene;
    for (const s of this.screens) s.hide();
    switch (scene) {
      case 'menu':
        this.mode = null;
        this.mainMenu.show();
        break;
      case 'dmSetup':
        this.mode = null;
        this.dmSetup.show();
        break;
      case 'select':
        this.mode = null;
        this.selectScreen.mode = this.pendingKind;
        this.selectScreen.show();
        break;
      case 'scoreboard':
        if (this.mode instanceof DeathmatchMode) this.scoreboard.showResult(matchResult(this.mode));
        break;
      case 'playing':
        break;
    }
  }

  private startMode(entry: HeroEntry): void {
    this.lastEntry = entry;
    this.mode =
      this.pendingKind === 'deathmatch'
        ? new DeathmatchMode(this.arena, this.camera, this.input, entry, this.dmConfig)
        : new PracticeMode(this.arena, this.camera, this.input, entry);
    this.camera.centerOn(this.mode.player.x, this.mode.player.y);
    this.input.endFrame();
    this.goTo('playing');
  }

  // ------------------------------------------------------------ boucle

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.camera.setViewport(this.viewW, this.viewH);
    this.fog.resize(this.viewW, this.viewH);
  }

  private loop = (ts: number): void => {
    const dt = Math.min((ts - this.lastTs) / 1000, MAX_DT);
    this.lastTs = ts;
    if (dt > 0) this.fps = damp(this.fps, 1 / dt, 4, dt);

    this.update(dt);
    this.draw();
    this.input.endFrame();

    requestAnimationFrame(this.loop);
  };

  update(dt: number): void {
    const mode = this.mode;
    if (this.scene === 'playing' && mode) {
      mode.update(dt);
      if (mode.exitRequested) {
        // Champ de tir : retour à la sélection · Deathmatch : abandon, retour au menu.
        this.goTo(mode.kind === 'practice' ? 'select' : 'menu');
        return;
      }
      if (mode.finished) this.goTo('scoreboard'); // la partie se fige derrière les scores
      this.camera.centerOn(mode.player.x, mode.player.y); // caméra verrouillée sur le joueur
    } else if (!mode) {
      this.backdrop.update(dt);
      this.camera.centerOn(this.arena.width / 2, this.arena.height / 2);
    }
    this.camera.update(dt);
  }

  draw(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const view = this.camera.transform();
    const mode = this.mode;
    if (!mode) {
      this.backdrop.draw(ctx, dpr, view, this.viewW, this.viewH, this.fog, false);
      return;
    }
    mode.world.draw(ctx, dpr, view, this.viewW, this.viewH, this.fog, mode.showHitboxes);
    if (this.scene !== 'playing') return;

    const aim = this.camera.screenToWorld(this.input.mouseX, this.input.mouseY);
    const p = mode.player;
    mode.drawHud(ctx, {
      width: this.viewW,
      height: this.viewH,
      mouseX: this.input.mouseX,
      mouseY: this.input.mouseY,
      // distance à l'écran (px) : le cercle de dispersion du viseur suit le zoom
      aimDistance: Math.hypot(aim.x - p.x, aim.y - p.y) * view.scale,
      fps: this.fps,
    });
  }
}

/** Classement final pour le tableau des scores. */
function matchResult(dm: DeathmatchMode): MatchResult {
  const you = dm.playerEntry;
  const playerRank = dm.rankOf(you);
  return {
    rows: dm.ranking().map((p) => ({
      rank: dm.rankOf(p),
      name: p.isPlayer ? null : p.name,
      hero: p.hero.name,
      heroColor: p.hero.stats.color,
      kills: p.kills,
      deaths: p.deaths,
    })),
    playerRank,
    playerWon: playerRank === 1 && dm.participants.every((p) => p === you || p.kills < you.kills),
  };
}
