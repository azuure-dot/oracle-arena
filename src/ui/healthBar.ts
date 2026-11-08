import { COLORS } from '../config';

/** Buff d'aura reçu (Tempo, Skater) : affiché à côté de la barre de vie. */
export type BuffKind = 'heal' | 'speed';

/** Ajoute un buff pour cette frame (une seule fois par type, même avec plusieurs auras). */
export function addBuff(c: { buffs: BuffKind[] }, kind: BuffKind): void {
  if (!c.buffs.includes(kind)) c.buffs.push(kind);
}

/** Tous les buffs reçus, côte à côte à droite de la barre de vie (soin puis vitesse). */
export function drawBuffIndicators(ctx: CanvasRenderingContext2D, x: number, cy: number, buffs: readonly BuffKind[]): void {
  let i = 0;
  for (const kind of ['heal', 'speed'] as const) {
    if (!buffs.includes(kind)) continue;
    drawBuffIndicator(ctx, x + i * 21, cy, kind);
    i++;
  }
}

/**
 * Barre de vie segmentée dessinée au-dessus d'une entité.
 * Un segment = 25 PV (100 PV pour les gros réservoirs, sinon illisible).
 */
export function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  hp: number,
  maxHp: number,
  color: string,
  width = 56,
): void {
  const h = 7;
  const x = cx - width / 2;
  const y = topY - h;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 2, y - 2, width + 4, h + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, width, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * ratio, h);

  const seg = maxHp > 300 ? 100 : 25;
  const segments = Math.floor(maxHp / seg);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 1; i < segments; i++) {
    const sx = x + (width * i * seg) / maxHp;
    ctx.fillRect(Math.round(sx), y, 1, h);
  }
}

/**
 * Indicateur de buff centré en (cx, cy) :
 *  - "+" jaune : reçoit du soin
 *  - ">>" vert : reçoit le boost de vitesse
 */
export function drawBuffIndicator(ctx: CanvasRenderingContext2D, cx: number, cy: number, kind: BuffKind): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'heal') {
    ctx.fillStyle = COLORS.auraHeal;
    ctx.fillRect(cx - 1.75, cy - 6, 3.5, 12);
    ctx.fillRect(cx - 6, cy - 1.75, 12, 3.5);
  } else {
    ctx.strokeStyle = COLORS.auraSpeed;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Deux chevrons centrés dans le rond (de cx - 4,5 à cx + 4,5) : rien ne dépasse.
    for (const ox of [-2, 2.5]) {
      ctx.beginPath();
      ctx.moveTo(cx + ox - 2.5, cy - 4);
      ctx.lineTo(cx + ox + 2, cy);
      ctx.lineTo(cx + ox - 2.5, cy + 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Étoiles qui tournent autour de la tête d'un personnage étourdi. */
export function drawStunStars(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const t = performance.now() / 1000;
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const a = t * 5 + (i * Math.PI * 2) / 3;
    const x = cx + Math.cos(a) * 18;
    const y = cy + Math.sin(a) * 6;
    ctx.fillStyle = '#ffe066';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 5 : 2.2;
      const ang = (k * Math.PI) / 5 - Math.PI / 2;
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
