import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import { NO_CONTROLS, PlayerControls } from '../core/Controls';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import { World, type DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import { HUD } from '../ui/HUD';
import type { MatchResult } from '../ui/screens/Scoreboard';
import { Arena } from '../world/Arena';
import type { MapDef } from '../world/maps';

export type ModeKind = 'practice' | 'deathmatch' | 'control';

/** Ce que le jeu fournit au mode pour dessiner son HUD. */
export interface ScreenInfo {
  width: number;
  height: number;
  mouseX: number;
  mouseY: number;
  /** Distance curseur ↔ héros à l'écran (px) : rayon de dispersion du viseur. */
  aimDistance: number;
  fps: number;
  /** Transformation monde → écran (indicateurs hors écran). */
  view: { scale: number; tx: number; ty: number };
}

/**
 * Un mode de jeu = un monde + des règles. Le joueur y contrôle un héros au clavier.
 * Les sous-classes ajoutent leurs règles (stats du champ de tir, score du Deathmatch...).
 */
export abstract class GameMode {
  abstract readonly kind: ModeKind;
  readonly world: World;
  readonly arena: Arena;
  /** Héros du joueur (peut changer en cours de partie : changement de héros au spawn). */
  player: Hero;
  protected readonly hud = new HUD();
  protected readonly playerControls: PlayerControls;
  /** Un menu est ouvert par-dessus la partie (changement de héros) : le joueur ne contrôle plus son héros. */
  uiOpen = false;
  /** Touche X : affiche les hitbox. */
  showHitboxes = false;
  /** Échap pressé : le jeu quitte le mode. */
  exitRequested = false;

  constructor(
    readonly map: MapDef,
    protected readonly camera: Camera,
    protected readonly input: Input,
    readonly entry: HeroEntry,
  ) {
    this.arena = new Arena(map);
    this.world = new World(this.arena, camera, {
      respawnPoint: (hero) => this.respawnPoint(hero),
      onDamage: (e) => this.onDamage(e),
      drawGround: (ctx, time) => this.drawGround(ctx, time),
    });
    this.playerControls = new PlayerControls(input);
    this.player = entry.create();
    this.player.controls = this.playerControls;
    this.player.isLocalPlayer = true;
    this.player.outline = COLORS.ally;
  }

  /** La partie est terminée (fin du chrono en Deathmatch). */
  get finished(): boolean {
    return false;
  }

  update(dt: number): void {
    const input = this.input;
    if (this.uiOpen) {
      this.player.controls = NO_CONTROLS;
    } else {
      this.player.controls = this.playerControls;
    }
    if (!this.uiOpen && input.wasPressed('Escape')) {
      this.exitRequested = true;
      return;
    }
    if (input.wasPressed('KeyH')) this.hud.showHelp = !this.hud.showHelp;
    if (input.wasPressed('KeyX')) this.showHitboxes = !this.showHitboxes;
    this.handleKeys();

    const aim = this.camera.screenToWorld(input.mouseX, input.mouseY);
    this.playerControls.sample(aim.x, aim.y);

    if (!this.simulationPaused()) {
      this.beforeWorld(dt);
      this.world.update(dt);
    }
    this.afterWorld(dt);
    this.hud.update(dt);
  }

  /** true pendant une pause (transition entre deux manches) : le monde est figé. */
  protected simulationPaused(): boolean {
    return false;
  }
  /** Dessin au sol propre au mode. */
  protected drawGround(_ctx: CanvasRenderingContext2D, _time: number): void {}
  /** Résultat à afficher en fin de partie (null : pas de tableau des scores). */
  result(): MatchResult | null {
    return null;
  }

  /** Touches propres au mode. */
  protected handleKeys(): void {}
  /** Avant la simulation (ex. IA des bots). */
  protected beforeWorld(_dt: number): void {}
  /** Après la simulation (ex. chrono). */
  protected afterWorld(_dt: number): void {}

  protected abstract respawnPoint(hero: Hero): Vec2;
  protected onDamage(_e: DamageEvent): void {}

  /** HUD propre au mode, en espace écran. */
  abstract drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void;
}
