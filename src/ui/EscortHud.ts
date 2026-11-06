import { COLORS } from '../config';
import type { PayloadStatus } from '../game/Payload';
import { t, type TKey } from '../i18n';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const CONTEST = '#ffb347';

export interface EscortBarFrame {
  timeLeft: number;
  phase: 1 | 2;
  /** Progression 0..1 et position du checkpoint 0..1. */
  progress: number;
  checkpoint: number;
  status: PayloadStatus;
  overtime: boolean;
  attackColor: string;
  /** « ATTAQUE · Escortez le convoi » dans la couleur de l'équipe du joueur. */
  roleText: string;
  roleColor: string;
  time: number;
}

const STATUS_KEYS: Record<PayloadStatus, TKey> = {
  pushing: 'escort.pushing',
  contested: 'escort.contested',
  stopped: 'escort.stopped',
  reversing: 'escort.reversing',
};

/**
 * En haut au centre :  [ 2:45 ]  [ rôle · statut | barre de progression avec checkpoint ]
 */
export function drawEscortBar(ctx: CanvasRenderingContext2D, width: number, f: EscortBarFrame): void {
  const top = 12;
  const h = 64;
  const timerW = 116;
  const panelW = 380;
  const gap = 10;
  const left = width / 2 - (timerW + gap + panelW) / 2;

  // --- Chrono
  const secs = Math.ceil(f.timeLeft);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const blink = Math.floor(f.time * 3) % 2 === 0;
  ctx.fillStyle = 'rgba(10,14,20,0.8)';
  ctx.fillRect(left, top, timerW, h);
  ctx.strokeStyle = f.overtime ? CONTEST : f.timeLeft <= 20 ? COLORS.enemy : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(left + 1, top + 1, timerW - 2, h - 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = f.overtime && blink ? CONTEST : COLORS.hud;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(clock, left + timerW / 2, top + 36);
  ctx.font = `800 11px ${FONT}`;
  ctx.fillStyle = f.overtime ? CONTEST : COLORS.hudDim;
  ctx.fillText(f.overtime ? t('escort.overtime') : t('escort.phase', { n: f.phase }), left + timerW / 2, top + 54);

  // --- Panneau de progression
  const px = left + timerW + gap;
  ctx.fillStyle = 'rgba(10,14,20,0.8)';
  ctx.fillRect(px, top, panelW, h);

  ctx.textAlign = 'left';
  ctx.font = `800 12px ${FONT}`;
  ctx.fillStyle = f.roleColor;
  ctx.fillText(f.roleText, px + 12, top + 20);

  let statusColor: string = COLORS.hudDim;
  if (f.status === 'pushing') statusColor = f.attackColor;
  else if (f.status === 'contested') statusColor = blink ? CONTEST : COLORS.hud;
  else if (f.status === 'reversing') statusColor = '#ff8a8a';
  ctx.textAlign = 'right';
  ctx.font = `900 13px ${FONT}`;
  ctx.fillStyle = statusColor;
  ctx.fillText(t(STATUS_KEYS[f.status]), px + panelW - 12, top + 20);

  // Barre : départ → checkpoint → arrivée
  const bx = px + 14;
  const bw = panelW - 40;
  const by = top + 38;
  const bh = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = f.attackColor;
  ctx.fillRect(bx, by, bw * Math.min(1, f.progress), bh);

  // Checkpoint (losange) et arrivée (drapeau)
  const cx = bx + bw * f.checkpoint;
  const passed = f.progress >= f.checkpoint;
  ctx.fillStyle = passed ? f.attackColor : 'rgba(10,14,20,1)';
  ctx.strokeStyle = passed ? '#ffffff' : COLORS.hud;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, by - 4);
  ctx.lineTo(cx + 9, by + bh / 2);
  ctx.lineTo(cx, by + bh + 4);
  ctx.lineTo(cx - 9, by + bh / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const ex = bx + bw + 12;
  ctx.strokeStyle = COLORS.hud;
  ctx.beginPath();
  ctx.moveTo(ex - 6, by + bh + 4);
  ctx.lineTo(ex - 6, by - 8);
  ctx.stroke();
  ctx.fillStyle = f.attackColor;
  ctx.fillRect(ex - 5, by - 8, 10, 7);

  // Le convoi sur la barre
  const mx = bx + bw * Math.min(1, f.progress);
  ctx.fillStyle = '#c9d2dc';
  ctx.strokeStyle = '#10141a';
  ctx.lineWidth = 2;
  ctx.fillRect(mx - 7, by - 3, 14, 16);
  ctx.strokeRect(mx - 7, by - 3, 14, 16);
  ctx.fillStyle = f.attackColor;
  ctx.fillRect(mx - 7, by + 3, 14, 4);
}

/** Bandeau central qui s'efface (rôle en début de partie, checkpoint atteint). */
export function drawEscortBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  sub: string,
  color: string,
  age: number,
  duration: number,
): void {
  const a = age < duration - 0.5 ? 1 : Math.max(0, (duration - age) / 0.5);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  const y = height * 0.3;
  ctx.fillStyle = 'rgba(10,14,20,0.62)';
  ctx.fillRect(width / 2 - 230, y - 42, 460, sub ? 84 : 62);
  ctx.fillStyle = color;
  ctx.font = `900 32px ${FONT}`;
  ctx.fillText(title, width / 2, y);
  if (sub) {
    ctx.fillStyle = COLORS.hud;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(sub, width / 2, y + 28);
  }
  ctx.restore();
}

/** Fin de partie : VICTOIRE / DÉFAITE et la raison, avant le tableau des scores. */
export function drawEscortEnd(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  won: boolean,
  reason: string,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(5,7,10,0.62)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = won ? '#ffd84d' : COLORS.enemy;
  ctx.font = `900 64px ${FONT}`;
  ctx.fillText(t(won ? 'control.victory' : 'control.defeat'), width / 2, height / 2 - 20);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(reason, width / 2, height / 2 + 24);
  ctx.restore();
}
