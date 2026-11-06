import type { BrainWorld } from '../ai/HeroBrain';
import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import { randRange, type Vec2 } from '../core/math';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import {
  drawControlBar,
  drawControlPoint,
  drawObjectiveMarker,
  drawRoundIntro,
  drawRoundOverlay,
  type Side,
} from '../ui/ControlHud';
import type { MatchResult } from '../ui/screens/Scoreboard';
import type { ControlPointDef, MapDef } from '../world/maps';
import type { ScreenInfo } from './GameMode';
import { TeamMatchMode } from './TeamMatchMode';

export const CONTROL = {
  /** Temps de capture pour un joueur seul sur le point (s). */
  captureTime: 8,
  /** Chaque joueur supplémentaire sur le point capture 50 % plus vite. */
  extraCapturerBonus: 0.5,
  /** Une capture abandonnée retombe (par seconde)… */
  decayRate: 0.12,
  /** …et plus vite si le propriétaire revient sur le point. */
  ownerRevertRate: 0.5,
  /** % gagnés par seconde par l'équipe qui possède le point. */
  scoreRate: 1,
  roundsToWin: 2,
  /** Écran de transition entre deux manches (s). */
  intermission: 3,
  /** Bandeau « MANCHE n » en début de manche (s). */
  roundIntro: 1.6,
};

type Phase = 'playing' | 'intermission' | 'over';

const side = (team: Team | null): Side | null => (team === ALLY ? 'blue' : team === ENEMY ? 'red' : null);

/**
 * Contrôle (2 contre 2) — capture et tenue d'un point central, en 2 manches gagnantes.
 * Équipe bleue : le joueur + 1 bot · Équipe rouge : 2 bots. Aucun héros en double dans une équipe.
 */
export class ControlMode extends TeamMatchMode {
  readonly kind = 'control';
  readonly point: ControlPointDef;
  owner: Team | null = null;
  /** Équipe dont la capture est en cours, et sa progression (0..1). */
  capturer: Team | null = null;
  progress = 0;
  contested = false;
  overtime = false;
  readonly percent: Record<Team, number> = { [ALLY]: 0, [ENEMY]: 0 };
  readonly roundsWon: Record<Team, number> = { [ALLY]: 0, [ENEMY]: 0 };
  round = 1;
  phase: Phase = 'playing';
  private phaseTimer = 0;
  private roundWinner: Team | null = null;
  private introTimer = CONTROL.roundIntro;
  private captureFlash: { team: Team; age: number } | null = null;

  constructor(map: MapDef, camera: Camera, input: Input, entry: HeroEntry) {
    super(map, camera, input, entry);
    if (!map.control) throw new Error(`La carte ${map.id} n'a pas de point de contrôle`);
    this.point = map.control;
    this.startRound();
  }

  override get finished(): boolean {
    return this.phase === 'over';
  }

  // ------------------------------------------------------------ manches

  private spawnPoints(team: Team): Vec2[] {
    return this.map.spawns[team] ?? [this.point];
  }

  /** Début de manche : point neutre, pourcentages à zéro, tout le monde au spawn, PV et compétences à neuf. */
  private startRound(): void {
    this.owner = null;
    this.capturer = null;
    this.progress = 0;
    this.contested = false;
    this.overtime = false;
    this.percent[ALLY] = 0;
    this.percent[ENEMY] = 0;
    this.phase = 'playing';
    this.introTimer = CONTROL.roundIntro;
    this.captureFlash = null;
    this.killedBy = null;
    this.world.clearTransient();
    this.packs.reset();

    const used: Record<Team, number> = { [ALLY]: 0, [ENEMY]: 0 };
    for (const p of this.participants) {
      const spawns = this.spawnPoints(p.hero.team);
      const at = spawns[used[p.hero.team]++ % spawns.length];
      p.hero.revive(this.world.ctx, at);
      p.hero.aim = Math.atan2(this.point.y - at.y, this.point.x - at.x);
      p.brain?.reset();
      p.controls?.releaseAll();
    }
  }

  private winRound(team: Team): void {
    this.percent[team] = 100;
    this.roundsWon[team]++;
    this.roundWinner = team;
    this.phase = 'intermission';
    this.phaseTimer = CONTROL.intermission;
    for (const p of this.participants) p.controls?.releaseAll();
  }

  protected override simulationPaused(): boolean {
    return this.phase !== 'playing';
  }

  // ------------------------------------------------------------ boucle

  override canSwap(): boolean {
    return this.phase === 'playing';
  }

  protected override brainWorld(): BrainWorld {
    return {
      arena: this.arena,
      targets: this.world.heroes,
      time: this.world.time,
      objective: { x: this.point.x, y: this.point.y, r: this.point.r, owner: this.owner },
      nav: this.nav,
      healthPacks: this.packs.available(),
    };
  }

  protected override afterWorld(dt: number): void {
    super.afterWorld(dt);
    if (this.captureFlash) {
      this.captureFlash.age += dt;
      if (this.captureFlash.age > 2.2) this.captureFlash = null;
    }

    if (this.phase === 'playing') {
      this.introTimer = Math.max(0, this.introTimer - dt);
      this.packs.update(dt, this.world.heroes, this.world.effects);
      this.updatePoint(dt);
      return;
    }
    if (this.phase === 'intermission') {
      this.phaseTimer -= dt;
      if (this.phaseTimer > 0) return;
      if (Object.values(this.roundsWon).some((n) => n >= CONTROL.roundsToWin)) {
        this.phase = 'over';
      } else {
        this.round++;
        this.startRound();
      }
    }
  }

  /** Héros vivants sur le point, par équipe. */
  private countOnPoint(): Record<Team, number> {
    const n: Record<Team, number> = { [ALLY]: 0, [ENEMY]: 0 };
    for (const h of this.world.heroes) {
      if (h.alive && Math.hypot(h.x - this.point.x, h.y - this.point.y) <= this.point.r) n[h.team]++;
    }
    return n;
  }

  /**
   * Règles du point :
   * - une seule équipe dessus (et le point n'est pas à elle) → elle capture progressivement ;
   *   si l'autre équipe avait commencé une capture, elle doit d'abord l'annuler ;
   * - les deux équipes dessus → contesté, tout est en pause ;
   * - personne → la capture en cours retombe lentement.
   * Le propriétaire gagne 1 % par seconde ; à 99 %, il ne peut pas gagner tant que le point
   * est contesté ou en cours de capture adverse (prolongations).
   */
  private updatePoint(dt: number): void {
    const n = this.countOnPoint();
    this.contested = n[ALLY] > 0 && n[ENEMY] > 0;
    const solo: Team | null = this.contested ? null : n[ALLY] > 0 ? ALLY : n[ENEMY] > 0 ? ENEMY : null;

    if (!this.contested) {
      if (solo && solo !== this.owner) {
        const rate = (1 + (n[solo] - 1) * CONTROL.extraCapturerBonus) / CONTROL.captureTime;
        if (this.capturer && this.capturer !== solo) {
          this.progress = Math.max(0, this.progress - rate * dt);
          if (this.progress === 0) this.capturer = null;
        } else {
          this.capturer = solo;
          this.progress += rate * dt;
          if (this.progress >= 1) this.capture(solo);
        }
      } else if (this.progress > 0) {
        const rate = solo !== null && solo === this.owner ? CONTROL.ownerRevertRate : CONTROL.decayRate;
        this.progress = Math.max(0, this.progress - rate * dt);
        if (this.progress === 0) this.capturer = null;
      }
    }

    const owner = this.owner;
    if (!owner) return;
    const threatened = this.contested || (this.capturer !== null && this.capturer !== owner && this.progress > 0);
    const next = this.percent[owner] + CONTROL.scoreRate * dt;
    if (next >= 100 && threatened) {
      this.percent[owner] = 99.99;
      this.overtime = true;
    } else {
      this.percent[owner] = Math.min(100, next);
      this.overtime = false;
      if (this.percent[owner] >= 100) this.winRound(owner);
    }
  }

  private capture(team: Team): void {
    this.owner = team;
    this.capturer = null;
    this.progress = 0;
    this.overtime = false;
    this.captureFlash = { team, age: 0 };
    const color = team === ALLY ? COLORS.ally : COLORS.enemy;
    this.world.effects.ring(this.point.x, this.point.y, color, this.point.r + 30, 0.6);
    this.world.effects.sparks(this.point.x, this.point.y, color, 30, 360);
  }

  // ------------------------------------------------------------ règles

  protected respawnPoint(hero: Hero): Vec2 {
    const spawns = this.spawnPoints(hero.team);
    const p = spawns[Math.floor(Math.random() * spawns.length)];
    return { x: p.x + randRange(-10, 10), y: p.y + randRange(-10, 10) };
  }

  override result(): MatchResult {
    return {
      kind: 'control',
      rows: this.scoreRows(),
      won: this.roundsWon[ALLY] >= CONTROL.roundsToWin,
      rounds: { blue: this.roundsWon[ALLY], red: this.roundsWon[ENEMY] },
    };
  }

  // ------------------------------------------------------------ rendu

  protected override drawGround(ctx: CanvasRenderingContext2D, time: number): void {
    drawControlPoint(ctx, this.point, time, {
      owner: side(this.owner),
      capturer: side(this.capturer),
      progress: this.progress,
      contested: this.contested,
    });
    this.packs.draw(ctx, time);
  }

  drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void {
    this.hud.draw(ctx, {
      ...s,
      hero: this.player,
      time: this.world.time,
      helpTitle: t('help.title.control', { hero: this.player.name.toUpperCase() }),
      helpFooter: [t('help.control.misc'), t('help.control.misc2'), t('help.hitbox')],
      helpTop: 160,
      deathMessage: this.deathMessage(),
    });
    drawObjectiveMarker(ctx, s, this.point, side(this.owner));
    drawControlBar(ctx, s.width, {
      owner: side(this.owner),
      capturer: side(this.capturer),
      progress: this.progress,
      contested: this.contested,
      overtime: this.overtime,
      percent: { blue: this.percent[ALLY], red: this.percent[ENEMY] },
      rounds: { blue: this.roundsWon[ALLY], red: this.roundsWon[ENEMY] },
      roundsToWin: CONTROL.roundsToWin,
      round: this.round,
      time: this.world.time,
      flash: this.captureFlash ? { side: side(this.captureFlash.team)!, age: this.captureFlash.age } : null,
    });
    this.drawMatchOverlays(ctx, s);

    if (this.player.safe && this.phase === 'playing') {
      ctx.textAlign = 'center';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = '#f5d742';
      ctx.fillText(t('control.swapHint'), s.width / 2, s.height - 200);
    }
    if (this.phase === 'playing' && this.introTimer > 0) {
      drawRoundIntro(ctx, s.width, s.height, this.round, CONTROL.roundIntro - this.introTimer);
    }
    if (this.phase !== 'playing' && this.roundWinner) {
      const matchOver = Object.values(this.roundsWon).some((n) => n >= CONTROL.roundsToWin);
      drawRoundOverlay(ctx, s.width, s.height, {
        round: this.round,
        winner: side(this.roundWinner)!,
        rounds: { blue: this.roundsWon[ALLY], red: this.roundsWon[ENEMY] },
        countdown: Math.max(0, this.phaseTimer),
        matchOver,
        playerWon: this.roundsWon[ALLY] >= CONTROL.roundsToWin,
      });
    }
  }
}
