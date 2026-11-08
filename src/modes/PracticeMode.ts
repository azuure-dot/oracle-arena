import { PLAYER_SPAWN } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import { Bot, type BotOptions } from '../entities/Bot';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import type { DamageEvent } from '../game/World';
import type { HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import { drawCountdown } from '../ui/matchHud';
import { Stats } from '../ui/Stats';
import { PRACTICE_MAP } from '../world/maps';
import { GameMode, type ScreenInfo } from './GameMode';

/** Les cibles, tourelles et alliés du champ de tir (aussi utilisés en fond des menus). */
export function createRangeBots(): Bot[] {
  const faceSpawn = (x: number, y: number) => Math.atan2(PLAYER_SPAWN.y - y, PLAYER_SPAWN.x - x);
  const bot = (team: Team, x: number, y: number, extra: Partial<BotOptions> = {}) =>
    new Bot({ team, x, y, facing: faceSpawn(x, y), ...extra });

  return [
    // Cibles immobiles
    bot(ENEMY, 760, 650),
    bot(ENEMY, 1000, 650), // dans la salle centrale
    bot(ENEMY, 1350, 400),
    bot(ENEMY, 1350, 900),
    bot(ENEMY, 1715, 650), // collé au mur du fond : parfait pour la Charge
    // Cachées derrière des murs : à débusquer en contournant
    bot(ENEMY, 1880, 650),
    bot(ENEMY, 1600, 100),
    // Tourelles : tirent seulement si elles VOIENT le joueur
    bot(ENEMY, 1300, 650, { kind: 'turret' }),
    bot(ENEMY, 1600, 300, { kind: 'turret' }),
    // Alliés (invulnérables à nos tirs) — deux blessés pour tester les soins
    bot(ALLY, 450, 300, { wounded: true }),
    bot(ALLY, 450, 1000, { wounded: true }),
    bot(ALLY, 1250, 1000),
    // Patrouilles
    bot(ENEMY, 700, 120, { patrol: { ax: 700, ay: 120, bx: 1350, by: 120 } }),
    bot(ENEMY, 1950, 250, { patrol: { ax: 1950, ay: 250, bx: 1950, by: 1050 } }),
    bot(ALLY, 700, 1200, { patrol: { ax: 700, ay: 1200, bx: 1350, by: 1200 } }),
  ];
}

/** Champ de tir : cibles, tourelles, alliés, stats de DPS. */
export class PracticeMode extends GameMode {
  readonly kind = 'practice';
  private readonly stats = new Stats();

  constructor(camera: Camera, input: Input, entry: HeroEntry) {
    super(PRACTICE_MAP, camera, input, entry);
    this.countdown = 0; // champ de tir : on joue tout de suite
    this.player.team = ALLY;
    this.player.placeAt(PLAYER_SPAWN);
    this.world.player = this.player;
    this.world.heroes = [this.player];
    this.world.bots = createRangeBots();
  }

  protected override handleKeys(): void {
    if (this.input.wasPressed('KeyT')) this.stats.reset();
    if (this.input.wasPressed('KeyB')) this.world.turretsEnabled = !this.world.turretsEnabled;
  }

  /** Pas de salle de spawn : tout est figé pendant le compte à rebours. */
  protected override simulationPaused(): boolean {
    return this.countdown > 0;
  }

  protected respawnPoint(): Vec2 {
    return PLAYER_SPAWN;
  }

  protected override onDamage(e: DamageEvent): void {
    if (e.source !== this.player || e.target === this.player) return;
    this.stats.record(this.world.time, e.dealt, e.killed);
    this.hud.onHit(e.killed);
  }

  drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void {
    this.hud.draw(ctx, {
      ...s,
      hero: this.player,
      time: this.world.time,
      stats: this.stats,
      turretsEnabled: this.world.turretsEnabled,
      helpTitle: t('help.title', { hero: this.player.name.toUpperCase() }),
      helpFooter: [t('help.misc1'), t('help.misc2'), t('help.hitbox')],
    });
    if (this.countdown > 0) drawCountdown(ctx, s.width, s.height, t('start.countdown'), this.countdown);
  }
}
