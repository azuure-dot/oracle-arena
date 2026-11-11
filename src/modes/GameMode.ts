import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import { NO_CONTROLS, PlayerControls } from '../core/Controls';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import { World, type DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import { HEROES, RETIRED_HEROES, type HeroEntry } from '../heroes/registry';
import type { MetaButton, TouchControls, TouchSlot } from '../core/Touch';
import { HUD } from '../ui/HUD';
import type { MatchResult } from '../ui/screens/Scoreboard';
import { Arena } from '../world/Arena';
import type { MapDef } from '../world/maps';

/**
 * Comptes à rebours de départ (s) :
 * - Partie rapide (Contrôle, Escorte) : 10 s, portes des spawns fermées ;
 *   en Contrôle, il revient au début de chaque manche.
 * - Deathmatch : 3 s. Champ de tir : aucun.
 */
export const START_COUNTDOWN = 10;
export { DEATHMATCH_COUNTDOWN } from './rules';

export type ModeKind = 'practice' | 'deathmatch' | 'control' | 'escort';

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
  /** Commandes tactiles en cours (sticks et boutons à dessiner), sinon absent. */
  touch?: TouchControls;
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
  /** « Quitter la partie » (menu Échap) : le jeu quitte le mode. */
  exitRequested = false;
  /** Échap pressé : le jeu ouvre le menu (Revenir au jeu, Options, Quitter la partie). */
  pauseRequested = false;
  /** H au champ de tir : retour à la sélection du héros. */
  heroSelectRequested = false;
  /** Temps restant avant le début de la partie. */
  countdown = START_COUNTDOWN;

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
    input.touch.resetTouches();
    this.player = entry.create();
    this.player.controls = this.playerControls;
    this.player.isLocalPlayer = true;
    this.player.outline = COLORS.ally;
    // Aide des touches (en haut à gauche) : seulement au champ de tir (voir PracticeMode).
    this.hud.showHelp = false;
  }

  /** La partie est terminée (fin du chrono en Deathmatch). */
  get finished(): boolean {
    return false;
  }

  update(dt: number): void {
    if (!this.handleMetaKeys()) return;
    this.sampleControls(dt);

    this.countdown = Math.max(0, this.countdown - dt);

    if (!this.simulationPaused()) {
      this.beforeWorld(dt);
      this.world.update(dt);
    }
    this.afterWorld(dt);
    this.hud.update(dt);
  }

  /** Échap (menu), X (hitbox) et touches du mode. false : le menu s'ouvre, l'image s'arrête là. */
  protected handleMetaKeys(): boolean {
    const input = this.input;
    this.player.controls = this.uiOpen ? NO_CONTROLS : this.playerControls;
    if (!this.uiOpen && input.wasPressed('Escape')) {
      this.pauseRequested = true;
      return false;
    }
    if (input.wasPressed('KeyX')) this.showHitboxes = !this.showHitboxes;
    this.handleKeys();
    return true;
  }

  /** Lit le clavier / la souris ou les commandes tactiles dans `playerControls` (visée comprise). */
  protected sampleControls(dt: number): void {
    const input = this.input;
    // Commandes tactiles (téléphone) : sticks et boutons, visée au doigt.
    const touch = input.touch;
    const p = this.player;
    const slots: TouchSlot[] = p.abilitySlots().map((s) => s.input);
    if (p.hasQuickMelee()) slots.push('melee');
    if (p.weaponHud().magSize !== undefined) slots.push('reload');
    touch.update({
      width: this.camera.viewW,
      height: this.camera.viewH,
      player: p,
      targets: this.world.ctx.targets,
      arena: this.arena,
      slots,
      hints: [...HEROES, ...RETIRED_HEROES].find((e) => e.name === p.name)?.touch ?? {},
      meta: this.touchMeta(),
      dt,
    });
    const aim = touch.active ? touch.aimPoint(p) : this.camera.screenToWorld(input.mouseX, input.mouseY);
    this.playerControls.sample(aim.x, aim.y);
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
  /** Boutons tactiles en haut à gauche (touches simulées) : menu, et ceux propres au mode. */
  protected touchMeta(): MetaButton[] {
    return [{ code: 'Escape', label: '☰' }];
  }
  /** Avant la simulation (ex. IA des bots). */
  protected beforeWorld(_dt: number): void {}
  /** Après la simulation (ex. chrono). */
  protected afterWorld(_dt: number): void {}

  protected abstract respawnPoint(hero: Hero): Vec2;
  protected onDamage(_e: DamageEvent): void {}

  /** HUD propre au mode, en espace écran. */
  abstract drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void;
}
