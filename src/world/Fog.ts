import { FOG, VISION } from '../config';
import type { ViewTransform } from '../core/Camera';
import type { VisPoint } from './Visibility';

/**
 * Brouillard de guerre, en deux couches :
 *
 * 1. drawLineOfSight() — ombre des murs (masque Canvas) :
 *    on remplit un calque hors-écran en sombre, puis en mode `destination-out`
 *    on y découpe le polygone de visibilité, LIMITÉ à la zone de vision.
 *    Calque en demi-résolution + léger flou : bords doux et rendu moins coûteux.
 *
 * 2. drawVisionLimit() — périmètre de vision :
 *    tout ce qui sort du rectangle 16:9 centré sur le joueur est quasi noir
 *    (murs compris), avec un dégradé sur le bord intérieur.
 */
export class Fog {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;

  constructor() {
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D non supporté');
    this.g = g;
  }

  resize(viewW: number, viewH: number): void {
    this.canvas.width = Math.max(1, Math.ceil(viewW * FOG.resolution));
    this.canvas.height = Math.max(1, Math.ceil(viewH * FOG.resolution));
  }

  /** `ctx` doit être en espace écran (px CSS). */
  drawLineOfSight(
    ctx: CanvasRenderingContext2D,
    poly: readonly VisPoint[],
    view: ViewTransform,
    eyeX: number,
    eyeY: number,
    viewW: number,
    viewH: number,
  ): void {
    const g = this.g;
    const s = FOG.resolution;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.fillStyle = `rgba(3,5,9,${FOG.opacity})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (poly.length >= 3) {
      g.save();
      g.setTransform(s * view.scale, 0, 0, s * view.scale, s * view.tx, s * view.ty);
      // On ne révèle que l'intérieur de la zone de vision.
      g.beginPath();
      g.rect(eyeX - VISION.width / 2, eyeY - VISION.height / 2, VISION.width, VISION.height);
      g.clip();
      g.globalCompositeOperation = 'destination-out';
      g.filter = `blur(${FOG.blurPx}px)`;
      g.beginPath();
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.closePath();
      g.fillStyle = '#000';
      g.fill();
      g.restore();
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, viewW, viewH);
  }

  /** Ombre au-delà du périmètre de vision (à dessiner APRÈS les murs pour les masquer aussi). */
  drawVisionLimit(
    ctx: CanvasRenderingContext2D,
    view: ViewTransform,
    eyeX: number,
    eyeY: number,
    viewW: number,
    viewH: number,
  ): void {
    const x0 = (eyeX - VISION.width / 2) * view.scale + view.tx;
    const y0 = (eyeY - VISION.height / 2) * view.scale + view.ty;
    const w = VISION.width * view.scale;
    const h = VISION.height * view.scale;
    const dark = (a: number) => `rgba(3,5,9,${a})`;

    // Extérieur de la zone : écran entier moins le rectangle (règle evenodd).
    ctx.fillStyle = dark(VISION.outsideOpacity);
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.rect(x0, y0, w, h);
    ctx.fill('evenodd');

    // Dégradé sur le bord intérieur : la vision "s'éteint" progressivement.
    const f = VISION.edgeFade * view.scale;
    const edges: [number, number, number, number, number, number, number, number][] = [
      [x0, y0, w, f, x0, y0, x0, y0 + f], // haut
      [x0, y0 + h - f, w, f, x0, y0 + h, x0, y0 + h - f], // bas
      [x0, y0, f, h, x0, y0, x0 + f, y0], // gauche
      [x0 + w - f, y0, f, h, x0 + w, y0, x0 + w - f, y0], // droite
    ];
    for (const [rx, ry, rw, rh, gx0, gy0, gx1, gy1] of edges) {
      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, dark(VISION.outsideOpacity * 0.85));
      grad.addColorStop(1, dark(0));
      ctx.fillStyle = grad;
      ctx.fillRect(rx, ry, rw, rh);
    }
  }
}
