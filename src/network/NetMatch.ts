import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { Input } from '../core/Input';
import { lerp, type Vec2 } from '../core/math';
import type { Combatant } from '../entities/Combatant';
import type { DamageCause } from '../core/GameContext';
import type { Hero } from '../heroes/Hero';
import { HEROES } from '../heroes/registry';
import { DeathmatchMode } from '../modes/DeathmatchMode';
import type { Participant } from '../modes/MatchMode';
import {
  ACTION_BITS,
  type GameOver,
  type GameStarted,
  type GameTick,
  type PlayerInput,
} from '../../server/src/types/network';
import { applyFields, NET_KINDS, type NetKind, type RefDecoder } from './netState';
import type { NetworkManager } from './NetworkManager';

/**
 * PARTIE EN LIGNE, CÔTÉ CLIENT (Deathmatch).
 *
 * Le serveur simule ; le client AFFICHE ce qu'il reçoit, avec trois techniques classiques :
 *
 * 1. Interpolation des autres joueurs : on affiche le monde avec ~100 ms de retard sur le dernier
 *    instantané reçu (INTERP_DELAY), en glissant entre les deux instantanés qui encadrent cet
 *    instant. Les autres héros, projectiles et objets bougent donc sans à-coups, même à 30 Hz.
 * 2. Prédiction du joueur local : son déplacement est appliqué TOUT DE SUITE (Hero.predictMove),
 *    sans attendre l'aller-retour réseau. Sa visée aussi.
 * 3. Réconciliation : à chaque instantané, on repart de la position que le serveur a calculée
 *    pour la dernière commande qu'il a traitée (`acks`), puis on rejoue les commandes envoyées
 *    depuis. Le joueur ne « recule » donc jamais, et un écart (recul, ruée...) est corrigé.
 *
 * Les règles d'affichage (HUD, fil des éliminations, classement, tableau des scores) sont celles
 * du Deathmatch solo (DeathmatchMode, dont cette classe hérite) : seules les données viennent
 * du serveur.
 */

/** Retard d'affichage des autres joueurs (s) : ~3 instantanés à 30 Hz. */
const INTERP_DELAY = 0.1;
/** Commandes gardées en attente au maximum (≈ 2 s à 60 i/s). */
const MAX_PENDING = 120;

interface NetObject {
  kind: NetKind;
  obj: Record<string, unknown> & Vec2;
  /** Dernier instantané (temps serveur) où l'objet existait. */
  lastSeen: number;
}

export class NetMatch extends DeathmatchMode {
  private readonly heroById = new Map<string, Hero>();
  private readonly participantById = new Map<string, Participant>();
  private readonly objects = new Map<number, NetObject>();
  private readonly refs: RefDecoder;

  /** Instantanés reçus, pas encore affichés (ordre croissant). */
  private queue: GameTick[] = [];
  /** Dernier instantané affiché. */
  private current: GameTick | null = null;
  /** Instant affiché (horloge serveur, en retard de INTERP_DELAY). */
  private renderT = 0;
  private latestT = 0;

  private seq = 0;
  private pending: PlayerInput[] = [];
  private over = false;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    camera: Camera,
    input: Input,
    readonly info: GameStarted,
    private readonly localId: string,
    private readonly net: NetworkManager,
  ) {
    const me = info.participants.find((p) => p.id === localId)!;
    const entry = HEROES.find((h) => h.id === me.heroId) ?? HEROES[0];
    super(camera, input, entry, { bots: 0, minutes: 99 });

    // Le joueur local (créé par GameMode) prend son identité réseau.
    this.player.team = me.team;
    this.heroById.set(me.id, this.player);
    this.participantById.set(me.id, this.playerEntry);

    // Les autres participants (joueurs et bots du serveur) : de simples héros affichés.
    for (const p of info.participants) {
      if (p.id === localId) continue;
      const hero = (HEROES.find((h) => h.id === p.heroId) ?? HEROES[0]).create();
      hero.team = p.team;
      hero.outline = COLORS.enemy;
      hero.label = p.name;
      const part: Participant = { hero, name: p.name, isPlayer: false, kills: 0, deaths: 0, brain: null, controls: null };
      this.participants.push(part);
      this.heroById.set(p.id, hero);
      this.participantById.set(p.id, part);
    }
    this.world.heroes = this.participants.map((p) => p.hero);

    this.refs = {
      hero: (id) => this.heroById.get(id),
      object: (id) => this.objects.get(id)?.obj,
    };
    this.unsubscribe.push(
      net.gameTick.on((t) => this.receive(t)),
      net.gameOver.on((r) => this.end(r)),
    );
  }

  /** Fin de partie : décidée par le serveur (pas par le chrono local). */
  override get finished(): boolean {
    return this.over;
  }

  /** Quitte la partie : plus d'écoute du réseau. */
  dispose(): void {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe.length = 0;
  }

  // ------------------------------------------------------------ image

  override update(dt: number): void {
    if (!this.handleMetaKeys()) return;
    this.sampleControls(dt);
    const input = this.sendInput(dt);

    this.advance(dt);
    // Prédiction : le joueur bouge tout de suite (le serveur confirmera ou corrigera).
    if (this.countdown <= 0) this.player.predictMove(dt, { x: input.mx, y: input.my }, this.arena);
    const c = this.playerControls;
    if (this.player.alive) this.player.aim = Math.atan2(c.aimY - this.player.y, c.aimX - this.player.x);

    this.world.updateDisplay(dt);
    // Affichage fluide du compte à rebours et du chrono entre deux instantanés.
    this.countdown = Math.max(0, this.countdown - dt);
    this.afterWorld(dt);
    this.hud.update(dt);
  }

  private sendInput(dt: number): PlayerInput {
    const c = this.playerControls;
    let held = 0;
    let pressed = 0;
    ACTION_BITS.forEach((a, i) => {
      if (c.held(a)) held |= 1 << i;
      if (c.pressed(a)) pressed |= 1 << i;
    });
    const input: PlayerInput = { seq: ++this.seq, dt, mx: c.move.x, my: c.move.y, ax: c.aimX, ay: c.aimY, held, pressed };
    this.net.sendInput(input);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return input;
  }

  // ------------------------------------------------------------ réception

  private receive(t: GameTick): void {
    if (t.t < this.latestT) return;
    this.latestT = t.t;
    if (!this.current) this.renderT = t.t - INTERP_DELAY;

    // Objets apparus : créés tout de suite (le joueur local peut déjà y faire référence).
    const fresh: [NetObject, GameTick['objects'][number]][] = [];
    for (const o of t.objects) {
      let rec = this.objects.get(o.id);
      if (!rec) {
        const kind = (o.k ?? '') as NetKind;
        if (!(kind in NET_KINDS)) continue;
        const obj = Object.create(NET_KINDS[kind].proto) as NetObject['obj'];
        rec = { kind, obj, lastSeen: t.t };
        this.objects.set(o.id, rec);
        fresh.push([rec, o]);
      }
      rec.lastSeen = t.t;
    }
    for (const [rec, o] of fresh) {
      if (o.s) applyFields(rec.obj, o.s, this.refs);
      rec.obj.x = o.p[0];
      rec.obj.y = o.p[1];
    }

    this.reconcile(t);
    this.queue.push(t);
  }

  /** Joueur local : état du serveur, puis on rejoue les commandes pas encore traitées. */
  private reconcile(t: GameTick): void {
    const mine = t.heroes[this.localId];
    if (!mine) return;
    const p = this.player;
    if (mine.s) applyFields(p, mine.s, this.refs);
    p.x = mine.p[0];
    p.y = mine.p[1];
    const ack = t.acks[this.localId] ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    if (t.match.countdown > 0) return;
    for (const i of this.pending) p.predictMove(i.dt, { x: i.mx, y: i.my }, this.arena);
  }

  private end(r: GameOver): void {
    // On affiche ce qui restait en attente, puis le classement final du serveur.
    for (const t of this.queue) this.apply(t);
    this.queue = [];
    this.setScores(r.scores);
    this.over = true;
  }

  // ------------------------------------------------------------ affichage retardé

  /** Avance l'instant affiché, applique les instantanés passés, interpole les positions. */
  private advance(dt: number): void {
    // L'horloge d'affichage suit le dernier instantané reçu, avec INTERP_DELAY de retard :
    // légèrement accélérée ou ralentie pour rattraper la cible, recalée si l'écart est grand.
    const target = this.latestT - INTERP_DELAY;
    const gap = target - this.renderT;
    if (Math.abs(gap) > 0.5) this.renderT = target;
    else this.renderT += dt * (1 + Math.max(-0.2, Math.min(0.2, gap * 2)));

    while (this.queue.length && this.queue[0].t <= this.renderT) this.apply(this.queue.shift()!);
    const cur = this.current;
    if (!cur) return;
    const next = this.queue[0];
    const span = next ? next.t - cur.t : 0;
    const a = span > 0 ? Math.max(0, Math.min(1, (this.renderT - cur.t) / span)) : 0;

    for (const [id, h] of this.heroById) {
      if (h === this.player) continue;
      const pa = cur.heroes[id]?.p;
      const pb = next?.heroes[id]?.p;
      if (!pa) continue;
      if (!pb) {
        [h.x, h.y, h.aim] = pa;
        continue;
      }
      h.x = lerp(pa[0], pb[0], a);
      h.y = lerp(pa[1], pb[1], a);
      h.aim = lerpAngle(pa[2], pb[2], a);
    }
    if (next) {
      const nextPos = new Map(next.objects.map((o) => [o.id, o.p]));
      for (const o of cur.objects) {
        const rec = this.objects.get(o.id);
        const pb = nextPos.get(o.id);
        if (!rec || !pb) continue;
        rec.obj.x = lerp(o.p[0], pb[0], a);
        rec.obj.y = lerp(o.p[1], pb[1], a);
      }
    }
    // Temps du monde (animations, séchage des flaques) : celui de l'instant affiché.
    this.world.time = cur.wt + (cur.match.countdown > 0 ? 0 : Math.max(0, Math.min(0.1, this.renderT - cur.t)));
  }

  /** Applique un instantané : états, objets du monde, effets, dégâts, scores. */
  private apply(t: GameTick): void {
    const w = this.world;
    // --- héros (le joueur local est déjà à jour : voir reconcile)
    for (const [id, h] of this.heroById) {
      if (h === this.player) continue;
      const ht = t.heroes[id];
      if (!ht) continue;
      if (ht.s) applyFields(h, ht.s, this.refs);
      [h.x, h.y, h.aim] = ht.p;
    }
    // Joueur parti : son héros quitte le monde (ses points restent au classement).
    w.heroes = this.participants.map((p) => p.hero).filter((h) => h === this.player || t.heroes[this.idOf(h)]);

    // --- objets du monde (projectiles, marteau, bombes, leurres...)
    const lists = { projectiles: [] as unknown[], objects: [] as unknown[], decoys: [] as unknown[] };
    for (const o of t.objects) {
      const rec = this.objects.get(o.id);
      if (!rec) continue;
      if (o.s) applyFields(rec.obj, o.s, this.refs);
      rec.obj.x = o.p[0];
      rec.obj.y = o.p[1];
      lists[NET_KINDS[rec.kind].list].push(rec.obj);
    }
    w.projectiles = lists.projectiles as typeof w.projectiles;
    w.objects = lists.objects as typeof w.objects;
    w.decoys = lists.decoys as typeof w.decoys;
    for (const [id, rec] of this.objects) if (rec.lastSeen <= t.t && !t.objects.some((o) => o.id === id)) this.objects.delete(id);

    // --- effets visuels, flaques, tremblements : rejoués tels quels
    const fx = w.effects as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
    for (const [name, ...args] of t.fx) fx[name]?.call(w.effects, ...args);
    for (const [x, y, r, now, team] of t.wet) w.wet.splash(x, y, r, now, team);
    for (const [m, x, y] of t.shakes) w.shakeAt(m, { x, y });

    // --- dégâts : fil des éliminations, marqueur de touche, chiffres (règles de MatchMode)
    for (const [targetRef, sourceId, dealt, killed, cause] of t.hits) {
      const target = (typeof targetRef === 'string' ? this.heroById.get(targetRef) : this.objects.get(targetRef)?.obj) as
        | Combatant
        | undefined;
      if (!target) continue;
      const source = sourceId ? (this.heroById.get(sourceId) ?? null) : null;
      if (source === this.player && target !== this.player) {
        w.effects.damageNumber(target.x, target.y - target.radius, dealt);
      }
      this.onDamage({ target, source, dealt, killed: killed === 1, cause: (cause ?? undefined) as DamageCause | undefined });
    }

    // --- règles du match
    this.countdown = t.match.countdown;
    this.remaining = t.match.remaining;
    this.setScores(t.match.scores);
    this.current = t;
  }

  private setScores(scores: Record<string, [number, number]>): void {
    for (const [id, [k, d]] of Object.entries(scores)) {
      const p = this.participantById.get(id);
      if (p) {
        p.kills = k;
        p.deaths = d;
      }
    }
  }

  private idOf(h: Hero): string {
    for (const [id, hero] of this.heroById) if (hero === h) return id;
    return '';
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
