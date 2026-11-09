import type { GameContext } from '../core/GameContext';
import type { Hero } from '../heroes/Hero';
import type { Circle } from '../core/geometry';
import type { BuffKind } from '../ui/healthBar';
import type { Team } from './Team';

/**
 * Tout ce qui peut être touché : bots du champ de tir ET héros (joueur ou bots).
 * Les compétences des héros (mêlée, marteau, Onde de choc, Charge, aura...)
 * ne visent que des Combatant : elles fonctionnent donc contre n'importe qui.
 */
export interface Combatant {
  readonly team: Team;
  x: number;
  y: number;
  /** Rayon de la boule : hitbox ronde (dégâts et collisions). */
  readonly radius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  /** Protégé dans sa zone de spawn (les bots ne le prennent pas pour cible). */
  readonly safe?: boolean;
  /** Invisible pour l'adversaire (Frappe fantôme de Flux) : ni affiché, ni pris pour cible. */
  readonly stealthed?: boolean;
  /** Leurre (clone holographique) : touchable, mais hors score et fil des éliminations. */
  readonly decoy?: boolean;
  /**
   * Protection contre la mort (Sanctuaire de Camellia) : tant que `until` (temps de jeu) n'est
   * pas passé, les dégâts ne font pas descendre sous `floor` PV (sauf la lave).
   */
  guard?: { floor: number; until: number };
  /** Tenu par une Charge : sa position est pilotée par le Rempart qui charge. */
  pinned: boolean;
  /** Buffs d'aura (Tempo, Skater), soin et vitesse pouvant se cumuler : remis à zéro chaque frame par le monde. */
  buffs: BuffKind[];
  auraSpeedMul: number;
  circle(): Circle;
  /** Retourne les dégâts réellement infligés (0 si immunisé). */
  takeDamage(amount: number, ctx: GameContext): number;
  heal(amount: number): void;
  /** Recul ; `source` : le héros qui pousse (crédité si la cible tombe dans la lave). */
  applyImpulse(ix: number, iy: number, source?: Hero): void;
  /** Note qui vient de déplacer de force cette cible (Charge) : crédit d'une chute dans la lave. */
  notePush?(source: Hero): void;
  /** Étourdi : ne peut ni bouger ni agir pendant `seconds`. */
  stun(seconds: number): void;
  readonly stunTimer: number;
}

/** Deux entités sont ennemies si elles ne sont pas dans la même équipe. */
export const hostile = (a: { team: Team }, b: { team: Team }): boolean => a.team !== b.team;
