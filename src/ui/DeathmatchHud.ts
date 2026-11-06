import { COLORS } from '../config';
import { ordinal, t } from '../i18n';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

export interface DeathmatchHudFrame {
  remaining: number; // s
  kills: number;
  rank: number;
  total: number;
}

/** Bandeau du Deathmatch : chrono, éliminations, position. */
export function drawDeathmatchBar(ctx: CanvasRenderingContext2D, width: number, f: DeathmatchHudFrame): void {
  const cx = width / 2;
  const top = 14;
  const timerW = 128;
  const sideW = 120;
  const h = 58;

  // Chrono au centre
  const secs = Math.ceil(f.remaining);
  const txt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const urgent = f.remaining <= 10;
  ctx.fillStyle = 'rgba(10,14,20,0.78)';
  ctx.fillRect(cx - timerW / 2, top, timerW, h);
  ctx.strokeStyle = urgent ? COLORS.enemy : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - timerW / 2 + 1, top + 1, timerW - 2, h - 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = urgent && Math.floor(f.remaining * 4) % 2 === 0 ? COLORS.enemy : COLORS.hud;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(txt, cx, top + 42);

  // Éliminations (gauche) et position (droite)
  const side = (x: number, label: string, value: string, color: string) => {
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.fillRect(x, top + 6, sideW, h - 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.hudDim;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(label, x + sideW / 2, top + 22);
    ctx.fillStyle = color;
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(value, x + sideW / 2, top + 45);
  };
  side(cx - timerW / 2 - 8 - sideW, t('hud.dm.kills'), String(f.kills), COLORS.accent);
  side(
    cx + timerW / 2 + 8,
    t('hud.dm.position'),
    `${ordinal(f.rank)} / ${f.total}`,
    f.rank === 1 ? COLORS.auraHeal : COLORS.hud,
  );
}
