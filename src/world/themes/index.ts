import type { Arena } from '../Arena';
import { VOLCANO_THEME } from './volcano';

/**
 * Habillage d'une carte : sol et murs dessinés en pixel art (un pixel du décor =
 * `pixel` unités monde), plus des animations du sol (lave...).
 * Les caches sont en basse résolution et agrandis sans lissage par l'Arena.
 */
export interface MapTheme {
  /** Taille d'un pixel de l'image du sol en cache, en unités monde. */
  readonly pixel: number;
  /** Image du sol agrandie avec lissage (dessin vectoriel) plutôt qu'en gros pixels. */
  readonly smooth?: boolean;
  /** Peint le sol dans `g` (canvas de largeur/pixel × hauteur/pixel). */
  renderFloor(g: CanvasRenderingContext2D, arena: Arena): void;
  /** Murs en image (résolution décor, fond transparent)... */
  renderWalls?(arena: Arena): HTMLCanvasElement;
  /** ... ou dessinés à chaque image en coordonnées monde (nets à tout zoom). */
  drawWalls?(ctx: CanvasRenderingContext2D, arena: Arena): void;
  /** Animations au sol, dessinées chaque frame en coordonnées monde (sous les entités). */
  drawLive?(ctx: CanvasRenderingContext2D, arena: Arena, time: number): void;
  /** Libère les images propres à cette arène (fin de partie). */
  dispose?(arena: Arena): void;
}

export const THEMES: Record<'volcano', MapTheme> = {
  volcano: VOLCANO_THEME,
};
