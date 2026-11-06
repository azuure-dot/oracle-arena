import { createBrain } from '../ai/brains';
import type { BrainWorld, HeroBrain } from '../ai/HeroBrain';
import { BotControls } from '../core/Controls';
import type { DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import type { Team } from '../entities/Team';
import { t } from '../i18n';
import { drawKillBanner, drawKillFeed, type FeedName } from '../ui/matchHud';
import { GameMode, type ScreenInfo } from './GameMode';

export interface Participant {
  hero: Hero;
  /** Nom propre du bot (le joueur est affiché « Toi » / « You »). */
  name: string;
  isPlayer: boolean;
  kills: number;
  deaths: number;
  brain: HeroBrain | null;
  controls: BotControls | null;
}

export interface KillFeedEntry {
  killer: Participant | null; // null : mort dans la zone de dégâts
  victim: Participant;
  age: number;
}

export const BOT_NAMES = ['Nova', 'Vex', 'Krono', 'Echo', 'Rook', 'Zéphyr', 'Pulse', 'Onyx'];

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Base des matchs contre des bots héros (Deathmatch, Contrôle) :
 * participants, éliminations / morts, fil des éliminations, IA des bots.
 */
export abstract class MatchMode extends GameMode {
  readonly participants: Participant[] = [];
  readonly feed: KillFeedEntry[] = [];
  protected killedBy: Participant | null = null;
  /** Dernière élimination du joueur (bandeau « ÉLIMINATION »). */
  protected lastKill: { victim: Participant; age: number } | null = null;

  /** Le joueur est toujours le premier participant. */
  protected registerPlayer(team: Team): void {
    this.player.team = team;
    this.participants.push({
      hero: this.player,
      name: '',
      isPlayer: true,
      kills: 0,
      deaths: 0,
      brain: null,
      controls: null,
    });
  }

  protected addBot(entry: HeroEntry, team: Team, name: string, outline: string): Participant {
    const hero = entry.create();
    const controls = new BotControls();
    hero.team = team;
    hero.controls = controls;
    hero.outline = outline;
    hero.label = name;
    const p: Participant = {
      hero,
      name,
      isPlayer: false,
      kills: 0,
      deaths: 0,
      brain: createBrain(hero, controls),
      controls,
    };
    this.participants.push(p);
    return p;
  }

  get playerEntry(): Participant {
    return this.participants[0];
  }

  displayName(p: Participant): string {
    return p.isPlayer ? t('score.you') : p.name;
  }

  /** Couleur du nom dans le fil des éliminations. */
  protected abstract nameColor(p: Participant): string;

  protected brainWorld(): BrainWorld {
    return { arena: this.arena, targets: this.world.heroes, time: this.world.time };
  }

  protected participantOf(target: unknown): Participant | undefined {
    return this.participants.find((p) => p.hero === target);
  }

  // ------------------------------------------------------------ boucle

  protected override beforeWorld(dt: number): void {
    const bw = this.brainWorld();
    for (const p of this.participants) {
      if (!p.brain) continue;
      if (this.brainActive(p)) p.brain.update(dt, bw);
      else p.controls?.releaseAll(); // bot en attente (porte de spawn fermée) : il ne bouge pas
    }
  }

  /** Le bot joue-t-il cette frame ? (non tant que sa porte de spawn est fermée) */
  protected brainActive(_p: Participant): boolean {
    return true;
  }

  protected override afterWorld(dt: number): void {
    for (const p of this.participants) p.controls?.endFrame();
    for (const e of this.feed) e.age += dt;
    while (this.feed.length && this.feed[this.feed.length - 1].age > 6) this.feed.pop();
    if (this.lastKill) {
      this.lastKill.age += dt;
      if (this.lastKill.age > 1.6) this.lastKill = null;
    }
    if (this.player.alive) this.killedBy = null;
  }

  protected override onDamage(e: DamageEvent): void {
    const victim = this.participantOf(e.target);
    if (!victim) return;
    victim.brain?.onDamaged(e.source, this.brainWorld());
    if (e.source === this.player && e.target !== this.player) this.hud.onHit(e.killed);
    if (!e.killed) return;

    victim.deaths++;
    const killer = e.source && e.source !== e.target ? (this.participantOf(e.source) ?? null) : null;
    if (killer) killer.kills++;
    this.feed.unshift({ killer, victim, age: 0 });
    if (this.feed.length > 5) this.feed.pop();
    if (victim.isPlayer) this.killedBy = killer;
    if (killer?.isPlayer) this.lastKill = { victim, age: 0 };
  }

  // ------------------------------------------------------------ HUD

  /** « Éliminé par Vex (Flux) » sous le compte à rebours de réapparition. */
  protected deathMessage(): string | undefined {
    const k = this.player.dead ? this.killedBy : null;
    return k ? t('hud.dm.killedBy', { name: `${k.name} (${k.hero.name})` }) : undefined;
  }

  /** Fil des éliminations + bandeau d'élimination. */
  protected drawMatchOverlays(ctx: CanvasRenderingContext2D, s: ScreenInfo, feedTop = 30): void {
    const name = (p: Participant): FeedName => ({
      name: this.displayName(p),
      hero: p.hero.name,
      color: this.nameColor(p),
    });
    drawKillFeed(
      ctx,
      s.width,
      this.feed.map((e) => ({
        killer: e.killer ? name(e.killer) : null,
        victim: name(e.victim),
        highlight: !!(e.killer?.isPlayer || e.victim.isPlayer),
        age: e.age,
      })),
      feedTop,
    );
    drawKillBanner(ctx, s.width, s.height, this.lastKill ? { name: this.lastKill.victim.name, age: this.lastKill.age } : null);
  }
}
