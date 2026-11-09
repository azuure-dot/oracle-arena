import { PLAYER_SPAWN } from './config';
import { Camera } from './core/Camera';
import { Input } from './core/Input';
import { damp } from './core/math';
import { World } from './game/World';
import { HEROES, type HeroEntry } from './heroes/registry';
import { ControlMode } from './modes/ControlMode';
import { EscortMode } from './modes/EscortMode';
import { TeamMatchMode } from './modes/TeamMatchMode';
import { DeathmatchMode, type DeathmatchConfig } from './modes/DeathmatchMode';
import type { GameMode, ModeKind } from './modes/GameMode';
import { PracticeMode, createRangeBots } from './modes/PracticeMode';
import { DeathmatchSetup } from './ui/screens/DeathmatchSetup';
import { MainMenu } from './ui/screens/MainMenu';
import { MapSelect } from './ui/screens/MapSelect';
import type { Screen } from './ui/screens/Screen';
import { Scoreboard } from './ui/screens/Scoreboard';
import { SelectScreen } from './ui/screens/SelectScreen';
import { Arena } from './world/Arena';
import { Fog } from './world/Fog';
import { PRACTICE_MAP, QUICKPLAY_MAPS, type MapDef } from './world/maps';

/** Delta max pour éviter les "téléportations" après un onglet en arrière-plan. */
const MAX_DT = 1 / 20;

/**
 * Enchaînement des scènes :
 *
 *   Menu ─┬─ Partie rapide ─▶ Carte ───────▶ Sélection ─▶ En jeu ─▶ Victoire / défaite
 *         │   (la carte décide du mode : Sanctuaire → Contrôle, Route 66 → Escorte)
 *         ├─ Champ de tir ───────────────▶ Sélection ─▶ En jeu (Échap → Sélection)
 *         └─ Deathmatch ─▶ Configuration ─▶ Sélection ─▶ En jeu ─▶ Scores
 */
export type Scene = 'menu' | 'mapSelect' | 'dmSetup' | 'select' | 'playing' | 'scoreboard';

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: Input;
  private readonly camera = new Camera();
  private readonly fog = new Fog();

  private readonly mainMenu: MainMenu;
  private readonly mapSelect: MapSelect;
  private readonly dmSetup: DeathmatchSetup;
  private readonly selectScreen: SelectScreen;
  private readonly scoreboard: Scoreboard;
  private readonly screens: Screen[];

  scene: Scene = 'menu';
  /** Partie en cours (aussi affichée, figée, derrière le tableau des scores). */
  mode: GameMode | null = null;
  /** Monde animé derrière les menus (le champ de tir, sans joueur). */
  private readonly backdrop: World;
  /**
   * Fond de la sélection du héros : la carte de la partie à venir (floutée par l'écran).
   * Une carte vide par carte de Partie rapide, créée à la première sélection.
   */
  private readonly mapBackdrops = new Map<MapDef, World>();
  private backdropMap: MapDef = PRACTICE_MAP;
  private backdropTime = 0;
  private pendingKind: ModeKind = 'practice';
  private pendingMap: MapDef = QUICKPLAY_MAPS[0];
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

    this.backdrop = new World(new Arena(PRACTICE_MAP), this.camera, { respawnPoint: () => PLAYER_SPAWN });
    this.backdrop.bots = createRangeBots();

    this.mainMenu = new MainMenu(overlay, (choice) => {
      if (choice === 'quickplay') this.goTo('mapSelect');
      else if (choice === 'deathmatch') this.goTo('dmSetup');
      else {
        this.pendingKind = 'practice';
        this.goTo('select');
      }
    });
    this.mapSelect = new MapSelect(
      overlay,
      QUICKPLAY_MAPS,
      (map) => {
        // La carte détermine le mode : Sanctuaire → Contrôle, Route 66 → Escorte.
        this.pendingMap = map;
        this.pendingKind = map.escort ? 'escort' : 'control';
        this.goTo('select');
      },
      () => this.goTo('menu'),
    );
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
      () =>
        this.goTo(
          this.pendingKind === 'deathmatch' ? 'dmSetup' : this.pendingKind === 'practice' ? 'menu' : 'mapSelect',
        ),
    );
    this.scoreboard = new Scoreboard(
      overlay,
      () => this.goTo('menu'),
      () => this.lastEntry && this.startMode(this.lastEntry),
    );
    this.screens = [this.mainMenu, this.mapSelect, this.dmSetup, this.selectScreen, this.scoreboard];

    // Le clavier des menus va à l'écran affiché (un seul à la fois).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const screen = this.screens.find((s) => s.visible);
      if (screen?.handleKey(e)) {
        e.preventDefault();
        this.input.forget(e.code); // ex. Échap qui ferme un menu ne quitte pas aussi la partie
      }
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
    this.selectScreen.swap = null;
    switch (scene) {
      case 'menu':
      case 'mapSelect':
      case 'dmSetup':
        this.mode = null;
        this.backdropMap = PRACTICE_MAP;
        (scene === 'menu' ? this.mainMenu : scene === 'mapSelect' ? this.mapSelect : this.dmSetup).show();
        break;
      case 'select':
        this.mode = null;
        // Fond : la carte de la partie (Partie rapide), sinon le champ de tir.
        this.backdropMap = this.pendingKind === 'control' || this.pendingKind === 'escort' ? this.pendingMap : PRACTICE_MAP;
        this.selectScreen.mode = this.pendingKind;
        this.selectScreen.map = this.pendingMap;
        this.selectScreen.show();
        break;
      case 'scoreboard': {
        const result = this.mode?.result();
        if (result) this.scoreboard.showResult(result);
        break;
      }
      case 'playing':
        break;
    }
  }

  private startMode(entry: HeroEntry): void {
    this.lastEntry = entry;
    switch (this.pendingKind) {
      case 'control':
        this.mode = new ControlMode(this.pendingMap, this.camera, this.input, entry);
        break;
      case 'escort':
        this.mode = new EscortMode(this.pendingMap, this.camera, this.input, entry);
        break;
      case 'deathmatch':
        this.mode = new DeathmatchMode(this.camera, this.input, entry, this.dmConfig);
        break;
      default:
        this.mode = new PracticeMode(this.camera, this.input, entry);
    }
    this.camera.centerOn(this.mode.player.x, this.mode.player.y);
    this.input.endFrame();
    this.goTo('playing');
  }

  /** Modes en équipe : changement de héros dans le spawn (la partie continue derrière). */
  private openHeroSwap(mode: TeamMatchMode): void {
    mode.swapRequested = false;
    mode.uiOpen = true;
    const close = () => {
      mode.uiOpen = false;
      this.selectScreen.swap = null;
      this.selectScreen.hide();
    };
    this.selectScreen.swap = {
      taken: mode.takenByAllies(),
      current: mode.player.name,
      onPick: (entry) => {
        mode.swapPlayerHero(entry);
        this.lastEntry = entry; // « Rejouer » reprend le dernier héros joué
        close();
      },
      onClose: close,
    };
    this.selectScreen.show();
  }

  /** Monde affiché derrière les menus : le champ de tir animé, ou la carte de la partie à venir. */
  private backdropWorld(): World {
    const map = this.backdropMap;
    if (map === PRACTICE_MAP) return this.backdrop;
    let w = this.mapBackdrops.get(map);
    if (!w) {
      w = new World(new Arena(map), this.camera, { respawnPoint: () => PLAYER_SPAWN });
      this.mapBackdrops.set(map, w);
    }
    return w;
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
        // Champ de tir : retour à la sélection · autres modes : abandon, retour au menu.
        this.goTo(mode.kind === 'practice' ? 'select' : 'menu');
        return;
      }
      if (mode.finished) {
        this.goTo('scoreboard'); // la partie se fige derrière les scores
      } else if (mode instanceof TeamMatchMode) {
        if (mode.swapRequested && !mode.uiOpen) this.openHeroSwap(mode);
        // Le joueur a quitté son spawn ou la manche s'est terminée : on ferme le menu.
        if (mode.uiOpen && (!mode.player.safe || !mode.canSwap())) this.selectScreen.swap?.onClose();
      }
      this.camera.centerOn(mode.player.x, mode.player.y); // caméra verrouillée sur le joueur
    } else if (!mode) {
      const w = this.backdropWorld();
      w.update(dt);
      // Lent travelling sur la carte, derrière les menus.
      this.backdropTime += dt;
      const t = this.backdropTime * 0.06;
      this.camera.centerOn(w.arena.width * (0.5 + Math.sin(t) * 0.18), w.arena.height * (0.5 + Math.sin(t * 1.7) * 0.12));
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
      this.backdropWorld().draw(ctx, dpr, view, this.viewW, this.viewH, this.fog, false);
      return;
    }
    mode.world.draw(ctx, dpr, view, this.viewW, this.viewH, this.fog, mode.showHitboxes);
    if (this.scene !== 'playing' || mode.uiOpen) return;

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
      view,
      touch: this.input.touch.active ? this.input.touch : undefined,
    });
  }
}
