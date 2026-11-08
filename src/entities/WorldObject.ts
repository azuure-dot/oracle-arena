import type { GameContext } from '../core/GameContext';
import type { Team } from './Team';

/**
 * Objet du monde qui vit indépendamment de son lanceur (bombe à eau de Turty...) :
 * il continue même si le lanceur meurt, et il est dessiné même si le lanceur est caché
 * (seulement là où le joueur a la vue, comme les projectiles adverses).
 */
export interface WorldObject {
  readonly team: Team;
  /** Point de référence pour la visibilité (là où l'objet est / va tomber). */
  readonly x: number;
  readonly y: number;
  /** Retourne false quand l'objet a fini (il est alors retiré). */
  update(dt: number, ctx: GameContext): boolean;
  /** Au sol, sous les entités (zone d'impact...). */
  drawUnder(ctx: CanvasRenderingContext2D): void;
  /** Au-dessus des entités (explosion...). */
  drawOver(ctx: CanvasRenderingContext2D): void;
  /** En l'air, par-dessus les murs (bombe en vol). */
  drawSky?(ctx: CanvasRenderingContext2D): void;
}
