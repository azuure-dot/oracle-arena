import { createBrain } from '../ai/brains';
import type { BrainWorld, HeroBrain } from '../ai/HeroBrain';
import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import { BotControls } from '../core/Controls';
import type { Input } from '../core/Input';
import type { Vec2 } from '../core/math';
import type { DamageEvent } from '../game/World';
import type { Hero } from '../heroes/Hero';
import { HEROES, type HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import { DeathmatchHud } from '../ui/DeathmatchHud';
import type { Arena } from '../world/Arena';
import { inVisionRange, lineOfSight } from '../world/Visibility';
import { GameMode, type ScreenInfo } from './GameMode';

export interface DeathmatchConfig {
  /** Nombre de bots adverses (1 à 7). */
  bots: number;
  /** Durée du match en minutes. */
  minutes: number;
}

export const DM_LIMITS = { minBots: 1, maxBots: 7, durations: [1, 3, 5] } as const;

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

const BOT_NAMES = ['Nova', 'Vex', 'Krono', 'Echo', 'Rook', 'Zéphyr', 'Pulse', 'Onyx'];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deathmatch chacun pour soi : le joueur contre N bots héros (tous ennemis entre eux).
 * 1 élimination = 1 point · réapparition 3 s à un point aléatoire · fin au bout du chrono.
 */
export class DeathmatchMode extends GameMode {
  readonly kind = 'deathmatch';
  readonly participants: Participant[] = [];
  /** Temps restant (s). */
  remaining: number;
  readonly feed: KillFeedEntry[] = [];
  private killedBy: Participant | null = null;
  /** Dernière élimination du joueur (bandeau « ÉLIMINATION »). */
  private lastKill: { victim: Participant; age: number } | null = null;
  private readonly dmHud = new DeathmatchHud();

  constructor(
    arena: Arena,
    camera: Camera,
    input: Input,
    entry: HeroEntry,
    readonly config: DeathmatchConfig,
  ) {
    super(arena, camera, input, entry);
    this.remaining = config.minutes * 60;

    // Chacun pour soi : une équipe par participant.
    this.player.team = 'p0';
    this.participants.push({
      hero: this.player,
      name: '',
      isPlayer: true,
      kills: 0,
      deaths: 0,
      brain: null,
      controls: null,
    });

    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < config.bots; i++) {
      const pick = HEROES[Math.floor(Math.random() * HEROES.length)]; // héros tiré au hasard
      const hero = pick.create();
      const controls = new BotControls();
      hero.team = `bot${i + 1}`;
      hero.controls = controls;
      hero.outline = COLORS.enemy; // tout le monde est un adversaire
      hero.label = names[i % names.length];
      this.participants.push({
        hero,
        name: hero.label,
        isPlayer: false,
        kills: 0,
        deaths: 0,
        brain: createBrain(hero, controls),
        controls,
      });
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
    this.world.bots = [];
  }

  override get finished(): boolean {
    return this.remaining <= 0;
  }

  displayName(p: Participant): string {
    return p.isPlayer ? t('score.you') : p.name;
  }

  private brainWorld(): BrainWorld {
    return { arena: this.world.arena, targets: this.world.heroes, time: this.world.time };
  }

  // ------------------------------------------------------------ boucle

  protected override beforeWorld(dt: number): void {
    const bw = this.brainWorld();
    for (const p of this.participants) p.brain?.update(dt, bw);
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

    this.remaining = Math.max(0, this.remaining - dt);
    if (this.finished) for (const p of this.participants) p.controls?.releaseAll();
  }

  // ------------------------------------------------------------ règles

  private participantOf(target: unknown): Participant | undefined {
    return this.participants.find((p) => p.hero === target);
  }

  protected override onDamage(e: DamageEvent): void {
    const victim = this.participantOf(e.target);
    if (!victim) return;
    victim.brain?.onDamaged(e.source, this.brainWorld());
    if (e.source === this.player && e.target !== this.player) this.hud.onHit(e.killed);
    if (!e.killed) return;

    victim.deaths++;
    const killer = e.source && e.source !== e.target ? (this.participantOf(e.source) ?? null) : null;
    if (killer) killer.kills++; // 1 élimination = 1 point
    this.feed.unshift({ killer, victim, age: 0 });
    if (this.feed.length > 5) this.feed.pop();
    if (victim.isPlayer) this.killedBy = killer;
    if (killer?.isPlayer) this.lastKill = { victim, age: 0 };
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
        if (inVisionRange(f.x, f.y, sp.x, sp.y) && lineOfSight(this.world.arena, f.x, f.y, sp.x, sp.y)) seen = true;
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

  get playerEntry(): Participant {
    return this.participants[0];
  }

  // ------------------------------------------------------------ HUD

  drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void {
    const killer = this.player.dead ? this.killedBy : null;
    this.hud.draw(ctx, {
      ...s,
      hero: this.player,
      time: this.world.time,
      helpTitle: t('help.title.dm', { hero: this.player.name.toUpperCase() }),
      helpFooter: [t('help.dm.misc'), t('help.hitbox')],
      deathMessage: killer ? t('hud.dm.killedBy', { name: `${killer.name} (${killer.hero.name})` }) : undefined,
    });
    this.dmHud.draw(ctx, s.width, s.height, {
      remaining: this.remaining,
      kills: this.playerEntry.kills,
      rank: this.rankOf(this.playerEntry),
      total: this.participants.length,
      feed: this.feed.map((e) => ({
        killer: e.killer ? { name: this.displayName(e.killer), hero: e.killer.hero.name, isPlayer: e.killer.isPlayer } : null,
        victim: { name: this.displayName(e.victim), hero: e.victim.hero.name, isPlayer: e.victim.isPlayer },
        age: e.age,
      })),
      lastKill: this.lastKill ? { name: this.lastKill.victim.name, age: this.lastKill.age } : null,
    });
  }
}
