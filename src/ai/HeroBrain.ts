import type { BotControls } from '../core/Controls';
import { distToCircle } from '../core/geometry';
import { angleDiff, normalize, randRange, rotateTowards, TAU, type Vec2 } from '../core/math';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Hero } from '../heroes/Hero';
import type { Team } from '../entities/Team';
import type { Arena } from '../world/Arena';
import { canSeeCircle, inVisionRange } from '../world/Visibility';
import type { NavGraph } from './nav';
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
 * Au-dessus, une couche MACRO (modes à objectif) décide OÙ aller :
 * - point pas à nous → y aller (et combattre ceux qu'on croise en chemin ou dessus) ;
 * - point à nous → rester dessus ou tout près pour le défendre, sans partir en chasse ;
 * - Escorte, attaque → rester dans la zone du convoi, à couvert derrière lui ;
 * - Escorte, défense → plonger sur le convoi quand il est poussé, sinon l'attendre en avant ;
 * - peu de PV → détour par un pack de soin proche.
 * Les déplacements longs suivent un petit graphe de navigation (nav.ts).
 *
 * L'IA ne touche jamais au héros directement : elle remplit ses BotControls,
 * exactement comme le clavier remplit ceux du joueur.
 */

export type BotState = 'roam' | 'attack';

/** Objectif du mode (point de contrôle) tel que le voit l'IA. */
export interface ObjectiveInfo {
  x: number;
  y: number;
  r: number;
  /** Contrôle : équipe qui possède le point (null = neutre). */
  owner: Team | null;
  /** Escorte : équipe qui attaque (absent en Contrôle). L'objectif suit alors le convoi. */
  attackers?: Team;
  /** Escorte : des attaquants sont sur le convoi (il avance ou est contesté). */
  active?: boolean;
  /** Escorte : direction d'avancée du convoi. */
  forward?: Vec2;
  /** Escorte : demi-taille du convoi (pour se mettre à couvert derrière). */
  cover?: number;
  /** Escorte : position de garde des défenseurs, en avant du convoi. */
  holdPoint?: Vec2;
}

/**
 * Rôle du bot vis-à-vis de l'objectif :
 * - capture / hold : Contrôle (prendre le point / le garder) ;
 * - escort : attaquant d'Escorte (rester dans la zone du convoi, à couvert derrière) ;
 * - block : défenseur quand le convoi est poussé (plonger dans la zone pour le contester) ;
 * - guard : défenseur quand le convoi est à l'arrêt (attendre en avant sur le parcours).
 */
type Stance = 'capture' | 'hold' | 'escort' | 'block' | 'guard';

export interface BrainWorld {
  arena: Arena;
  targets: readonly Combatant[];
  time: number;
  objective?: ObjectiveInfo;
  nav?: NavGraph;
  /** Packs de soin disponibles. */
  healthPacks?: readonly Vec2[];
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
const LOSE_TARGET_OBJECTIVE = 1.5; // plus court en mode objectif : on retourne vite au point

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
  /** Le point de patrouille actuel sert l'objectif (et non une balade aléatoire). */
  private waypointForObjective = false;
  // --- navigation (graphe)
  private route: Vec2[] = [];
  private routeGoal: Vec2 | null = null;
  private routeTimer = 0;
  /** Décalage latéral derrière le convoi (pour ne pas tous se coller au même endroit). */
  private coverJitter = 0;
  private coverJitterTimer = 0;

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
    this.coverJitterTimer -= dt;
    if (this.coverJitterTimer <= 0) {
      this.coverJitter = randRange(-35, 35);
      this.coverJitterTimer = randRange(1.5, 3);
    }
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

  /** Oublie tout (mort, nouvelle manche). */
  reset(): void {
    this.route = [];
    this.routeGoal = null;
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
        if (!c.alive || !hostile(h, c) || c.safe) continue; // inutile de viser un ennemi protégé au spawn
        if (!inVisionRange(h.x, h.y, c.x, c.y, c.radius)) continue;
        if (!canSeeCircle(w.arena, h.x, h.y, c.circle())) continue;
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
      const giveUp = w.objective ? LOSE_TARGET_OBJECTIVE : LOSE_TARGET_AFTER;
      if (this.lostTimer > giveUp || reached || this.tooFarFromObjective(w, this.lastSeen)) {
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
      edge: distToCircle(h.x, h.y, t.circle()),
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
    if (w.objective) return this.navigate(this.macroGoal(dt, w, w.objective), dt, w);
    const h = this.hero;
    this.waypointTimer -= dt;
    if (this.waypointForObjective) this.waypoint = null;
    this.waypointForObjective = false;
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

  // ------------------------------------------------------------ macro (objectif)

  /**
   * Où aller hors combat en mode objectif :
   * - peu de PV et un pack de soin proche → le pack ;
   * - point à nous → patrouille dans le point ou juste autour (défense) ;
   * - sinon → dans le point, pour le capturer.
   */
  private macroGoal(dt: number, w: BrainWorld, o: ObjectiveInfo): Vec2 {
    const h = this.hero;
    if (h.hp / h.maxHp < 0.5 && w.healthPacks?.length) {
      let best: Vec2 | null = null;
      let bestD = 900;
      for (const p of w.healthPacks) {
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) return best;
    }

    // Où se tenir selon le rôle : autour de quel point, dans quel rayon.
    const stance = this.stance(o);
    let anchor: Vec2 = o;
    let radius: number;
    switch (stance) {
      case 'hold':
        radius = o.r * 1.3;
        break;
      case 'capture':
        radius = o.r * 0.55;
        break;
      case 'escort':
        // Les défenseurs arrivent par l'avant : on se met derrière le convoi.
        return this.coverSpot(w, o, o.forward ?? { x: 0, y: -1 });
      case 'block': {
        const f = o.forward ?? { x: 0, y: 0 };
        anchor = { x: o.x + f.x * 60, y: o.y + f.y * 60 };
        radius = o.r * 0.45;
        break;
      }
      case 'guard':
        anchor = o.holdPoint ?? o;
        radius = 90;
        break;
    }

    this.waypointTimer -= dt;
    const wp = this.waypoint;
    const invalid =
      !wp ||
      !this.waypointForObjective ||
      this.waypointTimer <= 0 ||
      Math.hypot(wp.x - anchor.x, wp.y - anchor.y) > radius + 5 ||
      Math.hypot(wp.x - h.x, wp.y - h.y) < 40;
    if (invalid) {
      this.waypoint = this.pointNear(w, anchor, radius);
      this.waypointForObjective = true;
      this.waypointTimer = randRange(1.5, 3.5);
    }
    return this.waypoint!;
  }

  private stance(o: ObjectiveInfo): Stance {
    const team = this.hero.team;
    if (o.attackers === undefined) return o.owner === team ? 'hold' : 'capture';
    if (o.attackers === team) return 'escort';
    return o.active ? 'block' : 'guard';
  }

  /**
   * Position à couvert derrière le convoi : du côté opposé à la menace,
   * juste assez loin pour ne pas toucher la caisse (et rester dans la zone de poussée).
   */
  private coverSpot(w: BrainWorld, o: ObjectiveInfo, threatDir: Vec2): Vec2 {
    const h = this.hero;
    const back = (o.cover ?? 30) + h.radius + 22;
    const perp = { x: -threatDir.y, y: threatDir.x };
    const spot = {
      x: o.x - threatDir.x * back + perp.x * this.coverJitter,
      y: o.y - threatDir.y * back + perp.y * this.coverJitter,
    };
    if (!w.arena.circleCollides(spot.x, spot.y, h.radius, h.team)) return spot;
    const straight = { x: o.x - threatDir.x * back, y: o.y - threatDir.y * back };
    if (!w.arena.circleCollides(straight.x, straight.y, h.radius, h.team)) return straight;
    return this.pointNear(w, o, o.r * 0.6);
  }

  /** Point libre collé au convoi, du côté `side` (devant pour un défenseur). */
  private besidePayload(w: BrainWorld, o: ObjectiveInfo, side: Vec2): Vec2 {
    const h = this.hero;
    const off = (o.cover ?? 30) + h.radius + 22;
    const p = { x: o.x + side.x * off, y: o.y + side.y * off };
    if (!w.arena.circleCollides(p.x, p.y, h.radius, h.team)) return p;
    return this.pointNear(w, o, o.r * 0.6);
  }

  /** Point libre au hasard dans un rayon autour d'un centre. */
  private pointNear(w: BrainWorld, o: Vec2, radius: number): Vec2 {
    const h = this.hero;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * radius;
      const p = { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r };
      if (!w.arena.circleCollides(p.x, p.y, h.radius + 6, h.team)) return p;
    }
    return { x: o.x, y: o.y };
  }

  /** Cible partie loin de l'objectif : on ne la poursuit pas, on reste sur l'objectif. */
  private tooFarFromObjective(w: BrainWorld, p: Vec2 | null): boolean {
    const o = w.objective;
    if (!o || !p) return false;
    switch (this.stance(o)) {
      case 'hold':
        return Math.hypot(p.x - o.x, p.y - o.y) > o.r + 420;
      case 'escort':
      case 'block':
        return Math.hypot(p.x - o.x, p.y - o.y) > o.r + 450;
      case 'guard': {
        const g = o.holdPoint ?? o;
        return Math.hypot(p.x - g.x, p.y - g.y) > 600;
      }
      default:
        return false;
    }
  }

  /**
   * Direction vers un but lointain : suit le graphe de navigation s'il y en a un,
   * en "coupant" dès qu'un point plus loin du chemin est accessible en ligne droite.
   */
  protected navigate(goal: Vec2, dt: number, w: BrainWorld): Vec2 {
    const h = this.hero;
    if (!w.nav) return normalize(goal.x - h.x, goal.y - h.y);

    this.routeTimer -= dt;
    const moved = !this.routeGoal || Math.hypot(this.routeGoal.x - goal.x, this.routeGoal.y - goal.y) > 60;
    if (moved || this.routeTimer <= 0) {
      this.route = w.nav.route(h, goal) ?? [goal];
      this.routeGoal = { x: goal.x, y: goal.y };
      this.routeTimer = 1;
    }
    while (this.route.length > 1) {
      const next = this.route[0];
      const reached = Math.hypot(next.x - h.x, next.y - h.y) < 40;
      if (!reached && !pathClear(w.arena, h, this.route[1].x, this.route[1].y)) break;
      this.route.shift();
    }
    const next = this.route[0] ?? goal;
    return normalize(next.x - h.x, next.y - h.y);
  }

  private attackMove(dt: number, w: BrainWorld, t: Combatant): Vec2 {
    const h = this.hero;
    if (!this.targetVisible) {
      // Cible perdue de vue : on va voir là où on l'a vue en dernier.
      const p = this.lastSeen ?? { x: t.x, y: t.y };
      this.desiredAim = Math.atan2(p.y - h.y, p.x - h.x);
      this.aimDist = 200;
      return this.navigate(p, dt, w);
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
    const desired = {
      x: dir.x * radial + perp.x * this.strafeWeight,
      y: dir.y * radial + perp.y * this.strafeWeight,
    };

    // Objectif : le combat ne doit pas le faire oublier.
    const o = w.objective;
    if (o) {
      const d2 = Math.hypot(o.x - h.x, o.y - h.y);
      let goal: Vec2 = o;
      let pull = 0;
      switch (this.stance(o)) {
        case 'hold': // point à nous : on se bat sans trop s'éloigner
          pull = Math.min(1.5, Math.max(0, (d2 - o.r - 120) / 200));
          break;
        case 'capture': // on avance vers le point en combattant
          pull = d2 > o.r * 0.8 ? 0.45 : 0;
          break;
        case 'escort': // dans la zone du convoi, à couvert derrière lui face à la cible
          // (jamais vers le centre du convoi : c'est un obstacle, aucun chemin n'y mène)
          if (d2 > o.r * 0.85) {
            goal = this.coverSpot(w, o, o.forward ?? dir);
            pull = 1;
          } else {
            goal = this.coverSpot(w, o, dir);
            pull = Math.hypot(goal.x - h.x, goal.y - h.y) > 20 ? 0.9 : 0;
          }
          break;
        case 'block': // plonger dans la zone (devant le convoi) pour contester
          if (d2 > o.r * 0.75) {
            goal = this.besidePayload(w, o, o.forward ?? dir);
            pull = 1.3;
          }
          break;
        case 'guard': {
          const g = o.holdPoint ?? o;
          if (Math.hypot(g.x - h.x, g.y - h.y) > 400) {
            goal = g;
            pull = 0.8;
          }
          break;
        }
      }
      if (pull > 0) {
        const toGoal = this.navigate(goal, dt, w);
        desired.x += toGoal.x * pull;
        desired.y += toGoal.y * pull;
      }
    }
    return desired;
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
