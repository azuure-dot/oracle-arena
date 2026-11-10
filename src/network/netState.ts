import { Projectile } from '../entities/Projectile';
import { LittleAngel, SanctuaryAngel, SanctuaryZone } from '../heroes/Camellia';
import { HoloClone } from '../heroes/Flux';
import { Hero } from '../heroes/Hero';
import { Magazine } from '../heroes/Magazine';
import { ThrownHammer } from '../heroes/Thor';
import { WaterBomb } from '../heroes/Turty';

/**
 * ÉTAT RÉSEAU DES ENTITÉS — partagé par le serveur (qui encode) et le client (qui décode).
 * Aucune dépendance au DOM : le serveur Node importe ce fichier tel quel.
 *
 * Plutôt que d'écrire à la main un « paquet réseau » pour chaque héros (des dizaines de champs
 * d'animation, de compétences, de chargeurs...), on sérialise automatiquement les champs PROPRES
 * des objets du jeu :
 * - nombres (arrondis au centième), textes, booléens, null ;
 * - tableaux et objets simples (récursivement) ;
 * - les chargeurs (`Magazine`), seule classe « valeur » recopiée champ par champ ;
 * - une référence à un héros devient `{ $h: id }`, à un objet du monde `{ $o: id }` : le client
 *   la remplace par SA copie de l'entité (graphe d'objets reconstitué) ;
 * - tout le reste (fonctions, Set, Map, tableaux typés, images...) est ignoré.
 * Le client applique ces champs sur ses propres instances (créées par le registre des héros,
 * ou par `Object.create(prototype)` pour les objets) : le code de DESSIN existant marche tel quel.
 */

export type NetValue = number | string | boolean | null | NetValue[] | { [k: string]: NetValue };
export type NetFields = Record<string, NetValue>;

/** Types d'objets du monde transmis, et la liste du monde où ils vivent. */
export const NET_KINDS = {
  projectile: { proto: Projectile.prototype, list: 'projectiles' },
  hammer: { proto: ThrownHammer.prototype, list: 'objects' },
  waterBomb: { proto: WaterBomb.prototype, list: 'objects' },
  sanctuaryZone: { proto: SanctuaryZone.prototype, list: 'objects' },
  littleAngel: { proto: LittleAngel.prototype, list: 'objects' },
  holoClone: { proto: HoloClone.prototype, list: 'decoys' },
  sanctuaryAngel: { proto: SanctuaryAngel.prototype, list: 'decoys' },
} as const;
export type NetKind = keyof typeof NET_KINDS;

const KIND_BY_PROTO = new Map<object, NetKind>(
  (Object.keys(NET_KINDS) as NetKind[]).map((k) => [NET_KINDS[k].proto, k]),
);

/** Type réseau d'un objet du monde (undefined : objet inconnu, non transmis). */
export function kindOf(o: object): NetKind | undefined {
  return KIND_BY_PROTO.get(Object.getPrototypeOf(o));
}

/**
 * Méthodes de `Effects` enregistrées par le serveur et rejouées par chaque client (étincelles,
 * anneaux, éclairs...) : le serveur n'affiche rien, il transmet seulement les appels.
 */
export const FX_METHODS = ['wedge', 'sparks', 'damageNumber', 'afterimage', 'ring', 'text', 'bolt', 'lightningBurst'] as const;

/** Classes « valeur » : recopiées champ par champ, et mises à jour EN PLACE chez le client. */
const VALUE_CLASSES: object[] = [Magazine.prototype];

/** Champs jamais transmis pour un héros (propres au client, ou envoyés à part). */
export const HERO_SKIP = new Set([
  'controls', // le client a ses propres commandes
  'stats',
  'isLocalPlayer',
  'outline',
  'label',
  'visible', // calculé par chaque client (sa ligne de vue)
  'team', // donné par la liste des participants
  'damageMultiplier',
  'radius',
  'moveDir', // peut pointer vers l'objet des commandes : jamais recopié
  'x', // x, y, visée : envoyés à part à chaque instantané (interpolation)
  'y',
  'aim',
]);
/** Champs jamais transmis pour un objet du monde. */
export const OBJECT_SKIP = new Set(['visible', 'x', 'y']);

const MAX_DEPTH = 6;

/** Résout un objet du jeu en référence réseau (encodage côté serveur). */
export interface RefEncoder {
  heroId(h: Hero): string | undefined;
  objectId(o: object): number | undefined;
}

function round(n: number): number {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 0 : n > 0 ? 1e9 : -1e9; // JSON n'a pas d'Infinity
  return Math.round(n * 100) / 100;
}

function encodeValue(v: unknown, refs: RefEncoder, depth: number): NetValue | undefined {
  if (v === null) return null;
  switch (typeof v) {
    case 'number':
      return round(v);
    case 'string':
    case 'boolean':
      return v;
    case 'object':
      break;
    default:
      return undefined; // undefined, fonctions, symboles
  }
  if (depth > MAX_DEPTH) return undefined;
  const o = v as object;
  if (Array.isArray(o)) {
    return o.map((x) => encodeValue(x, refs, depth + 1) ?? null);
  }
  if (o instanceof Hero) {
    const id = refs.heroId(o);
    return id === undefined ? null : { $h: id };
  }
  const objId = refs.objectId(o);
  if (objId !== undefined) return { $o: objId };
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null && !VALUE_CLASSES.includes(proto)) {
    // Combattant d'un autre type (bot d'entraînement...) ou objet technique : ignoré.
    return kindOf(o) || o instanceof Hero ? null : undefined;
  }
  const out: Record<string, NetValue> = {};
  for (const k of Object.keys(o)) {
    const e = encodeValue((o as Record<string, unknown>)[k], refs, depth + 1);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/** Tous les champs transmissibles d'une entité. */
export function encodeFields(obj: object, skip: ReadonlySet<string>, refs: RefEncoder): NetFields {
  const out: NetFields = {};
  for (const k of Object.keys(obj)) {
    if (skip.has(k)) continue;
    const e = encodeValue((obj as Record<string, unknown>)[k], refs, 1);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/**
 * Différence avec le dernier envoi (champ de premier niveau par champ de premier niveau).
 * `last` garde le JSON de chaque champ déjà envoyé ; il est mis à jour.
 * Retourne null si rien n'a changé.
 */
export function diffFields(fields: NetFields, last: Map<string, string>): NetFields | null {
  let out: NetFields | null = null;
  for (const k of Object.keys(fields)) {
    const json = JSON.stringify(fields[k]);
    if (last.get(k) === json) continue;
    last.set(k, json);
    (out ??= {})[k] = fields[k];
  }
  for (const k of last.keys()) {
    if (k in fields) continue;
    last.delete(k);
    (out ??= {})[k] = null; // champ disparu (ex. référence vers un objet retiré)
  }
  return out;
}

// ------------------------------------------------------------------ décodage (client)

/** Résout une référence réseau vers l'entité du client (decodage). */
export interface RefDecoder {
  hero(id: string): Hero | undefined;
  object(id: number): object | undefined;
}

function decodeValue(current: unknown, v: NetValue, refs: RefDecoder): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x, i) => decodeValue(Array.isArray(current) ? current[i] : undefined, x, refs));
  if (typeof v.$h === 'string') return refs.hero(v.$h) ?? null;
  if (typeof v.$o === 'number') return refs.object(v.$o) ?? null;
  // Classe valeur (chargeur) : mise à jour en place, elle garde ses méthodes.
  if (current && typeof current === 'object' && VALUE_CLASSES.includes(Object.getPrototypeOf(current))) {
    for (const k of Object.keys(v)) {
      (current as Record<string, unknown>)[k] = decodeValue((current as Record<string, unknown>)[k], v[k], refs);
    }
    return current;
  }
  // Objet simple : toujours un NOUVEL objet (jamais muter un objet partagé ailleurs).
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = decodeValue(undefined, v[k], refs);
  return out;
}

/** Applique des champs reçus sur une entité du client. */
export function applyFields(target: object, fields: NetFields, refs: RefDecoder): void {
  const t = target as Record<string, unknown>;
  for (const k of Object.keys(fields)) t[k] = decodeValue(t[k], fields[k], refs);
}
