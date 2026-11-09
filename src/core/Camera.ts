import { VISION } from '../config';

/** Transformation monde → écran (en px CSS) : écran = monde * scale + (tx, ty). */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Caméra verrouillée sur le joueur.
 *
 * - Elle est TOUJOURS centrée sur le joueur (pas de bornage aux bords de la map,
 *   pas de lissage) : si le joueur bouge, le monde défile sous le curseur et il faut
 *   réellement suivre sa cible à la souris.
 * - Le zoom est calculé pour que le cadre 16:9 de VISION remplisse l'écran :
 *   tous les joueurs voient la même surface de monde, quelle que soit la taille de leur écran.
 */

export class Camera {
  /** Centre de la caméra, en coordonnées monde. */
  cx = 0;
  cy = 0;
  zoom = 1;
  viewW = 0;
  viewH = 0;

  private shakeTime = 0;
  private shakeMag = 0;
  private static readonly SHAKE_DURATION = 0.3;

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    // Le cadre 16:9 de VISION (déjà réduit du zoom, voir CAMERA_ZOOM) remplit l'écran.
    this.zoom = Math.min(w / VISION.width, h / VISION.height);
  }

  centerOn(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
  }

  update(dt: number): void {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
  }

  shake(magnitude: number): void {
    this.shakeMag = this.shakeTime > 0 ? Math.max(this.shakeMag, magnitude) : magnitude;
    this.shakeTime = Camera.SHAKE_DURATION;
  }

  /** Transformation de rendu de la frame (tremblement inclus), arrondie au pixel. */
  transform(): ViewTransform {
    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      const k = this.shakeMag * (this.shakeTime / Camera.SHAKE_DURATION);
      sx = (Math.random() * 2 - 1) * k;
      sy = (Math.random() * 2 - 1) * k;
    }
    return {
      scale: this.zoom,
      tx: Math.round(this.viewW / 2 - (this.cx + sx) * this.zoom),
      ty: Math.round(this.viewH / 2 - (this.cy + sy) * this.zoom),
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.cx + (sx - this.viewW / 2) / this.zoom,
      y: this.cy + (sy - this.viewH / 2) / this.zoom,
    };
  }
}
