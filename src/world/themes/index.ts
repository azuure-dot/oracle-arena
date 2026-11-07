import type { Arena } from '../Arena';
import { VOLCANO_THEME } from './volcano';

/**
 * Habillage d'une carte : sol et murs dessinés en pixel art (un pixel du décor =
 * `pixel` unités monde), plus des animations du sol (lave...).
 * Les caches sont en basse résolution et agrandis sans lissage par l'Arena.
 */
export interface MapTheme {
  /** Taille d'un pixel du décor, en unités monde. */
  readonly pixel: number;
  /** Peint le sol dans `g` (canvas de largeur/pixel × hauteur/pixel). */
  renderFloor(g: CanvasRenderingContext2D, arena: Arena): void;
  /** Murs en résolution décor, fond transparent. */
  renderWalls(arena: Arena): HTMLCanvasElement;
  /** Animations au sol, dessinées chaque frame en coordonnées monde (sous les entités). */
  drawLive?(ctx: CanvasRenderingContext2D, arena: Arena, time: number): void;
}

export const THEMES: Record<'volcano', MapTheme> = {
  volcano: VOLCANO_THEME,
};
