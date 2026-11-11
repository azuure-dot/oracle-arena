import { createBrain } from '../../../src/ai/brains';
import type { BrainWorld, HeroBrain } from '../../../src/ai/HeroBrain';
import { BotControls } from '../../../src/core/Controls';
import type { Vec2 } from '../../../src/core/math';
import { World, type DamageEvent } from '../../../src/game/World';
import type { Hero } from '../../../src/heroes/Hero';
import { HEROES } from '../../../src/heroes/registry';
import {
  BOT_DAMAGE_MULTIPLIER,
  DEATHMATCH_COUNTDOWN,
  pickDeathmatchSpawn,
  placeDeathmatchStart,
} from '../../../src/modes/rules';
import {
  diffFields,
  encodeFields,
  FX_METHODS,
  HERO_SKIP,
  heroMotion,
  kindOf,
  OBJECT_SKIP,
  type RefEncoder,
} from '../../../src/network/netState';
import { Arena } from '../../../src/world/Arena';
import { PRACTICE_MAP, QUICKPLAY_MAPS, type MapDef } from '../../../src/world/maps';
import type {
  FxCall,
  GameOver,
  GameTick,
  HitEvent,
  ObjectTick,
  Participant,
  PlayerInput,
  RoomSettings,
} from '../types/network';
import { NetControls } from './NetControls';

/**
 * SIMULATION AUTORITAIRE D'UNE PARTIE.
 *
 * Le serveur fait tourner LE MÊME monde que le jeu solo (src/game/World.ts) avec les mêmes héros
 * (src/heroes/) : déplacements, tirs, rechargements, compétences, collisions projectiles / murs /
 * héros, réapparitions. Il n'y a ni caméra ni dessin ici : seuls les « crochets » du monde
 * (dégâts, tremblements, point de réapparition) sont branchés.
 *
 * - Simulation à 60 Hz (pas fixe, comme une image du jeu solo), instantanés envoyés à 30 Hz.
 * - Les joueurs pilotent leur héros par des `NetControls` (messages PLAYER_INPUT), les bots
 *   par leur IA habituelle (src/ai/), exactement comme en solo.
 * - Règles du Deathmatch : celles de src/modes/rules.ts (partagées avec le mode solo).
 */

export const SIM_HZ = 60;
export const TICK_HZ = 30;
const SIM_DT = 1 / SIM_HZ;
const STEPS_PER_TICK = SIM_HZ / TICK_HZ;
/** Retard maximal rattrapé d'un coup (serveur surchargé) : au-delà, la partie ralentit. */
const MAX_CATCH_UP = 6;

interface Slot {
  info: Participant;
  hero: Hero;
  controls: NetControls | BotControls;
  brain: HeroBrain | null;
  kills: number;
  deaths: number;
  /** Dernier état envoyé, champ par champ (différences). */
  last: Map<string, string>;
  /** Joueur parti en cours de partie : son héros a quitté le monde. */
  left: boolean;
}

export function mapById(id: string): MapDef {
  return [PRACTICE_MAP, ...QUICKPLAY_MAPS].find((m) => m.id === id) ?? PRACTICE_MAP;
}

export class GameLoop {
  readonly world: World;
  private readonly slots: Slot[] = [];
  private readonly byId = new Map<string, Slot>();
  private countdown = DEATHMATCH_COUNTDOWN;
  private remaining: number;
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private acc = 0;
  private steps = 0;
  private over = false;

  // --- enregistrement de ce qui se passe entre deux instantanés
  private fx: FxCall[] = [];
  /** Participant qui agit en ce moment dans la simulation (voir WorldHooks.onActor). */
  private actor: string | null = null;
  private wet: GameTick['wet'] = [];
  private shakes: GameTick['shakes'] = [];
  private hits: HitEvent[] = [];
  private readonly objectIds = new WeakMap<object, number>();
  /** Dernier ping annoncé par chaque joueur (ms). */
  private readonly pings: Record<string, number> = {};
  private readonly objectLast = new Map<number, Map<string, string>>();
  private nextObjectId = 1;
  private readonly refs: RefEncoder;

  constructor(
    participants: Participant[],
    settings: RoomSettings,
    private readonly send: (tick: GameTick) => void,
    private readonly onOver: (result: GameOver) => void,
  ) {
    this.remaining = settings.minutes * 60;
    const arena = new Arena(mapById(settings.mapId));
    this.world = new World(
      arena,
      { shake() {} }, // pas d'écran : les tremblements sont retransmis (onShake)
      {
        respawnPoint: (hero) => this.respawnPoint(hero),
        onDamage: (e) => this.onDamage(e),
        onShake: (m, at) => this.shakes.push([round(m), round(at.x), round(at.y), this.actor]),
        onActor: (h) => (this.actor = h ? (this.refs.heroId(h) ?? null) : null),
      },
    );
    this.recordEffects();

    for (const info of participants) {
      const entry = HEROES.find((h) => h.id === info.heroId) ?? HEROES[0];
      const hero = entry.create();
      hero.team = info.team;
      hero.label = info.name;
      let brain: HeroBrain | null = null;
      let controls: NetControls | BotControls;
      if (info.isBot) {
        const bc = new BotControls();
        controls = bc;
        brain = createBrain(hero, bc);
        hero.damageMultiplier = BOT_DAMAGE_MULTIPLIER;
      } else {
        controls = new NetControls();
        hero.externalMovement = true; // la marche suit les commandes reçues (voir input())
      }
      hero.controls = controls;
      const slot: Slot = { info, hero, controls, brain, kills: 0, deaths: 0, last: new Map(), left: false };
      this.slots.push(slot);
      this.byId.set(info.id, slot);
    }
    placeDeathmatchStart(this.slots.map((s) => s.hero));
    this.world.heroes = this.slots.map((s) => s.hero);

    const heroIds = new Map(this.slots.map((s) => [s.hero, s.info.id]));
    this.refs = {
      heroId: (h) => heroIds.get(h),
      objectId: (o) => this.objectIds.get(o),
    };
  }

  // ------------------------------------------------------------ cycle de vie

  start(): void {
    this.lastTime = performance.now();
    this.timer = setInterval(() => this.run(), 1000 / SIM_HZ);
    this.broadcast(); // état initial tout de suite (positions de départ)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Commandes reçues d'un joueur. Sa MARCHE est appliquée tout de suite, avec la durée de son
   * image (`input.dt`) : c'est exactement ce que sa prédiction a fait dans le navigateur, donc la
   * position renvoyée pour cette commande (`acks`) tombe juste et la réconciliation ne corrige
   * rien en temps normal. Tirs et compétences, eux, attendent le prochain pas de simulation.
   */
  input(playerId: string, input: PlayerInput): void {
    const slot = this.byId.get(playerId);
    if (!slot || !(slot.controls instanceof NetControls) || slot.left) return;
    const ctl = slot.controls;
    if (!ctl.apply(input) || this.countdown > 0 || this.over) return;
    const dt = ctl.consume(input.dt);
    if (dt > 0) slot.hero.predictMove(dt, ctl.move, this.world.arena);
  }

  setPing(playerId: string, ms: number): void {
    if (this.byId.get(playerId)?.controls instanceof NetControls) this.pings[playerId] = ms;
  }

  /** Un joueur quitte la partie : son héros disparaît, ses points restent au classement. */
  removePlayer(playerId: string): void {
    const slot = this.byId.get(playerId);
    if (!slot || slot.left) return;
    slot.left = true;
    slot.controls.releaseAll();
    this.world.heroes = this.world.heroes.filter((h) => h !== slot.hero);
  }

  // ------------------------------------------------------------ boucle

  private run(): void {
    const now = performance.now();
    this.acc += (now - this.lastTime) / 1000;
    this.lastTime = now;
    let n = 0;
    while (this.acc >= SIM_DT && n < MAX_CATCH_UP && !this.over) {
      this.acc -= SIM_DT;
      n++;
      this.step(SIM_DT);
      if (++this.steps % STEPS_PER_TICK === 0) this.broadcast();
    }
    if (n === MAX_CATCH_UP) this.acc = 0; // trop de retard : on abandonne le rattrapage
  }

  private step(dt: number): void {
    if (this.countdown > 0) {
      // Compte à rebours : tout est figé (comme en solo).
      this.countdown = Math.max(0, this.countdown - dt);
      for (const s of this.slots) if (s.controls instanceof NetControls) s.controls.endStep();
      return;
    }
    const bw = this.brainWorld();
    for (const s of this.slots) if (s.brain && !s.left) s.brain.update(dt, bw);
    for (const s of this.slots) {
      if (!(s.controls instanceof NetControls) || s.left) continue;
      // Joueur muet (onglet en arrière-plan, coupure) : la physique continue sans lui (recul,
      // freinage), sans marche. Un joueur qui envoie ses commandes n'est jamais déplacé ici.
      if (s.controls.credit(dt)) s.hero.predictMove(dt, { x: 0, y: 0 }, this.world.arena);
    }
    this.world.update(dt);
    for (const s of this.slots) {
      if (s.controls instanceof NetControls) s.controls.endStep();
      else s.controls.endFrame();
    }
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining <= 0) this.finish();
  }

  private finish(): void {
    this.over = true;
    for (const s of this.slots) s.controls.releaseAll();
    this.broadcast();
    this.stop();
    this.onOver({ scores: this.scores() });
  }

  private brainWorld(): BrainWorld {
    return { arena: this.world.arena, targets: [...this.world.heroes, ...this.world.decoys], time: this.world.time };
  }

  private respawnPoint(hero: Hero): Vec2 {
    return pickDeathmatchSpawn(this.world.arena, hero, this.world.heroes);
  }

  /** Comptage des éliminations (mêmes règles que MatchMode.onDamage en solo). */
  private onDamage(e: DamageEvent): void {
    const victim = this.slotOf(e.target);
    const source = e.source ? this.slotOf(e.source) : undefined;
    const targetRef = victim ? victim.info.id : this.objectIds.get(e.target);
    if (targetRef !== undefined) {
      this.hits.push([targetRef, source?.info.id ?? null, round(e.dealt), e.killed ? 1 : 0, e.cause ?? null]);
    }
    if (!victim) return;
    victim.brain?.onDamaged(e.source, this.brainWorld());
    if (!e.killed) return;
    victim.deaths++;
    if (source && source !== victim) source.kills++;
  }

  private slotOf(c: unknown): Slot | undefined {
    return this.slots.find((s) => s.hero === c);
  }

  private scores(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const s of this.slots) out[s.info.id] = [s.kills, s.deaths];
    return out;
  }

  // ------------------------------------------------------------ instantanés

  /**
   * Les effets visuels ne servent à rien sur le serveur : on remplace les méthodes de `Effects`
   * par un enregistreur (rejoué par les clients), et on note chaque flaque posée.
   */
  private recordEffects(): void {
    const fx = this.world.effects as unknown as Record<string, (...args: unknown[]) => void>;
    for (const name of FX_METHODS) {
      fx[name] = (...args: unknown[]) => {
        this.fx.push([this.actor, name, ...args.map((a) => (typeof a === 'number' ? round(a) : (a as string | boolean)))]);
      };
    }
    const wet = this.world.wet;
    const splash = wet.splash.bind(wet);
    wet.splash = (x, y, radius, now, team) => {
      this.wet.push([round(x), round(y), round(radius), round(now), team]);
      splash(x, y, radius, now, team);
    };
  }

  private broadcast(): void {
    const w = this.world;
    const heroes: GameTick['heroes'] = {};
    for (const s of this.slots) {
      if (s.left) continue;
      const h = s.hero;
      const diff = diffFields(encodeFields(h, HERO_SKIP, this.refs), s.last);
      heroes[s.info.id] = diff ? { p: heroMotion(h, round), s: diff } : { p: heroMotion(h, round) };
    }

    // Identifiants des objets du monde : attribués avant l'encodage (références croisées).
    const all: object[] = [...w.projectiles, ...w.objects, ...w.decoys];
    const fresh = new Set<number>();
    for (const o of all) {
      if (!kindOf(o) || this.objectIds.has(o)) continue;
      const id = this.nextObjectId++;
      this.objectIds.set(o, id);
      fresh.add(id);
    }
    const objects: ObjectTick[] = [];
    const alive = new Set<number>();
    for (const o of all) {
      const kind = kindOf(o);
      const id = this.objectIds.get(o);
      if (!kind || id === undefined) continue;
      alive.add(id);
      let last = this.objectLast.get(id);
      if (!last) this.objectLast.set(id, (last = new Map()));
      const pos = o as unknown as Vec2;
      const tick: ObjectTick = { id, p: [round(pos.x), round(pos.y)] };
      if (fresh.has(id)) tick.k = kind;
      const diff = diffFields(encodeFields(o, OBJECT_SKIP, this.refs), last);
      if (diff) tick.s = diff;
      objects.push(tick);
    }
    for (const id of this.objectLast.keys()) if (!alive.has(id)) this.objectLast.delete(id);

    const acks: Record<string, number> = {};
    for (const s of this.slots) if (s.controls instanceof NetControls) acks[s.info.id] = s.controls.lastSeq;

    this.send({
      t: round(this.steps * SIM_DT),
      wt: round(w.time),
      acks,
      heroes,
      objects,
      fx: this.fx,
      wet: this.wet,
      shakes: this.shakes,
      hits: this.hits,
      pings: this.pings,
      match: { countdown: round(this.countdown), remaining: round(this.remaining), scores: this.scores() },
    });
    this.fx = [];
    this.wet = [];
    this.shakes = [];
    this.hits = [];
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
