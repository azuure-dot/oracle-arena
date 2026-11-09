import type { GameContext } from '../core/GameContext';
import type { Hero } from '../heroes/Hero';
import type { Combatant } from './Combatant';

/**
 * Leurre (clone holographique de Flux...) : une cible comme une autre pour l'adversaire
 * (les bots le prennent pour cible, les tirs le touchent et le font éclater), mais qui ne
 * compte ni dans le score ni dans le fil des éliminations. Le monde le met à jour et le
 * dessine selon qui regarde : un adversaire le voit comme le vrai héros, un allié le voit
 * translucide.
 */
export interface Decoy extends Combatant {
  readonly decoy: true;
  /** Visible par le joueur (calculé chaque frame par le monde). */
  visible: boolean;
  /** Retourne false quand le leurre a disparu (il est alors retiré du monde). */
  update(dt: number, ctx: GameContext): boolean;
  /** `viewer` : le héros du joueur (null = fond des menus). */
  draw(ctx: CanvasRenderingContext2D, viewer: Hero | null): void;
  drawOverlay(ctx: CanvasRenderingContext2D, viewer: Hero | null): void;
}
