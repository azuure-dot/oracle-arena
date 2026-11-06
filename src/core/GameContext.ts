import type { Effects } from '../effects/Effects';
import type { Combatant } from '../entities/Combatant';
import type { Projectile } from '../entities/Projectile';
import type { Hero } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import type { Vec2 } from './math';

/**
 * Ce qu'un héros peut lire / déclencher dans le monde pendant sa mise à jour.
 * Les commandes (clavier ou IA) ne sont PAS ici : chaque héros a les siennes.
 */
export interface GameContext {
  arena: Arena;
  effects: Effects;
  time: number; // temps de jeu écoulé (s)
  /** Tout ce qui peut être touché (héros + bots), y compris le héros lui-même. */
  targets: readonly Combatant[];
  spawnProjectile(p: Projectile): void;
  /** Inflige des dégâts (stats, hitmarker, score...). Retourne les dégâts réels. */
  damage(target: Combatant, amount: number, source: Hero | null): number;
  /** Où réapparaît ce héros après sa mort. */
  respawnPoint(hero: Hero): Vec2;
  /** Délai de réapparition (s) : 3 s par défaut, 8 s en Partie rapide. */
  respawnDelay: number;
  /** Tremblement d'écran, atténué avec la distance au joueur (un combat lointain ne secoue pas). */
  shake(magnitude: number, at: Vec2): void;
}
