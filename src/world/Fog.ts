import { FOG, VISION } from '../config';
import type { ViewTransform } from '../core/Camera';
import type { VisPoint } from './Visibility';

/**
 * Brouillard de guerre, en deux couches :
 *
 * 1. drawLineOfSight() — ombre des murs (masque Canvas) :
 *    on remplit un calque hors-écran en sombre, puis en mode `destination-out`
 *    on y découpe le polygone de visibilité, LIMITÉ à la zone de vision.
 *    Calque en quart de résolution, agrandi avec lissage : bords doux, sans filtre
 *    de flou (trop coûteux à chaque image).
 *
 * 2. drawVisionLimit() — périmètre de vision :
 *    tout ce qui sort du cercle de vision centré sur le joueur est assombri
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
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.fillStyle = `rgba(3,5,9,${FOG.opacity})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (poly.length >= 3) {
      g.save();
      g.setTransform(s * view.scale, 0, 0, s * view.scale, s * view.tx, s * view.ty);
      // On ne révèle que l'intérieur du cercle de vision.
      g.beginPath();
      g.arc(eyeX, eyeY, VISION.radius, 0, Math.PI * 2);
      g.clip();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.closePath();
      g.fillStyle = '#000';
      g.fill();
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, viewW, viewH);
    ctx.restore();
  }

  /** Ombre au-delà du cercle de vision (à dessiner APRÈS les murs pour les assombrir aussi). */
  drawVisionLimit(
    ctx: CanvasRenderingContext2D,
    view: ViewTransform,
    eyeX: number,
    eyeY: number,
    viewW: number,
    viewH: number,
  ): void {
    const cx = eyeX * view.scale + view.tx;
    const cy = eyeY * view.scale + view.ty;
    const r = VISION.radius * view.scale;
    const f = VISION.edgeFade * view.scale;
    const dark = (a: number) => 'rgba(3,5,9,' + a + ')';

    // Extérieur du cercle : écran entier moins le disque (règle evenodd).
    ctx.fillStyle = dark(VISION.outsideOpacity);
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill('evenodd');

    // Dégradé sur le bord intérieur : la vision "s'éteint" progressivement.
    const grad = ctx.createRadialGradient(cx, cy, Math.max(0, r - f), cx, cy, r);
    grad.addColorStop(0, dark(0));
    grad.addColorStop(1, dark(VISION.outsideOpacity));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
