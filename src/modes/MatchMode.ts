import { createBrain } from '../ai/brains';
import type { BrainWorld, HeroBrain } from '../ai/HeroBrain';
import { BotControls } from '../core/Controls';
import type { DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import type { Team } from '../entities/Team';
import { t } from '../i18n';
import { drawKillBanner, drawKillFeed, type FeedName } from '../ui/matchHud';
import type { MetaButton } from '../core/Touch';
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
  /** Mort dans la lave. */
  lava?: boolean;
}

// Règles pures (partagées avec le serveur multijoueur) : voir rules.ts.
export { BOT_DAMAGE_MULTIPLIER, BOT_NAMES, shuffle } from './rules';
import { BOT_DAMAGE_MULTIPLIER } from './rules';

/**
 * Base des matchs contre des bots héros (Deathmatch, Contrôle) :
 * participants, éliminations / morts, fil des éliminations, IA des bots.
 */
export abstract class MatchMode extends GameMode {
  readonly participants: Participant[] = [];
  readonly feed: KillFeedEntry[] = [];
  protected killedBy: Participant | null = null;
  /** Le joueur est mort dans la lave (message de mort). */
  protected killedByLava = false;
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
    hero.damageMultiplier = BOT_DAMAGE_MULTIPLIER;
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

  /** Bouton tactile du tableau des scores (Tab au clavier). */
  protected override touchMeta(): MetaButton[] {
    return [...super.touchMeta(), { code: 'Tab', label: '★' }];
  }

  /** Couleur du nom dans le fil des éliminations. */
  protected abstract nameColor(p: Participant): string;

  protected brainWorld(): BrainWorld {
    // Les leurres (clones de Flux) sont des cibles comme les autres : les bots peuvent s'y laisser prendre.
    return { arena: this.arena, targets: [...this.world.heroes, ...this.world.decoys], time: this.world.time };
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
    if (!victim) {
      // Leurre touché : même retour visuel qu'un vrai héros (sinon le joueur saurait).
      if (e.target.decoy && e.source === this.player) this.hud.onHit(false);
      return;
    }
    victim.brain?.onDamaged(e.source, this.brainWorld());
    if (e.source === this.player && e.target !== this.player) this.hud.onHit(e.killed);
    if (!e.killed) return;

    victim.deaths++;
    const killer = e.source && e.source !== e.target ? (this.participantOf(e.source) ?? null) : null;
    if (killer) killer.kills++;
    const lava = e.cause === 'lava';
    this.feed.unshift({ killer, victim, age: 0, lava });
    if (this.feed.length > 5) this.feed.pop();
    if (victim.isPlayer) {
      this.killedBy = killer;
      this.killedByLava = lava;
    }
    if (killer?.isPlayer) this.lastKill = { victim, age: 0 };
  }

  // ------------------------------------------------------------ HUD

  /** « Éliminé par Vex (Flux) » sous le compte à rebours de réapparition. */
  protected deathMessage(): string | undefined {
    if (!this.player.dead) return undefined;
    const k = this.killedBy;
    const name = k ? `${k.name} (${k.hero.name})` : '';
    if (this.killedByLava) return k ? t('hud.lava.pushedBy', { name }) : t('hud.lava.fell');
    return k ? t('hud.dm.killedBy', { name }) : undefined;
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
        lava: e.lava,
        age: e.age,
      })),
      feedTop,
    );
    drawKillBanner(ctx, s.width, s.height, this.lastKill ? { name: this.lastKill.victim.name, age: this.lastKill.age } : null);
  }
}
