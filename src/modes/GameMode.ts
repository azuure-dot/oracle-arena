import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import { PlayerControls } from '../core/Controls';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import { World, type DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import { HUD } from '../ui/HUD';
import type { Arena } from '../world/Arena';

export type ModeKind = 'practice' | 'deathmatch';

/** Ce que le jeu fournit au mode pour dessiner son HUD. */
export interface ScreenInfo {
  width: number;
  height: number;
  mouseX: number;
  mouseY: number;
  /** Distance curseur ↔ héros à l'écran (px) : rayon de dispersion du viseur. */
  aimDistance: number;
  fps: number;
}

/**
 * Un mode de jeu = un monde + des règles. Le joueur y contrôle un héros au clavier.
 * Les sous-classes ajoutent leurs règles (stats du champ de tir, score du Deathmatch...).
 */
export abstract class GameMode {
  abstract readonly kind: ModeKind;
  readonly world: World;
  readonly player: Hero;
  protected readonly hud = new HUD();
  private readonly playerControls: PlayerControls;
  /** Touche X : affiche les hitbox. */
  showHitboxes = false;
  /** Échap pressé : le jeu quitte le mode. */
  exitRequested = false;

  constructor(
    arena: Arena,
    protected readonly camera: Camera,
    protected readonly input: Input,
    readonly entry: HeroEntry,
  ) {
    this.world = new World(arena, camera, {
      respawnPoint: (hero) => this.respawnPoint(hero),
      onDamage: (e) => this.onDamage(e),
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
    if (input.wasPressed('Escape')) {
      this.exitRequested = true;
      return;
    }
    if (input.wasPressed('KeyH')) this.hud.showHelp = !this.hud.showHelp;
    if (input.wasPressed('KeyX')) this.showHitboxes = !this.showHitboxes;
    this.handleKeys();

    const aim = this.camera.screenToWorld(input.mouseX, input.mouseY);
    this.playerControls.sample(aim.x, aim.y);

    this.beforeWorld(dt);
    this.world.update(dt);
    this.afterWorld(dt);
    this.hud.update(dt);
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
