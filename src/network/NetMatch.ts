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
import { applyFields, applyHeroMotion, NET_KINDS, type NetKind, type RefDecoder } from './netState';
import type { NetworkManager } from './NetworkManager';

/**
 * PARTIE EN LIGNE, CÔTÉ CLIENT (Deathmatch).
 *
 * Le serveur simule ; le client AFFICHE ce qu'il reçoit, avec trois techniques classiques :
 *
 * 1. Interpolation des autres joueurs : on affiche le monde avec un petit retard (75 ms au moins,
 *    plus si le réseau est irrégulier) sur l'horloge estimée du serveur, en glissant entre les
 *    deux instantanés qui encadrent cet instant. Les autres héros, projectiles et objets bougent
 *    donc sans à-coups, même à 30 Hz.
 * 2. Prédiction du joueur local : son déplacement est appliqué TOUT DE SUITE (Hero.predictMove),
 *    sans attendre l'aller-retour réseau. Sa visée aussi.
 * 3. Réconciliation : à chaque instantané, on repart de la position que le serveur a calculée
 *    pour la dernière commande qu'il a traitée (`acks`), puis on rejoue les commandes envoyées
 *    depuis. Le serveur appliquant chaque commande avec la même durée que le navigateur, l'écart
 *    est nul en temps normal ; un vrai écart (recul, ruée...) est absorbé en quelques images au
 *    lieu de faire sauter la caméra.
 *
 * 4. Ses propres actions au présent : les projectiles, objets (marteau, bombe, clones...) et effets
 *    visuels déclenchés par le joueur local sont affichés dès réception, sans le retard
 *    d'interpolation, et les projectiles sont prolongés jusqu'à l'instant présent. Le tir apparaît
 *    ainsi un aller-retour réseau après le clic, et non un aller-retour + ~100 ms.
 *
 * Les règles d'affichage (HUD, fil des éliminations, classement, tableau des scores) sont celles
 * du Deathmatch solo (DeathmatchMode, dont cette classe hérite) : seules les données viennent
 * du serveur.
 */

/**
 * Retard d'affichage des autres joueurs (s) : au moins 2 intervalles d'instantanés (2 × 33 ms),
 * plus une marge qui s'adapte à la gigue mesurée du réseau (voir advance()).
 */
const INTERP_MIN = 0.075;
const INTERP_MAX = 0.25;
/** Correction du joueur local plus grande que ça (px) : téléportation, réapparition... on saute. */
const SNAP_DISTANCE = 64;
/** Vitesse d'absorption d'une petite correction du joueur local (1/s) : ~90 % en 0,15 s. */
const SMOOTH_RATE = 15;
/** Commandes gardées en attente au maximum (≈ 2 s à 60 i/s). */
const MAX_PENDING = 120;

interface NetObject {
  kind: NetKind;
  obj: Record<string, unknown> & Vec2;
  /** Dernier instantané (temps serveur) où l'objet existait. */
  lastSeen: number;
  /** Lancé par le joueur local : affiché au présent (voir receive / advance). */
  mine: boolean;
  /** Objet du joueur local : dernière position reçue et vitesse, pour le prolonger jusqu'au présent. */
  at: { t: number; x: number; y: number; vx: number; vy: number };
}

/**
 * Certains objets calculent eux-mêmes leur position (le sanctuaire de Camellia suit son ange :
 * `x` et `y` y sont des accesseurs en lecture seule). Les modifier lèverait une erreur et
 * interromprait l'image : on ne place que les objets dont la position est un champ.
 */
const MOVABLE = new Map<object, boolean>();
function place(obj: object, x: number, y: number): void {
  const proto = Object.getPrototypeOf(obj) as object;
  let movable = MOVABLE.get(proto);
  if (movable === undefined) {
    let d: PropertyDescriptor | undefined;
    for (let o: object | null = proto; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, 'x');
    movable = !d || 'value' in d || !!d.set;
    MOVABLE.set(proto, movable);
  }
  if (!movable) return;
  const v = obj as Vec2;
  v.x = x;
  v.y = y;
}

/** Le champ `owner` (encodé `{ $h: id }`) désigne-t-il ce participant ? */
function ownedBy(fields: Record<string, unknown> | undefined, id: string): boolean {
  const owner = fields?.owner as { $h?: unknown } | null | undefined;
  return !!owner && typeof owner === 'object' && owner.$h === id;
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
  /** Instant affiché (horloge serveur, en retard du délai d'interpolation). */
  private renderT = 0;
  private latestT = 0;
  /**
   * Horloge du serveur estimée = horloge locale + `clockOffset`. On retient l'instantané arrivé le
   * plus « tôt » (le moins retardé par le réseau) : l'estimation ne tremble pas avec la gigue.
   */
  private clockOffset: number | null = null;
  /** Gigue moyenne des arrivées (s) : élargit le délai d'interpolation si le réseau est irrégulier. */
  private jitter = 0;

  /**
   * Correction du joueur local pas encore absorbée (px) : le héros est dessiné à
   * position prédite + écart, et l'écart fond en quelques images (pas de saut de caméra).
   */
  private smoothX = 0;
  private smoothY = 0;
  private shifted = false;

  private seq = 0;
  private pending: PlayerInput[] = [];
  private over = false;
  /** Mesures (débogage, console : __game.mode.netStats) : écart corrigé à chaque instantané (px). */
  readonly netStats = { corrections: [] as number[], starved: 0, frames: 0 };
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
    this.unshift();
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

    // Le reste d'une correction fond peu à peu ; le héros (et la caméra) est dessiné décalé d'autant.
    const k = Math.exp(-SMOOTH_RATE * dt);
    this.smoothX *= k;
    this.smoothY *= k;
    this.shift();
  }

  /** Dessin à la position lissée (appelé après la logique de l'image). */
  private shift(): void {
    if (this.shifted) return;
    this.player.x += this.smoothX;
    this.player.y += this.smoothY;
    this.shifted = true;
  }
  /** Retour à la position prédite « vraie » (avant toute logique). */
  private unshift(): void {
    if (!this.shifted) return;
    this.player.x -= this.smoothX;
    this.player.y -= this.smoothY;
    this.shifted = false;
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
    const sample = t.t - performance.now() / 1000;
    if (this.clockOffset === null || sample > this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * 0.01; // lente dérive (latence qui augmente)
    this.jitter += (this.clockOffset - sample - this.jitter) * 0.05;

    // Objets apparus : créés tout de suite (le joueur local peut déjà y faire référence).
    const fresh: [NetObject, GameTick['objects'][number]][] = [];
    const present = new Set<number>();
    for (const o of t.objects) {
      present.add(o.id);
      let rec = this.objects.get(o.id);
      if (!rec) {
        const kind = (o.k ?? '') as NetKind;
        if (!(kind in NET_KINDS)) continue;
        const obj = Object.create(NET_KINDS[kind].proto) as NetObject['obj'];
        const mine = ownedBy(o.s, this.localId);
        rec = { kind, obj, lastSeen: t.t, mine, at: { t: t.t, x: o.p[0], y: o.p[1], vx: 0, vy: 0 } };
        this.objects.set(o.id, rec);
        fresh.push([rec, o]);
      } else if (rec.mine) {
        // Objet du joueur local déjà connu : mis à jour tout de suite (pas d'attente).
        if (o.s) applyFields(rec.obj, o.s, this.refs);
        const span = t.t - rec.at.t;
        if (span > 0) rec.at = { t: t.t, x: o.p[0], y: o.p[1], vx: (o.p[0] - rec.at.x) / span, vy: (o.p[1] - rec.at.y) / span };
      }
      rec.lastSeen = t.t;
    }
    for (const [rec, o] of fresh) {
      if (o.s) applyFields(rec.obj, o.s, this.refs);
      place(rec.obj, o.p[0], o.p[1]);
      // Projectile : vitesse exacte (ligne droite) ; autre objet : estimée au prochain instantané.
      const v = rec.obj as { vx?: unknown; vy?: unknown };
      if (rec.mine && typeof v.vx === 'number' && typeof v.vy === 'number') rec.at = { ...rec.at, vx: v.vx, vy: v.vy };
    }
    // Objets du joueur local disparus (projectile arrivé, marteau rattrapé...) : retirés tout de suite.
    for (const [id, rec] of this.objects) if (rec.mine && !present.has(id)) this.objects.delete(id);

    // Effets, tremblements et dégâts déclenchés par le joueur local : tout de suite.
    this.playEvents(t, true);
    this.reconcile(t);
    this.rebuildLists();
    this.queue.push(t);
  }

  /**
   * Effets visuels, tremblements et dégâts d'un instantané. `mine` : seulement ceux du joueur
   * local (joués à la réception), sinon seulement ceux des autres (joués à l'instant affiché).
   */
  private playEvents(t: GameTick, mine: boolean): void {
    const w = this.world;
    const me = this.localId;
    const fx = w.effects as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
    for (const [actor, name, ...args] of t.fx) if ((actor === me) === mine) fx[name]?.call(w.effects, ...args);
    for (const [m, x, y, actor] of t.shakes) if ((actor === me) === mine) w.shakeAt(m, { x, y });

    // Dégâts : fil des éliminations, marqueur de touche, chiffres (règles de MatchMode).
    for (const [targetRef, sourceId, dealt, killed, cause] of t.hits) {
      if ((sourceId === me) !== mine) continue;
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
  }

  /**
   * Listes du monde : objets des autres tels qu'à l'instant affiché (dans l'ordre du serveur),
   * puis ceux du joueur local tels qu'au dernier instantané reçu.
   */
  private rebuildLists(): void {
    const w = this.world;
    const lists = { projectiles: [] as unknown[], objects: [] as unknown[], decoys: [] as unknown[] };
    for (const o of this.current?.objects ?? []) {
      const rec = this.objects.get(o.id);
      if (rec && !rec.mine) lists[NET_KINDS[rec.kind].list].push(rec.obj);
    }
    for (const rec of this.objects.values()) if (rec.mine) lists[NET_KINDS[rec.kind].list].push(rec.obj);
    w.projectiles = lists.projectiles as typeof w.projectiles;
    w.objects = lists.objects as typeof w.objects;
    w.decoys = lists.decoys as typeof w.decoys;
  }

  /** Joueur local : état du serveur, puis on rejoue les commandes pas encore traitées. */
  private reconcile(t: GameTick): void {
    const mine = t.heroes[this.localId];
    if (!mine) return;
    const p = this.player;
    this.unshift();
    const bx = p.x;
    const by = p.y;
    if (mine.s) applyFields(p, mine.s, this.refs);
    applyHeroMotion(p, mine.p, false); // la visée reste celle de la souris
    const ack = t.acks[this.localId] ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    if (t.match.countdown <= 0) for (const i of this.pending) p.predictMove(i.dt, { x: i.mx, y: i.my }, this.arena);

    // L'écart corrigé n'est pas appliqué d'un coup : il est absorbé en douceur (voir update()).
    const dx = bx - p.x;
    const dy = by - p.y;
    const c = this.netStats.corrections;
    c.push(Math.hypot(dx, dy));
    if (c.length > 600) c.shift();
    this.smoothX += dx;
    this.smoothY += dy;
    if (Math.hypot(this.smoothX, this.smoothY) > SNAP_DISTANCE || p.dead) this.smoothX = this.smoothY = 0;
    this.shift();
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
    // Instant affiché = horloge du serveur estimée − délai d'interpolation. Il avance au rythme
    // exact de l'horloge locale (aucune accélération / ralentissement), jamais en arrière.
    if (this.clockOffset === null) return;
    const delay = Math.min(INTERP_MAX, Math.max(INTERP_MIN, 2 / this.info.tickRate + 3 * this.jitter));
    const target = performance.now() / 1000 + this.clockOffset - delay;
    if (target - this.renderT > 0.5 || !this.current) this.renderT = target; // départ, ou gros retard
    else this.renderT = Math.max(this.renderT + dt * 0.5, Math.min(target, this.renderT + dt * 1.5));

    while (this.queue.length && this.queue[0].t <= this.renderT) this.apply(this.queue.shift()!);
    const cur = this.current;
    if (!cur) return;
    const next = this.queue[0];
    this.netStats.frames++;
    if (!next) this.netStats.starved++; // plus d'instantané d'avance : les autres se figent
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
    // Ses propres objets : dernière position reçue, prolongée jusqu'à l'instant présent du serveur.
    const now = performance.now() / 1000 + this.clockOffset;
    for (const rec of this.objects.values()) {
      if (!rec.mine) continue;
      const ahead = Math.max(0, Math.min(0.1, now - rec.at.t));
      place(rec.obj, rec.at.x + rec.at.vx * ahead, rec.at.y + rec.at.vy * ahead);
    }
    if (next) {
      const nextPos = new Map(next.objects.map((o) => [o.id, o.p]));
      for (const o of cur.objects) {
        const rec = this.objects.get(o.id);
        const pb = nextPos.get(o.id);
        if (!rec || !pb || rec.mine) continue;
        place(rec.obj, lerp(o.p[0], pb[0], a), lerp(o.p[1], pb[1], a));
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
      applyHeroMotion(h, ht.p, true);
    }
    // Joueur parti : son héros quitte le monde (ses points restent au classement).
    w.heroes = this.participants.map((p) => p.hero).filter((h) => h === this.player || t.heroes[this.idOf(h)]);

    // --- objets du monde des autres (ceux du joueur local sont déjà à jour : voir receive)
    const present = new Set<number>();
    for (const o of t.objects) {
      present.add(o.id);
      const rec = this.objects.get(o.id);
      if (!rec || rec.mine) continue;
      if (o.s) applyFields(rec.obj, o.s, this.refs);
      place(rec.obj, o.p[0], o.p[1]);
    }
    for (const [id, rec] of this.objects) if (!rec.mine && rec.lastSeen <= t.t && !present.has(id)) this.objects.delete(id);

    // --- effets visuels, flaques, tremblements, dégâts des autres : rejoués tels quels
    for (const [x, y, r, now, team] of t.wet) w.wet.splash(x, y, r, now, team);
    this.playEvents(t, false);

    // --- règles du match
    this.countdown = t.match.countdown;
    this.remaining = t.match.remaining;
    this.setScores(t.match.scores);
    this.current = t;
    this.rebuildLists();
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
