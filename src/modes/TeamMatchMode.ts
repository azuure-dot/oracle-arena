import type { MetaButton } from '../core/Touch';
import { NavGraph } from '../ai/nav';
import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import { HealthPacks } from '../game/HealthPacks';
import { HEROES, type HeroEntry } from '../heroes/registry';
import type { ScoreRow } from '../ui/screens/Scoreboard';
import { drawCountdown } from '../ui/matchHud';
import { t } from '../i18n';
import type { MapDef } from '../world/maps';
import { BOT_NAMES, MatchMode, shuffle, type Participant } from './MatchMode';

/**
 * Base des modes en équipe (2 contre 2) : Contrôle, Escorte.
 * - Bleu : le joueur + 1 bot · Rouge : 2 bots · aucun héros en double dans une équipe.
 * - Zones de spawn : invincible + soin à 100 % pour son équipe, changement de héros (C).
 * - Packs de soin et graphe de navigation de la carte.
 */
/** Délai de réapparition en Partie rapide (s). */
export const QUICKPLAY_RESPAWN = 8;

export abstract class TeamMatchMode extends MatchMode {
  /** Le joueur a demandé à changer de héros (touche C dans son spawn). */
  swapRequested = false;
  protected readonly packs: HealthPacks;
  readonly nav: NavGraph;

  constructor(map: MapDef, camera: Camera, input: Input, entry: HeroEntry) {
    super(map, camera, input, entry);

    // Équipes sans doublon : l'allié prend un autre héros que le joueur, les deux ennemis sont différents.
    this.registerPlayer(ALLY);
    const names = shuffle(BOT_NAMES);
    const allyEntry = shuffle(HEROES.filter((h) => h.id !== entry.id))[0];
    const [red1, red2] = shuffle(HEROES);
    this.addBot(allyEntry, ALLY, names[0], COLORS.ally);
    this.addBot(red1, ENEMY, names[1], COLORS.enemy);
    this.addBot(red2, ENEMY, names[2], COLORS.enemy);

    this.world.player = this.player;
    this.world.heroes = this.participants.map((p) => p.hero);
    this.nav = new NavGraph(this.arena, map.nav);
    this.packs = new HealthPacks(map.healthPacks);
    this.world.respawnDelay = QUICKPLAY_RESPAWN;
  }

  /** Équipes dont les portes de spawn sont fermées (compte à rebours de départ). */
  protected lockedTeams(): Team[] {
    return this.countdown > 0 ? [ALLY, ENEMY] : [];
  }

  protected override brainActive(p: Participant): boolean {
    return !this.lockedTeams().includes(p.hero.team);
  }

  /** Compte à rebours de départ, en haut de l'écran. */
  protected drawStartCountdown(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.countdown > 0) drawCountdown(ctx, width, height, t('start.doors'), this.countdown);
  }

  /** Le changement de héros est-il possible maintenant ? (pas pendant une transition) */
  canSwap(): boolean {
    return true;
  }

  /** Dans le spawn : bouton tactile de changement de héros (touche C). */
  protected override touchMeta(): MetaButton[] {
    const base = super.touchMeta();
    return this.player.safe && this.canSwap() ? [...base, { code: 'KeyC', label: '⇄' }] : base;
  }

  protected override handleKeys(): void {
    if (this.input.wasPressed('KeyC') && this.player.safe && this.canSwap()) this.swapRequested = true;
  }

  protected nameColor(p: Participant): string {
    return p.hero.team === ALLY ? COLORS.ally : COLORS.enemy;
  }

  /** Zone de spawn de son équipe : invincible et soigné à 100 %. */
  protected applySafeZones(): void {
    for (const p of this.participants) {
      const h = p.hero;
      h.safe = h.alive && this.arena.safeZoneAt(h.x, h.y)?.team === h.team;
      if (h.safe) h.heal(h.maxHp);
    }
  }

  protected override beforeWorld(dt: number): void {
    this.arena.lockSpawnDoors(this.lockedTeams());
    this.applySafeZones();
    super.beforeWorld(dt);
  }

  /** Héros déjà pris par les coéquipiers du joueur (interdits au changement de héros). */
  takenByAllies(): string[] {
    return this.participants.filter((p) => !p.isPlayer && p.hero.team === this.player.team).map((p) => p.hero.name);
  }

  /** Changement de héros dans le spawn : nouveau héros au même endroit, PV au max. */
  swapPlayerHero(entry: HeroEntry): void {
    this.swapRequested = false;
    const old = this.player;
    if (entry.name === old.name || this.takenByAllies().includes(entry.name)) return;
    const hero = entry.create();
    hero.team = old.team;
    hero.isLocalPlayer = true;
    hero.outline = old.outline;
    hero.controls = this.playerControls;
    hero.placeAt(old);
    hero.aim = old.aim;
    old.dead = true; // l'ancien héros disparaît (les bots qui le visaient l'oublient)
    this.playerEntry.hero = hero;
    this.player = hero;
    this.world.player = hero;
    this.world.heroes = this.participants.map((p) => p.hero);
    this.world.effects.ring(hero.x, hero.y, hero.stats.color, 50, 0.4);
  }

  /** Lignes du tableau des scores, par équipe. */
  protected scoreRows(): ScoreRow[] {
    return this.participants.map((p) => ({
      name: p.isPlayer ? null : p.name,
      hero: p.hero.name,
      heroColor: p.hero.stats.color,
      kills: p.kills,
      deaths: p.deaths,
      team: p.hero.team === ALLY ? 'blue' : 'red',
    }));
  }

  /** Couleur d'une équipe. */
  protected teamColor(team: Team): string {
    return team === ALLY ? COLORS.ally : COLORS.enemy;
  }
}
