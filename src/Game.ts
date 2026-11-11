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
import { NetMatch } from './network/NetMatch';
import { net } from './network/NetworkManager';
import type { GameStarted } from '../server/src/types/network';
import { DeathmatchSetup } from './ui/screens/DeathmatchSetup';
import { MainMenu } from './ui/screens/MainMenu';
import { MapSelect } from './ui/screens/MapSelect';
import { PrivateHub } from './ui/screens/PrivateHub';
import { PrivateLobby } from './ui/screens/PrivateLobby';
import type { Screen } from './ui/screens/Screen';
import { Scoreboard } from './ui/screens/Scoreboard';
import { PauseMenu } from './ui/screens/PauseMenu';
import { ScoreOverlay } from './ui/ScoreOverlay';
import { t } from './i18n';
import { SelectScreen } from './ui/screens/SelectScreen';
import { Arena } from './world/Arena';
import { Fog } from './world/Fog';
import { PRACTICE_MAP, QUICKPLAY_MAPS, type MapDef } from './world/maps';

/** Delta max pour éviter les "téléportations" après un onglet en arrière-plan. */
const MAX_DT = 1 / 20;
/**
 * Écart minimal entre deux images (ms). Sur un écran 120/144 Hz, le jeu ne dessine qu'une image
 * sur deux (60-72 i/s) au lieu de toutes : moitié moins de travail pour la carte graphique, qui
 * chauffe moins et ne se bride plus au bout de quelques parties. Écran 60 Hz : inchangé.
 */
const MIN_FRAME_MS = 11.5;

/**
 * Enchaînement des scènes :
 *
 *   Menu ─┬─ Partie rapide ─▶ Carte ───────▶ Sélection ─▶ En jeu ─▶ Victoire / défaite
 *         │   (la carte décide du mode : Sanctuaire → Contrôle, Route 66 → Escorte)
 *         ├─ Champ de tir ───────────────▶ Sélection ─▶ En jeu (Échap → Sélection)
 *         ├─ Deathmatch ─▶ Configuration ─▶ Sélection ─▶ En jeu ─▶ Scores
 *         └─ Partie privée (en ligne) ─▶ Salon ─▶ En jeu ─▶ Scores ─▶ Salon
 *              (créer / rejoindre par code)   (le serveur lance la partie : src/network/)
 */
export type Scene = 'menu' | 'mapSelect' | 'dmSetup' | 'select' | 'playing' | 'scoreboard' | 'netHub' | 'netLobby';

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
  private readonly netHub: PrivateHub;
  private readonly netLobby: PrivateLobby;
  /** Menu Échap en jeu (Revenir au jeu, Options, Quitter la partie). */
  private readonly pauseMenu: PauseMenu;
  /** Tableau des scores en jeu (Tab maintenu). */
  private readonly scoreOverlay: ScoreOverlay;
  /** Téléphone : le bouton ★ affiche / masque le tableau des scores (pas de touche à maintenir). */
  private scoresToggled = false;
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
      else if (choice === 'private') this.goTo('netHub');
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
      () => this.goTo(this.mode instanceof NetMatch ? 'netLobby' : 'menu'),
      () => (this.mode instanceof NetMatch ? this.goTo('netLobby') : this.lastEntry && this.startMode(this.lastEntry)),
    );

    // --- parties privées en ligne
    this.netHub = new PrivateHub(
      overlay,
      () => this.goTo('netLobby'),
      () => this.goTo('menu'),
    );
    this.netLobby = new PrivateLobby(overlay, () => this.goTo('netHub'));
    net.gameStarted.on((info) => this.startNetMatch(info));
    net.roomClosed.on(() => {
      // Connexion perdue ou salon fermé : retour à l'écran des parties privées, avec un message.
      if (this.scene === 'netLobby' || this.mode instanceof NetMatch) {
        this.goTo('netHub');
        this.netHub.showWith('net.err.closed');
      }
    });

    this.pauseMenu = new PauseMenu(
      overlay,
      () => this.closePause(),
      () => this.quitMatch(),
    );
    this.scoreOverlay = new ScoreOverlay(overlay);

    this.screens = [
      this.mainMenu,
      this.mapSelect,
      this.dmSetup,
      this.selectScreen,
      this.scoreboard,
      this.netHub,
      this.netLobby,
      this.pauseMenu,
    ];

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
    this.scoreOverlay.hide();
    this.scoresToggled = false;
    this.selectScreen.swap = null;
    switch (scene) {
      case 'menu':
      case 'mapSelect':
      case 'dmSetup':
        this.endMode();
        this.backdropMap = PRACTICE_MAP;
        (scene === 'menu' ? this.mainMenu : scene === 'mapSelect' ? this.mapSelect : this.dmSetup).show();
        break;
      case 'select':
        this.endMode();
        // Fond : la carte de la partie (Partie rapide), sinon le champ de tir.
        this.backdropMap = this.pendingKind === 'control' || this.pendingKind === 'escort' ? this.pendingMap : PRACTICE_MAP;
        this.selectScreen.mode = this.pendingKind;
        this.selectScreen.map = this.pendingMap;
        this.selectScreen.show();
        break;
      case 'scoreboard': {
        const result = this.mode?.result();
        this.scoreboard.online = this.mode instanceof NetMatch;
        if (result) this.scoreboard.showResult(result);
        break;
      }
      case 'netHub':
      case 'netLobby':
        this.endMode();
        this.backdropMap = PRACTICE_MAP;
        (scene === 'netHub' ? this.netHub : this.netLobby).show();
        break;
      case 'playing':
        break;
    }
  }

  /** Quitte la partie en cours en libérant ses ressources (images du décor, listes du monde). */
  private endMode(): void {
    if (this.mode instanceof NetMatch) this.mode.dispose();
    this.mode?.world.dispose();
    this.mode = null;
  }

  /** Le serveur lance la partie du salon : on passe en jeu (Deathmatch en ligne). */
  private startNetMatch(info: GameStarted): void {
    if (!net.you || !net.room) return;
    this.endMode();
    for (const w of this.mapBackdrops.values()) w.dispose();
    this.mapBackdrops.clear();
    this.mode = new NetMatch(this.camera, this.input, info, net.you, net);
    this.camera.centerOn(this.mode.player.x, this.mode.player.y);
    this.input.endFrame();
    this.goTo('playing');
  }

  private startMode(entry: HeroEntry): void {
    this.lastEntry = entry;
    this.endMode();
    // Les cartes floutées derrière la sélection ne servent plus pendant la partie : on les libère.
    for (const w of this.mapBackdrops.values()) w.dispose();
    this.mapBackdrops.clear();
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

  // ------------------------------------------------------------ menu Échap

  /** Échap en jeu : le menu s'ouvre ; en solo la partie se fige, en ligne elle continue. */
  private openPause(): void {
    const mode = this.mode;
    if (!mode || this.pauseMenu.visible) return;
    mode.uiOpen = true;
    this.scoreOverlay.hide();
    this.pauseMenu.open(mode instanceof NetMatch);
  }

  private closePause(): void {
    this.pauseMenu.hide();
    if (this.mode) this.mode.uiOpen = false;
    this.input.endFrame(); // le clic qui a fermé le menu ne tire pas
  }

  /** « Quitter la partie » : retour au menu principal (en ligne : on quitte aussi le salon). */
  private quitMatch(): void {
    this.pauseMenu.hide();
    if (this.mode instanceof NetMatch) {
      void net.leaveRoom(); // la partie continue pour les autres
      this.goTo('netHub');
    } else {
      this.goTo('menu');
    }
  }

  /** Titre du tableau des scores : le mode, et la carte en Partie rapide. */
  private scoresTitle(mode: GameMode): string {
    if (mode.kind === 'deathmatch') return t('menu.deathmatch');
    const kind = t(mode.kind === 'escort' ? 'mode.escort' : 'mode.control');
    return `${kind} · ${t(mode.map.nameKey)}`;
  }

  /** Tableau des scores : Tab maintenu (ou bouton ★ sur téléphone), pas par-dessus un menu. */
  private updateScores(mode: GameMode): void {
    if (this.input.touch.active && this.input.wasPressed('Tab')) this.scoresToggled = !this.scoresToggled;
    const wanted = (this.input.isDown('Tab') || this.scoresToggled) && !mode.uiOpen && !mode.finished;
    const result = wanted ? mode.result() : null;
    if (!result) {
      this.scoreOverlay.hide();
      return;
    }
    const online = mode instanceof NetMatch;
    this.scoreOverlay.show({ title: this.scoresTitle(mode), result, online, ping: online ? net.ping : null });
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
    requestAnimationFrame(this.loop);
    if (ts - this.lastTs < MIN_FRAME_MS) return; // écran rapide : on saute cette image
    const dt = Math.min((ts - this.lastTs) / 1000, MAX_DT);
    this.lastTs = ts;
    if (dt > 0) this.fps = damp(this.fps, 1 / dt, 4, dt);

    this.update(dt);
    this.draw();
    this.input.endFrame();
  };

  update(dt: number): void {
    const mode = this.mode;
    if (this.scene === 'playing' && mode) {
      // Menu Échap ouvert : en solo la partie est figée ; en ligne elle continue (sans commandes).
      if (!this.pauseMenu.visible || mode instanceof NetMatch) mode.update(dt);
      if (mode.pauseRequested) {
        mode.pauseRequested = false;
        this.openPause();
      }
      if (mode.exitRequested) {
        this.quitMatch();
        return;
      }
      if (mode.heroSelectRequested) {
        // H au champ de tir : retour à la sélection du héros.
        mode.heroSelectRequested = false;
        this.goTo('select');
        return;
      }
      this.updateScores(mode);
      if (mode.finished) {
        this.goTo('scoreboard'); // la partie se fige derrière les scores
      } else if (mode instanceof TeamMatchMode) {
        if (mode.swapRequested && !mode.uiOpen) this.openHeroSwap(mode);
        // Le joueur a quitté son spawn ou la manche s'est terminée : on ferme le menu.
        if (mode.uiOpen && (!mode.player.safe || !mode.canSwap())) this.selectScreen.swap?.onClose();
      }
      this.camera.centerOn(mode.player.x, mode.player.y); // caméra verrouillée sur le joueur
    } else if (!mode) {
      // Menu opaque par-dessus : le décor animé ne se voit pas, inutile de le faire vivre.
      if (this.menuCoversGame()) return;
      const w = this.backdropWorld();
      w.update(dt);
      // Lent travelling sur la carte, derrière les menus.
      this.backdropTime += dt;
      const t = this.backdropTime * 0.06;
      this.camera.centerOn(w.arena.width * (0.5 + Math.sin(t) * 0.18), w.arena.height * (0.5 + Math.sin(t * 1.7) * 0.12));
    }
    this.camera.update(dt);
  }

  /** Un menu affiché cache entièrement le jeu (fond opaque du thème). */
  private menuCoversGame(): boolean {
    return this.screens.some((s) => s.covers);
  }

  draw(): void {
    // Menu opaque par-dessus : rien à dessiner (le canvas garde sa dernière image, invisible).
    if (this.menuCoversGame()) return;
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
