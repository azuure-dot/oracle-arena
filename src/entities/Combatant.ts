import type { GameContext } from '../core/GameContext';
import type { Box } from '../core/geometry';
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
  readonly hw: number;
  readonly hh: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  /** Protégé dans sa zone de spawn (les bots ne le prennent pas pour cible). */
  readonly safe?: boolean;
  /** Tenu par une Charge : sa position est pilotée par le Rempart qui charge. */
  pinned: boolean;
  /** Buffs d'aura de Tempo : remis à zéro chaque frame par le monde. */
  buff: BuffKind | null;
  auraSpeedMul: number;
  box(): Box;
  /** Retourne les dégâts réellement infligés (0 si immunisé). */
  takeDamage(amount: number, ctx: GameContext): number;
  heal(amount: number): void;
  applyImpulse(ix: number, iy: number): void;
}

/** Deux entités sont ennemies si elles ne sont pas dans la même équipe. */
export const hostile = (a: { team: Team }, b: { team: Team }): boolean => a.team !== b.team;
