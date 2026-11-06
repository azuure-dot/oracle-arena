import type { BrainWorld } from '../ai/HeroBrain';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import { randRange, type Vec2 } from '../core/math';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import { PAYLOAD, Payload } from '../game/Payload';
import type { Hero } from '../heroes/Hero';
import type { HeroEntry } from '../heroes/registry';
import { t } from '../i18n';
import { drawObjectiveMarker } from '../ui/ControlHud';
import { drawEscortBanner, drawEscortBar, drawEscortEnd } from '../ui/EscortHud';
import { drawCountdown } from '../ui/matchHud';
import type { MatchResult } from '../ui/screens/Scoreboard';
import type { EscortDef, MapDef, SpawnRoom } from '../world/maps';
import type { ScreenInfo } from './GameMode';
import { TeamMatchMode } from './TeamMatchMode';

export const ESCORT = {
  /** Durée de chaque phase (s) : 3 minutes, remises à 3:00 au checkpoint. */
  phaseTime: 180,
  /** Prolongations : délai de grâce quand le dernier attaquant quitte le convoi (s). */
  overtimeGrace: 1,
  /** Écran de victoire / défaite avant le tableau des scores (s). */
  endDelay: 3,
  /** Bandeau « ATTAQUE · Escortez le convoi » au début (s). */
  intro: 3,
  /** Bandeau « Checkpoint atteint » (s). */
  checkpointBanner: 2.5,
  /** L'attaque sort de son spawn au bout de 30 s : la défense a le temps de se placer. */
  attackSetup: 30,
};

type State = 'playing' | 'ending' | 'over';

/**
 * Escorte (2 contre 2, asymétrique) : l'attaque pousse le convoi de A à B,
 * la défense doit l'en empêcher avant la fin du temps.
 *
 * Phase 1 : A → checkpoint (attaque au spawn A, défense au spawn du milieu).
 * Phase 2 : checkpoint → B (attaque au spawn du milieu, défense au spawn B), chrono remis à 3:00.
 * À 0:00, si un attaquant touche le convoi : prolongations jusqu'à ce qu'il soit repoussé.
 */
export class EscortMode extends TeamMatchMode {
  readonly kind = 'escort';
  readonly attackTeam: Team;
  readonly defenseTeam: Team;
  readonly payload: Payload;
  phase: 1 | 2 = 1;
  timeLeft = ESCORT.phaseTime;
  overtime = false;
  state: State = 'playing';
  winner: Team | null = null;

  private readonly escort: EscortDef;
  private spawnPoints: Record<Team, Vec2[]> = {};
  private grace = 0;
  private endTimer = 0;
  private introAge = 0;
  /** Temps avant l'ouverture des portes de l'attaque (le chrono de 3:00 démarre ensuite). */
  setupLeft = ESCORT.attackSetup;
  private checkpointAge = -1;

  constructor(map: MapDef, camera: Camera, input: Input, entry: HeroEntry) {
    super(map, camera, input, entry);
    if (!map.escort) throw new Error(`La carte ${map.id} n'a pas de parcours d'escorte`);
    this.escort = map.escort;

    // Attaque et défense tirées au sort.
    this.attackTeam = Math.random() < 0.5 ? ALLY : ENEMY;
    this.defenseTeam = this.attackTeam === ALLY ? ENEMY : ALLY;
    this.payload = new Payload(map.escort.path, map.escort.checkpoint);
    this.applySpawns();

    const used: Record<Team, number> = { [ALLY]: 0, [ENEMY]: 0 };
    for (const p of this.participants) {
      const pts = this.spawnPoints[p.hero.team];
      const at = pts[used[p.hero.team]++ % pts.length];
      p.hero.placeAt(at);
      p.hero.aim = Math.atan2(this.payload.y - at.y, this.payload.x - at.x);
    }
    this.syncPayloadObstacle();
  }

  override get finished(): boolean {
    return this.state === 'over';
  }

  get playerAttacks(): boolean {
    return this.player.team === this.attackTeam;
  }

  override canSwap(): boolean {
    return this.state === 'playing';
  }

  protected override simulationPaused(): boolean {
    return this.state !== 'playing';
  }

  /** Défense : 10 s comme partout · attaque : 30 s. */
  protected override lockedTeams(): Team[] {
    const locked: Team[] = [];
    if (this.countdown > 0) locked.push(this.defenseTeam);
    if (this.setupLeft > 0) locked.push(this.attackTeam);
    return locked;
  }

  // ------------------------------------------------------------ spawns dynamiques

  /** Salles de spawn de la phase en cours (phase 1 : A / milieu · phase 2 : milieu / B). */
  private applySpawns(): void {
    const rooms = this.escort.rooms;
    const att: SpawnRoom = this.phase === 1 ? rooms.start : rooms.mid;
    const def: SpawnRoom = this.phase === 1 ? rooms.mid : rooms.end;
    this.arena.setSafeZones([
      { team: this.attackTeam, rect: att.rect, doors: att.doors },
      { team: this.defenseTeam, rect: def.rect, doors: def.doors },
    ]);
    this.spawnPoints = { [this.attackTeam]: att.points, [this.defenseTeam]: def.points };

    // Un héros resté dans une salle qui devient le spawn adverse est renvoyé dans le sien.
    for (const p of this.participants) {
      const h = p.hero;
      const z = this.arena.safeZoneAt(h.x, h.y);
      if (h.alive && z && z.team !== h.team) h.placeAt(this.respawnPoint(h));
    }
  }

  protected respawnPoint(hero: Hero): Vec2 {
    const pts = this.spawnPoints[hero.team] ?? [this.payload];
    const p = pts[Math.floor(Math.random() * pts.length)];
    return { x: p.x + randRange(-10, 10), y: p.y + randRange(-10, 10) };
  }

  /** Le convoi est un obstacle mobile (déplacements et projectiles). */
  private syncPayloadObstacle(): void {
    this.arena.dynamicRects = [this.payload.rect()];
  }

  // ------------------------------------------------------------ boucle

  protected override brainWorld(): BrainWorld {
    const p = this.payload;
    return {
      arena: this.arena,
      targets: this.world.heroes,
      time: this.world.time,
      nav: this.nav,
      healthPacks: this.packs.available(),
      // L'objectif des bots suit le convoi en temps réel.
      objective: {
        x: p.x,
        y: p.y,
        r: PAYLOAD.pushRadius,
        owner: null,
        attackers: this.attackTeam,
        active: p.attackersIn > 0,
        forward: p.dir,
        cover: PAYLOAD.half,
        holdPoint: p.pointAt(p.dist + 320),
      },
    };
  }

  protected override afterWorld(dt: number): void {
    super.afterWorld(dt);
    if (this.state === 'ending') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.state = 'over';
      return;
    }
    if (this.state === 'over') return;

    this.introAge += dt;
    if (this.checkpointAge >= 0) this.checkpointAge += dt;
    this.packs.update(dt, this.world.heroes, this.world.effects);
    if (this.setupLeft > 0) {
      // Préparation : la défense se place, le convoi et le chrono attendent l'attaque.
      this.setupLeft = Math.max(0, this.setupLeft - dt);
      return;
    }

    // Qui est dans la zone de poussée ?
    let attackers = 0;
    let defenders = 0;
    for (const h of this.world.heroes) {
      if (!h.alive || Math.hypot(h.x - this.payload.x, h.y - this.payload.y) > PAYLOAD.pushRadius) continue;
      if (h.team === this.attackTeam) attackers++;
      else defenders++;
    }
    this.payload.update(dt, attackers, defenders);
    this.syncPayloadObstacle();

    // Checkpoint : chrono remis à 3:00, le convoi ne reculera plus en dessous, les spawns avancent.
    if (this.phase === 1 && this.payload.dist >= this.payload.checkpointDist) {
      this.phase = 2;
      this.timeLeft = ESCORT.phaseTime;
      this.overtime = false;
      this.payload.floor = this.payload.checkpointDist;
      this.applySpawns();
      this.checkpointAge = 0;
      const color = this.teamColor(this.attackTeam);
      this.world.effects.ring(this.payload.x, this.payload.y, color, 120, 0.6);
      this.world.effects.sparks(this.payload.x, this.payload.y, color, 30, 360);
    }

    if (this.payload.delivered) {
      this.end(this.attackTeam);
      return;
    }

    // Fin du temps : prolongations tant qu'un attaquant touche le convoi.
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft > 0) return;
    if (attackers > 0) {
      this.overtime = true;
      this.grace = ESCORT.overtimeGrace;
    } else if (this.overtime && this.grace > 0) {
      this.grace -= dt;
    } else {
      this.end(this.defenseTeam);
    }
  }

  private end(winner: Team): void {
    this.winner = winner;
    this.state = 'ending';
    this.endTimer = ESCORT.endDelay;
    for (const p of this.participants) p.controls?.releaseAll();
  }

  override result(): MatchResult {
    return {
      kind: 'escort',
      rows: this.scoreRows(),
      won: this.winner === this.player.team,
      attack: this.playerAttacks,
      progress: this.payload.progress,
      delivered: this.payload.delivered,
    };
  }

  // ------------------------------------------------------------ rendu

  protected override drawGround(ctx: CanvasRenderingContext2D, time: number): void {
    const color = this.teamColor(this.attackTeam);
    this.payload.drawPath(ctx, color);
    this.packs.draw(ctx, time);
    this.payload.draw(ctx, color, time);
  }

  drawHud(ctx: CanvasRenderingContext2D, s: ScreenInfo): void {
    const attackColor = this.teamColor(this.attackTeam);
    const myColor = this.teamColor(this.player.team);
    this.hud.draw(ctx, {
      ...s,
      hero: this.player,
      time: this.world.time,
      helpTitle: t('help.title.escort', { hero: this.player.name.toUpperCase() }),
      helpFooter: [t('help.control.misc'), t('help.control.misc2'), t('help.hitbox')],
      helpTop: 150,
      deathMessage: this.deathMessage(),
    });
    drawObjectiveMarker(ctx, s, { x: this.payload.x, y: this.payload.y, r: 40 }, this.attackTeam === ALLY ? 'blue' : 'red');
    drawEscortBar(ctx, s.width, {
      timeLeft: this.timeLeft,
      phase: this.phase,
      progress: this.payload.progress,
      checkpoint: this.payload.checkpointDist / this.payload.length,
      status: this.payload.status,
      overtime: this.overtime,
      attackColor,
      roleText: `${t(this.playerAttacks ? 'escort.attack' : 'escort.defense')} · ${t(this.playerAttacks ? 'escort.goalAttack' : 'escort.goalDefense')}`,
      roleColor: myColor,
      time: this.world.time,
    });
    this.drawMatchOverlays(ctx, s);

    if (this.player.safe && this.state === 'playing') {
      ctx.textAlign = 'center';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = '#f5d742';
      ctx.fillText(t('control.swapHint'), s.width / 2, s.height - 200);
    }
    // Préparation : l'attaque attend 30 s, la défense 10 s puis se met en place.
    if (this.setupLeft > 0) {
      const defenseOut = !this.playerAttacks && this.countdown <= 0;
      drawCountdown(
        ctx,
        s.width,
        s.height,
        t(defenseOut ? 'start.takePositions' : 'start.doors'),
        this.playerAttacks ? this.setupLeft : defenseOut ? this.setupLeft : this.countdown,
      );
    }
    if (this.introAge < ESCORT.intro) {
      drawEscortBanner(
        ctx,
        s.width,
        s.height,
        t(this.playerAttacks ? 'escort.attack' : 'escort.defense'),
        t(this.playerAttacks ? 'escort.goalAttack' : 'escort.goalDefense'),
        myColor,
        this.introAge,
        ESCORT.intro,
        this.setupLeft > 0 ? 0.48 : 0.3, // sous le compte à rebours
      );
    } else if (this.checkpointAge >= 0 && this.checkpointAge < ESCORT.checkpointBanner) {
      drawEscortBanner(ctx, s.width, s.height, t('escort.checkpoint'), '', attackColor, this.checkpointAge, ESCORT.checkpointBanner);
    }
    if (this.state !== 'playing' && this.winner) {
      drawEscortEnd(
        ctx,
        s.width,
        s.height,
        this.winner === this.player.team,
        this.payload.delivered
          ? t('escort.delivered')
          : t('escort.held', { p: Math.floor(this.payload.progress * 100) }),
      );
    }
  }
}
