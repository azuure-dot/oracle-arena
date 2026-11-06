import type { BotControls } from '../core/Controls';
import { distToBox } from '../core/geometry';
import { angleDiff, normalize, randRange, rotateTowards, TAU, type Vec2 } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Hero } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import { canSeeBox, inVisionRange } from '../world/Visibility';
import { clearance, pathClear, randomFreePoint, steer } from './steering';

/**
 * IA d'un bot héros — machine à états très simple :
 *
 *   ROAM ──(voit un adversaire / se fait toucher)──▶ ATTACK
 *   ATTACK ──(cible morte, ou perdue de vue depuis 3 s)──▶ ROAM
 *
 * - ROAM : marche vers des points aléatoires de la map (en ligne droite dégagée
 *   de préférence), en contournant les murs avec des raycasts (steering.ts).
 * - ATTACK : garde la distance préférée du héros, se décale latéralement (strafe),
 *   vise avec un temps de réaction et une vitesse de rotation limitée, et laisse
 *   la sous-classe décider des tirs et des compétences (combat()).
 *
 * L'IA ne touche jamais au héros directement : elle remplit ses BotControls,
 * exactement comme le clavier remplit ceux du joueur.
 */

export type BotState = 'roam' | 'attack';

export interface BrainWorld {
  arena: Arena;
  targets: readonly Combatant[];
  time: number;
}

/** Infos sur la cible, calculées chaque frame pour combat(). */
export interface TargetInfo {
  /** Distance centre à centre. */
  dist: number;
  /** Distance du centre du bot au bord de la hitbox de la cible. */
  edge: number;
  /** Écart entre la visée actuelle et la visée idéale (rad). */
  aimError: number;
  /** Direction vers la cible (normalisée). */
  dir: Vec2;
}

const PERCEPTION_INTERVAL = 0.15; // s entre deux "regards" autour de soi
const LOSE_TARGET_AFTER = 3; // s sans voir la cible avant de repartir en patrouille

export abstract class HeroBrain<H extends Hero = Hero> {
  state: BotState = 'roam';
  target: Combatant | null = null;

  // --- réglages du héros (surchargés par les sous-classes)
  /** Distance idéale à la cible (centre à centre). */
  protected abstract readonly preferredRange: number;
  /** Tolérance autour de la distance idéale. */
  protected rangeBand = 70;
  /** Poids du déplacement latéral (0 = fonce droit, 1 = tourne autour). */
  protected strafeWeight = 0.8;
  /** Vitesse des projectiles (pour anticiper le mouvement de la cible). */
  protected projectileSpeed = Infinity;
  /** Vitesse de rotation de la visée (rad/s) : un bot ne "flick" pas instantanément. */
  protected turnRate = 7;

  // --- perception
  protected targetVisible = false;
  protected lastSeen: Vec2 | null = null;
  private lostTimer = 0;
  /** Temps de réaction restant après avoir repéré une cible (pas de tir avant). */
  protected reaction = 0;
  private perceiveTimer = Math.random() * PERCEPTION_INTERVAL;
  /** Dernier dégât subi : moment et distance du tireur (bouclier de Rempart...). */
  protected lastDamage = { time: -99, fromDist: 0 };

  // --- déplacement
  private waypoint: Vec2 | null = null;
  private waypointTimer = 0;
  protected strafeDir = Math.random() < 0.5 ? 1 : -1;
  private strafeTimer = 0;
  private smoothMove: Vec2 = { x: 0, y: 0 };
  /** Déplacement imposé cette frame par combat() (fuite, esquive...). Appliqué sans lissage. */
  protected forcedMove: Vec2 | null = null;
  private stuckClock = 0;
  private stuckFrom: Vec2 = { x: 0, y: 0 };
  private wantedMoveTime = 0;
  private unstickTimer = 0;
  private unstickDir: Vec2 = { x: 0, y: 0 };

  // --- visée
  protected aimAngle = Math.random() * TAU;
  protected desiredAim = 0;
  private aimDist = 200;
  private readonly wobblePhase = Math.random() * 100;
  private tvx = 0;
  private tvy = 0;
  private prevTarget: Combatant | null = null;
  private prevTx = 0;
  private prevTy = 0;

  constructor(
    readonly hero: H,
    readonly controls: BotControls,
  ) {}

  /** Décisions propres au héros en combat : tirs et compétences (controls.hold / press). */
  protected abstract combat(dt: number, w: BrainWorld, target: Combatant, info: TargetInfo): void;
  /** Hook en patrouille (ex. Tempo garde son aura de Vitesse). */
  protected roam(_dt: number, _w: BrainWorld): void {}
  /** Hook appelé chaque frame dans les deux états (ex. choix d'aura selon les PV). */
  protected always(_dt: number, _w: BrainWorld): void {}

  /** Appelé par le mode de jeu quand le héros du bot subit des dégâts. */
  onDamaged(source: Hero | null, w: BrainWorld): void {
    if (!source || source === this.hero) return;
    this.lastDamage = { time: w.time, fromDist: Math.hypot(source.x - this.hero.x, source.y - this.hero.y) };
    // Touché sans cible : on se retourne vers le tireur (ATTACK, en allant voir).
    if (this.state === 'roam' && source.alive && hostile(this.hero, source)) {
      this.state = 'attack';
      this.setTarget(source);
      this.targetVisible = false;
      this.lastSeen = { x: source.x, y: source.y };
      this.lostTimer = 0;
    }
  }

  // ---------------------------------------------------------------- boucle

  update(dt: number, w: BrainWorld): void {
    const c = this.controls;
    const h = this.hero;
    c.beginFrame();
    if (!h.alive) {
      this.reset();
      c.move = { x: 0, y: 0 };
      return;
    }

    this.reaction = Math.max(0, this.reaction - dt);
    this.forcedMove = null;
    this.perceive(dt, w);
    this.always(dt, w);

    let desired: Vec2;
    if (this.state === 'attack' && this.target) {
      desired = this.attackMove(dt, w, this.target);
      const info = this.targetInfo(this.target);
      this.combat(dt, w, this.target, info);
    } else {
      desired = this.roamMove(dt, w);
      // Hors combat : regarde là où il marche, recharge.
      if (Math.hypot(h.vx, h.vy) > 20) this.desiredAim = Math.atan2(h.vy, h.vx);
      this.aimDist = 200;
      c.press('reload');
      this.roam(dt, w);
    }

    this.applyMovement(dt, w, desired);
    this.applyAim(dt, w);
  }

  private reset(): void {
    this.state = 'roam';
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = null;
    this.waypoint = null;
    this.unstickTimer = 0;
    this.smoothMove = { x: 0, y: 0 };
  }

  private setTarget(t: Combatant): void {
    if (t === this.target) return;
    this.target = t;
    this.reaction = randRange(0.22, 0.38); // temps de réaction "humain"
    this.tvx = this.tvy = 0;
    this.prevTarget = null;
  }

  // ------------------------------------------------------------ perception

  /** Cherche l'adversaire visible le plus proche (même test de vue que le joueur). */
  private perceive(dt: number, w: BrainWorld): void {
    const h = this.hero;

    if (this.target && !this.target.alive) {
      this.target = null;
      this.state = 'roam';
      this.perceiveTimer = 0;
    }

    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = PERCEPTION_INTERVAL;
      let best: Combatant | null = null;
      let bestScore = Infinity;
      for (const c of w.targets) {
        if (!c.alive || !hostile(h, c)) continue;
        if (!inVisionRange(h.x, h.y, c.x, c.y, c.hw, c.hh)) continue;
        if (!canSeeBox(w.arena, h.x, h.y, c.box())) continue;
        // On garde sa cible actuelle sauf si une autre est nettement plus proche.
        const score = Math.hypot(c.x - h.x, c.y - h.y) - (c === this.target ? 220 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) {
        this.setTarget(best);
        this.state = 'attack';
        this.targetVisible = true;
        this.lostTimer = 0;
      } else {
        this.targetVisible = false;
      }
    }

    const t = this.target;
    if (this.state !== 'attack' || !t) return;
    if (this.targetVisible) {
      this.lastSeen = { x: t.x, y: t.y };
      this.lostTimer = 0;
    } else {
      this.lostTimer += dt;
      const reached = this.lastSeen && Math.hypot(this.lastSeen.x - h.x, this.lastSeen.y - h.y) < 50;
      if (this.lostTimer > LOSE_TARGET_AFTER || reached) {
        this.state = 'roam';
        this.target = null;
        this.waypoint = null;
      }
    }
  }

  private targetInfo(t: Combatant): TargetInfo {
    const h = this.hero;
    const dx = t.x - h.x;
    const dy = t.y - h.y;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      dist,
      edge: distToBox(h.x, h.y, t.box()),
      aimError: Math.abs(angleDiff(this.aimAngle, this.desiredAim)),
      dir: { x: dx / dist, y: dy / dist },
    };
  }

  /** Peut tirer : cible en vue, réaction écoulée, visée assez précise. */
  protected canShoot(info: TargetInfo, tolerance: number): boolean {
    return this.targetVisible && this.reaction <= 0 && info.aimError < tolerance;
  }

  // ------------------------------------------------------------ déplacement

  private roamMove(dt: number, w: BrainWorld): Vec2 {
    const h = this.hero;
    this.waypointTimer -= dt;
    if (!this.waypoint || this.waypointTimer <= 0 || Math.hypot(this.waypoint.x - h.x, this.waypoint.y - h.y) < 50) {
      this.pickWaypoint(w);
    }
    const wp = this.waypoint!;
    return normalize(wp.x - h.x, wp.y - h.y);
  }

  /** Point de patrouille : de préférence loin et accessible en ligne droite. */
  private pickWaypoint(w: BrainWorld): void {
    const h = this.hero;
    let fallback: Vec2 | null = null;
    for (let i = 0; i < 14; i++) {
      const p = randomFreePoint(w.arena, h);
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d < 250) continue;
      if (pathClear(w.arena, h, p.x, p.y)) {
        this.waypoint = p;
        this.waypointTimer = 8;
        return;
      }
      fallback ??= p;
    }
    this.waypoint = fallback ?? randomFreePoint(w.arena, h);
    this.waypointTimer = 6;
  }

  private attackMove(dt: number, w: BrainWorld, t: Combatant): Vec2 {
    const h = this.hero;
    if (!this.targetVisible) {
      // Cible perdue de vue : on va voir là où on l'a vue en dernier.
      const p = this.lastSeen ?? { x: t.x, y: t.y };
      this.desiredAim = Math.atan2(p.y - h.y, p.x - h.x);
      this.aimDist = 200;
      return normalize(p.x - h.x, p.y - h.y);
    }

    const aimPoint = this.predict(dt, t);
    this.desiredAim = Math.atan2(aimPoint.y - h.y, aimPoint.x - h.x);

    const dx = t.x - h.x;
    const dy = t.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    this.aimDist = d;
    const dir = { x: dx / d, y: dy / d };

    // Rapprochement / recul pour rester à la bonne distance.
    const r = this.preferredRange;
    const band = this.rangeBand;
    const radial = d > r + band ? 1 : d < r - band ? -1 : ((d - r) / band) * 0.5;

    // Pas latéral qui change de sens régulièrement (ou contre un mur).
    this.strafeTimer -= dt;
    const perp = { x: -dir.y * this.strafeDir, y: dir.x * this.strafeDir };
    if (this.strafeTimer <= 0 || clearance(w.arena, h, perp.x, perp.y, 60) < 0.5) {
      this.strafeDir *= -1;
      this.strafeTimer = randRange(0.6, 1.6);
    }
    return {
      x: dir.x * radial + perp.x * this.strafeWeight,
      y: dir.y * radial + perp.y * this.strafeWeight,
    };
  }

  /** Visée anticipée : là où sera la cible quand le projectile arrivera. */
  private predict(dt: number, t: Combatant): Vec2 {
    if (this.prevTarget === t && dt > 0) {
      const k = 1 - Math.exp(-8 * dt);
      this.tvx += ((t.x - this.prevTx) / dt - this.tvx) * k;
      this.tvy += ((t.y - this.prevTy) / dt - this.tvy) * k;
    }
    this.prevTarget = t;
    this.prevTx = t.x;
    this.prevTy = t.y;
    const h = this.hero;
    const lead = Math.min(0.6, Math.hypot(t.x - h.x, t.y - h.y) / this.projectileSpeed) * 0.85;
    return { x: t.x + this.tvx * lead, y: t.y + this.tvy * lead };
  }

  private applyMovement(dt: number, w: BrainWorld, desired: Vec2): void {
    const h = this.hero;
    const c = this.controls;

    // Coincé contre un obstacle ? On part quelques instants dans une direction libre.
    this.stuckClock += dt;
    if (Math.hypot(desired.x, desired.y) > 0.3) this.wantedMoveTime += dt;
    if (this.stuckClock >= 0.7) {
      const moved = Math.hypot(h.x - this.stuckFrom.x, h.y - this.stuckFrom.y);
      if (this.wantedMoveTime > 0.5 && moved < 30) this.startUnstick(w);
      this.stuckClock = 0;
      this.wantedMoveTime = 0;
      this.stuckFrom = { x: h.x, y: h.y };
    }

    if (this.forcedMove) {
      // Fuite / esquive : direction immédiate (le Transfert part dans cette direction).
      const dir = steer(w.arena, h, this.forcedMove);
      c.move = dir;
      this.smoothMove = dir;
      return;
    }
    if (this.unstickTimer > 0) {
      this.unstickTimer -= dt;
      desired = this.unstickDir;
    }

    const len = Math.hypot(desired.x, desired.y);
    if (len < 0.15) {
      c.move = { x: 0, y: 0 };
      this.smoothMove = { x: 0, y: 0 };
      return;
    }
    const dir = steer(w.arena, h, desired);
    const k = 1 - Math.exp(-10 * dt); // lissage : pas de tremblements d'une frame à l'autre
    this.smoothMove = {
      x: this.smoothMove.x + (dir.x - this.smoothMove.x) * k,
      y: this.smoothMove.y + (dir.y - this.smoothMove.y) * k,
    };
    const m = normalize(this.smoothMove.x, this.smoothMove.y);
    const speed = Math.min(1, len); // à la bonne distance, le bot ralentit
    c.move = { x: m.x * speed, y: m.y * speed };
  }

  private startUnstick(w: BrainWorld): void {
    const h = this.hero;
    let best = { x: 0, y: 0 };
    let bestFree = -1;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const free = clearance(w.arena, h, d.x, d.y, 120);
      if (free > bestFree) {
        bestFree = free;
        best = d;
      }
    }
    this.unstickDir = best;
    this.unstickTimer = 0.5;
    this.waypoint = null;
  }

  // ------------------------------------------------------------------ visée

  private applyAim(dt: number, w: BrainWorld): void {
    const h = this.hero;
    // Léger tremblement de visée : les bots ne sont pas des aimbots.
    const t = w.time + this.wobblePhase;
    const wobble = Math.sin(t * 3.1) * 0.035 + Math.sin(t * 7.7) * 0.02;
    this.aimAngle = rotateTowards(this.aimAngle, this.desiredAim + wobble, this.turnRate * dt);
    this.controls.aimX = h.x + Math.cos(this.aimAngle) * this.aimDist;
    this.controls.aimY = h.y + Math.sin(this.aimAngle) * this.aimDist;
  }
}
