import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import type { Hero } from '../heroes/Hero';
import { HEROES, type HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import { drawDeathmatchBar } from '../ui/DeathmatchHud';
import type { MatchResult } from '../ui/screens/Scoreboard';
import { PRACTICE_MAP } from '../world/maps';
import { inVisionRange, lineOfSight } from '../world/Visibility';
import type { ScreenInfo } from './GameMode';
import { BOT_NAMES, MatchMode, shuffle, type Participant } from './MatchMode';

export interface DeathmatchConfig {
  /** Nombre de bots adverses (1 à 7). */
  bots: number;
  /** Durée du match en minutes. */
  minutes: number;
}

export const DM_LIMITS = { minBots: 1, maxBots: 7, durations: [1, 3, 5] } as const;

/** Points de réapparition répartis sur toute la map (hors murs et zone de dégâts). */
export const DM_SPAWNS: Vec2[] = [
  { x: 200, y: 650 },
  { x: 420, y: 420 },
  { x: 420, y: 880 },
  { x: 760, y: 110 },
  { x: 760, y: 1190 },
  { x: 1010, y: 650 },
  { x: 1300, y: 300 },
  { x: 1300, y: 1000 },
  { x: 1620, y: 650 },
  { x: 1900, y: 120 },
  { x: 1900, y: 1180 },
  { x: 1610, y: 1220 },
];

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
    this.remaining = config.minutes * 60;

    // Chacun pour soi : une équipe par participant, tout le monde en rouge pour le joueur.
    this.registerPlayer('p0');
    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < config.bots; i++) {
      const pick = HEROES[Math.floor(Math.random() * HEROES.length)]; // héros tiré au hasard
      this.addBot(pick, `bot${i + 1}`, names[i % names.length], COLORS.enemy);
    }

    // Placement de départ : chacun le plus loin possible des points déjà pris.
    const taken: Vec2[] = [];
    for (const p of shuffle(this.participants)) {
      const free = DM_SPAWNS.filter((sp) => !taken.includes(sp));
      const far = (sp: Vec2) =>
        taken.length ? Math.min(...taken.map((o) => Math.hypot(o.x - sp.x, o.y - sp.y))) : Math.random();
      const best = free.sort((a, b) => far(b) - far(a))[0];
      taken.push(best);
      p.hero.placeAt(best);
    }

    this.world.player = this.player;
    this.world.heroes = this.participants.map((p) => p.hero); // ordre stable (joueur en premier)
  }

  override get finished(): boolean {
    return this.remaining <= 0;
  }

  protected nameColor(p: Participant): string {
    return p.isPlayer ? COLORS.ally : COLORS.hud;
  }

  protected override afterWorld(dt: number): void {
    super.afterWorld(dt);
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.finished) for (const p of this.participants) p.controls?.releaseAll();
  }

  /**
   * Réapparition aléatoire, mais pas sous le nez d'un adversaire :
   * on note chaque point (loin des ennemis, hors de leur vue) et on tire parmi les 3 meilleurs.
   */
  protected respawnPoint(hero: Hero): Vec2 {
    const foes = this.participants.map((p) => p.hero).filter((h) => h !== hero && h.alive);
    const scored = DM_SPAWNS.map((sp) => {
      let minD = Infinity;
      let seen = false;
      for (const f of foes) {
        minD = Math.min(minD, Math.hypot(f.x - sp.x, f.y - sp.y));
        if (inVisionRange(f.x, f.y, sp.x, sp.y) && lineOfSight(this.arena, f.x, f.y, sp.x, sp.y)) seen = true;
      }
      const score = (minD === Infinity ? 2000 : minD) - (seen ? 800 : 0) + Math.random() * 250;
      return { sp, score };
    }).sort((a, b) => b.score - a.score);
    return scored[Math.floor(Math.random() * Math.min(3, scored.length))].sp;
  }

  /** Classement : éliminations décroissantes, puis le moins de morts. */
  ranking(): Participant[] {
    return [...this.participants].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
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
  }
}
