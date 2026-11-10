import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import type { Hero } from '../heroes/Hero';
import { HEROES, type HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import { drawDeathmatchBar } from '../ui/DeathmatchHud';
import { drawCountdown } from '../ui/matchHud';
import type { MatchResult } from '../ui/screens/Scoreboard';
import { PRACTICE_MAP } from '../world/maps';
import { DEATHMATCH_COUNTDOWN, type ScreenInfo } from './GameMode';
import { BOT_NAMES, MatchMode, shuffle, type Participant } from './MatchMode';
import { pickDeathmatchSpawn, placeDeathmatchStart, rankDeathmatch } from './rules';

export interface DeathmatchConfig {
  /** Nombre de bots adverses (1 à 7). */
  bots: number;
  /** Durée du match en minutes. */
  minutes: number;
}

export const DM_LIMITS = { minBots: 1, maxBots: 7, durations: [1, 3, 5] } as const;

/** Points de réapparition : voir rules.ts (partagé avec le serveur multijoueur). */
export { DM_SPAWNS } from './rules';

/**
 * Deathmatch chacun pour soi : le joueur contre N bots héros (tous ennemis entre eux).
 * 1 élimination = 1 point · réapparition 3 s à un point aléatoire · fin au bout du chrono.
 */
export class DeathmatchMode extends MatchMode {
  readonly kind = 'deathmatch';
  /** Temps restant (s). */
  remaining: number;

  constructor(camera: Camera, input: Input, entry: HeroEntry, readonly config: DeathmatchConfig) {
    super(PRACTICE_MAP, camera, input, entry);
    this.countdown = DEATHMATCH_COUNTDOWN;
    this.remaining = config.minutes * 60;

    // Chacun pour soi : une équipe par participant, tout le monde en rouge pour le joueur.
    this.registerPlayer('p0');
    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < config.bots; i++) {
      const pick = HEROES[Math.floor(Math.random() * HEROES.length)]; // héros tiré au hasard
      this.addBot(pick, `bot${i + 1}`, names[i % names.length], COLORS.enemy);
    }

    placeDeathmatchStart(this.participants.map((p) => p.hero));

    this.world.player = this.player;
    this.world.heroes = this.participants.map((p) => p.hero); // ordre stable (joueur en premier)
  }

  override get finished(): boolean {
    return this.remaining <= 0;
  }

  protected nameColor(p: Participant): string {
    return p.isPlayer ? COLORS.ally : COLORS.hud;
  }

  /** Pas de salle de spawn : tout est figé pendant le compte à rebours. */
  protected override simulationPaused(): boolean {
    return this.countdown > 0;
  }

  protected override afterWorld(dt: number): void {
    super.afterWorld(dt);
    if (this.countdown > 0) return; // le chrono du match démarre après le compte à rebours
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.finished) for (const p of this.participants) p.controls?.releaseAll();
  }

  /** Réapparition aléatoire, mais pas sous le nez d'un adversaire (voir rules.ts). */
  protected respawnPoint(hero: Hero): Vec2 {
    return pickDeathmatchSpawn(this.arena, hero, this.participants.map((p) => p.hero));
  }

  /** Classement : éliminations décroissantes, puis le moins de morts. */
  ranking(): Participant[] {
    return rankDeathmatch(this.participants);
  }

  /** Rang (les ex aequo partagent la même place). */
  rankOf(p: Participant): number {
    return 1 + this.participants.filter((q) => q.kills > p.kills).length;
  }

  override result(): MatchResult {
    const you = this.playerEntry;
    const playerRank = this.rankOf(you);
    return {
      kind: 'deathmatch',
      rows: this.ranking().map((p) => ({
        rank: this.rankOf(p),
        name: p.isPlayer ? null : p.name,
        hero: p.hero.name,
        heroColor: p.hero.stats.color,
        kills: p.kills,
        deaths: p.deaths,
      })),
      playerRank,
      playerWon: playerRank === 1 && this.participants.every((p) => p === you || p.kills < you.kills),
    };
  }

  // ------------------------------------------------------------ HUD

  drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void {
    this.hud.draw(ctx, {
      ...s,
      hero: this.player,
      time: this.world.time,
      helpTitle: t('help.title.dm', { hero: this.player.name.toUpperCase() }),
      helpFooter: [t('help.dm.misc'), t('help.hitbox')],
      helpTop: 110,
      deathMessage: this.deathMessage(),
    });
    drawDeathmatchBar(ctx, s.width, {
      remaining: this.remaining,
      kills: this.playerEntry.kills,
      rank: this.rankOf(this.playerEntry),
      total: this.participants.length,
    });
    this.drawMatchOverlays(ctx, s);
    if (this.countdown > 0) drawCountdown(ctx, s.width, s.height, t('start.countdown'), this.countdown);
  }
}
