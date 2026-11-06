import { COLORS } from '../config';
import { t } from '../i18n';
import type { ScreenInfo } from '../modes/GameMode';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const CONTEST = '#ffb347';

export type Side = 'blue' | 'red';
const sideColor = (s: Side | null): string => (s === 'blue' ? COLORS.ally : s === 'red' ? COLORS.enemy : '#9aa4b2');

export interface PointState {
  owner: Side | null;
  capturer: Side | null;
  progress: number; // 0..1
  contested: boolean;
}

export interface ControlBarFrame extends PointState {
  overtime: boolean;
  percent: { blue: number; red: number };
  rounds: { blue: number; red: number };
  roundsToWin: number;
  round: number;
  time: number;
  flash: { side: Side; age: number } | null;
}

// ------------------------------------------------------------------ au sol

/** Le point de contrôle peint au sol : couleur du propriétaire, capture en cours, contesté. */
export function drawControlPoint(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number; r: number },
  time: number,
  s: PointState,
): void {
  const color = sideColor(s.owner);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = s.owner ? 0.16 : 0.08;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fill();

  // Bord pointillé qui tourne lentement
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = s.contested && Math.floor(time * 4) % 2 === 0 ? CONTEST : color;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 12]);
  ctx.lineDashOffset = -time * 20;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Capture en cours : arc de progression à l'intérieur du bord
  if (s.capturer && s.progress > 0) {
    ctx.strokeStyle = sideColor(s.capturer);
    ctx.lineWidth = 10;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r - 12, -Math.PI / 2, -Math.PI / 2 + s.progress * Math.PI * 2);
    ctx.stroke();
  }

  // Emblème central
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 20);
  ctx.lineTo(p.x + 20, p.y);
  ctx.lineTo(p.x, p.y + 20);
  ctx.lineTo(p.x - 20, p.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ bandeau

/**
 * En haut au centre :  [ BLEU  45 % ]  (point)  [ 12 %  ROUGE ]
 * avec les manches gagnées (pastilles) et l'état du point dessous.
 */
export function drawControlBar(ctx: CanvasRenderingContext2D, width: number, f: ControlBarFrame): void {
  const cx = width / 2;
  const cy = 50;
  const R = 30;
  const panelW = 190;
  const panelH = 46;
  const gap = 18;

  const panel = (s: Side) => {
    const left = s === 'blue';
    const x = left ? cx - R - gap - panelW : cx + R + gap;
    const color = sideColor(s);
    const pct = Math.min(100, Math.floor(s === 'blue' ? f.percent.blue : f.percent.red));
    const owned = f.owner === s;
    ctx.fillStyle = 'rgba(10,14,20,0.78)';
    ctx.fillRect(x, cy - panelH / 2, panelW, panelH);
    // Jauge de pourcentage
    ctx.fillStyle = color;
    ctx.globalAlpha = owned ? 0.45 : 0.25;
    const fillW = (panelW * pct) / 100;
    ctx.fillRect(left ? x + panelW - fillW : x, cy - panelH / 2, fillW, panelH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = owned ? color : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, cy - panelH / 2 + 1, panelW - 2, panelH - 2);

    ctx.fillStyle = color;
    ctx.font = `800 12px ${FONT}`;
    ctx.textAlign = left ? 'left' : 'right';
    ctx.fillText(t(s === 'blue' ? 'control.blue' : 'control.red'), left ? x + 12 : x + panelW - 12, cy + 4);
    ctx.fillStyle = COLORS.hud;
    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.fillText(`${pct}%`, left ? x + panelW - 12 : x + 12, cy + 10);

    // Manches gagnées
    const won = s === 'blue' ? f.rounds.blue : f.rounds.red;
    for (let i = 0; i < f.roundsToWin; i++) {
      const px = left ? x + panelW - 10 - i * 18 : x + 10 + i * 18;
      ctx.beginPath();
      ctx.arc(px, cy + panelH / 2 + 12, 6, 0, Math.PI * 2);
      ctx.fillStyle = i < won ? color : 'rgba(255,255,255,0.12)';
      ctx.fill();
    }
  };
  panel('blue');
  panel('red');

  // Le point (cercle) : couleur du propriétaire + arc de capture
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = sideColor(f.owner);
  ctx.globalAlpha = f.owner ? 0.9 : 0.35;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (f.capturer && f.progress > 0) {
    ctx.strokeStyle = sideColor(f.capturer);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 2, -Math.PI / 2, -Math.PI / 2 + f.progress * Math.PI * 2);
    ctx.stroke();
  }
  if (f.contested) {
    ctx.strokeStyle = Math.floor(f.time * 4) % 2 === 0 ? CONTEST : 'rgba(255,179,71,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#10141a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx + 12, cy);
  ctx.lineTo(cx, cy + 12);
  ctx.lineTo(cx - 12, cy);
  ctx.closePath();
  ctx.fill();

  // État du point + manche en cours
  let state: string;
  let stateColor: string;
  if (f.contested) {
    state = t('control.contested');
    stateColor = CONTEST;
  } else if (f.capturer && f.progress > 0) {
    state = t('control.capturing', { p: Math.floor(f.progress * 100) });
    stateColor = sideColor(f.capturer);
  } else if (f.owner) {
    state = t(f.owner === 'blue' ? 'control.blue' : 'control.red');
    stateColor = sideColor(f.owner);
  } else {
    state = t('control.neutral');
    stateColor = COLORS.hudDim;
  }
  ctx.textAlign = 'center';
  ctx.font = `800 13px ${FONT}`;
  ctx.fillStyle = stateColor;
  ctx.fillText(state, cx, cy + R + 26);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = COLORS.hudDim;
  ctx.fillText(t('control.round', { n: f.round }), cx, cy + R + 42);
  if (f.overtime) {
    ctx.font = `900 15px ${FONT}`;
    ctx.fillStyle = Math.floor(f.time * 3) % 2 === 0 ? CONTEST : COLORS.hud;
    ctx.fillText(t('control.overtime'), cx, cy + R + 62);
  }

  // « Point capturé par l'équipe bleue »
  if (f.flash) {
    const a = f.flash.age < 1.6 ? 1 : Math.max(0, 1 - (f.flash.age - 1.6) / 0.6);
    ctx.globalAlpha = a;
    ctx.font = `900 18px ${FONT}`;
    ctx.fillStyle = sideColor(f.flash.side);
    ctx.fillText(t(f.flash.side === 'blue' ? 'control.capturedBlue' : 'control.capturedRed'), cx, cy + R + 88);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ objectif hors écran

/** Flèche au bord de l'écran vers le point quand il est hors champ. */
export function drawObjectiveMarker(
  ctx: CanvasRenderingContext2D,
  s: ScreenInfo,
  p: { x: number; y: number; r: number },
  owner: Side | null,
): void {
  const sx = p.x * s.view.scale + s.view.tx;
  const sy = p.y * s.view.scale + s.view.ty;
  const margin = 46;
  const onScreen =
    sx > -p.r * s.view.scale + margin &&
    sx < s.width + p.r * s.view.scale - margin &&
    sy > -p.r * s.view.scale + margin &&
    sy < s.height + p.r * s.view.scale - margin;
  if (onScreen) return;

  const cx = s.width / 2;
  const cy = s.height / 2;
  const ang = Math.atan2(sy - cy, sx - cx);
  // Intersection du rayon centre → point avec le rectangle de l'écran (marge incluse)
  const hw = cx - margin;
  const hh = cy - margin - 40;
  const k = Math.min(Math.abs(hw / Math.cos(ang)), Math.abs(hh / Math.sin(ang)));
  const x = cx + Math.cos(ang) * k;
  const y = cy + 20 + Math.sin(ang) * k;

  const color = sideColor(owner);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(10,14,20,0.75)';
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(8, 0);
  ctx.lineTo(0, 8);
  ctx.lineTo(-8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(22, -7);
  ctx.lineTo(22, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ manches

/** Bandeau « MANCHE n » au début de chaque manche (age : secondes depuis le début). */
export function drawRoundIntro(ctx: CanvasRenderingContext2D, width: number, height: number, round: number, age: number): void {
  const a = age < 1.1 ? 1 : Math.max(0, 1 - (age - 1.1) / 0.5);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.fillRect(width / 2 - 170, height * 0.3 - 40, 340, 60);
  ctx.fillStyle = COLORS.accent;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText(t('control.round', { n: round }), width / 2, height * 0.3 + 2);
  ctx.restore();
}

export interface RoundOverlayFrame {
  round: number;
  winner: Side;
  rounds: { blue: number; red: number };
  countdown: number;
  matchOver: boolean;
  playerWon: boolean;
}

/** Écran de transition entre deux manches (et annonce de victoire / défaite). */
export function drawRoundOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, f: RoundOverlayFrame): void {
  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(5,7,10,0.62)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';

  if (f.matchOver) {
    ctx.fillStyle = f.playerWon ? '#ffd84d' : COLORS.enemy;
    ctx.font = `900 64px ${FONT}`;
    ctx.fillText(t(f.playerWon ? 'control.victory' : 'control.defeat'), cx, cy - 50);
  } else {
    ctx.fillStyle = COLORS.hudDim;
    ctx.font = `800 16px ${FONT}`;
    ctx.fillText(t('control.round', { n: f.round }), cx, cy - 76);
  }
  ctx.fillStyle = sideColor(f.winner);
  ctx.font = `900 26px ${FONT}`;
  ctx.fillText(t(f.winner === 'blue' ? 'control.roundWinBlue' : 'control.roundWinRed'), cx, cy - 6);

  // Score des manches : bleu – rouge
  ctx.font = `900 54px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.ally;
  ctx.fillText(String(f.rounds.blue), cx - 26, cy + 70);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.hudDim;
  ctx.fillText('–', cx, cy + 66);
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.enemy;
  ctx.fillText(String(f.rounds.red), cx + 26, cy + 70);

  if (!f.matchOver) {
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.hud;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(t('control.nextRound', { s: Math.ceil(f.countdown) }), cx, cy + 120);
  }
  ctx.restore();
}
