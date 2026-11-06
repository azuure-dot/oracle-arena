import type { Effects } from '../effects/Effects';
import type { Bot } from '../entities/Bot';
import type { Projectile } from '../entities/Projectile';
import type { Arena } from '../world/Arena';
import type { Input } from './Input';

/** Ce qu'un héros peut lire / déclencher dans le monde pendant sa mise à jour. */
export interface GameContext {
  input: Input;
  aimX: number; // curseur en coordonnées monde
  aimY: number;
  arena: Arena;
  effects: Effects;
  time: number; // temps de jeu écoulé (s)
  bots: readonly Bot[];
  spawnProjectile(p: Projectile): void;
  /** Inflige des dégâts à un bot et gère stats, hitmarker et chiffres. Retourne les dégâts réels. */
  damageBot(bot: Bot, amount: number): number;
  shake(magnitude: number): void;
}
