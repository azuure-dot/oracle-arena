import { COLORS } from '../config';
import type { TouchControls, TouchSlot } from '../core/Touch';
import type { AbilityIcon, AbilitySlot, Hero } from '../heroes/Hero';
import { t } from '../i18n';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
const TAU = Math.PI * 2;

type IconFn = (ctx: CanvasRenderingContext2D, icon: AbilityIcon, cx: number, cy: number, color: string) => void;

/**
 * Commandes tactiles à l'écran : sticks, boutons de compétences (icône, recharge, charges),
 * munitions dans le stick de tir, aperçu de la visée d'une compétence. Les icônes sont celles
 * de la barre de compétences du HUD (dessinées à ~40 px, mises à l'échelle du bouton).
 */
export function drawTouchControls(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hero: Hero,
  touch: TouchControls,
  view: { scale: number; tx: number; ty: number },
  drawIcon: IconFn,
): void {
  if (h > w) {
    drawRotateHint(ctx, w, h);
    return;
  }
  const u = touch.unit;
  if (!hero.dead) drawAimGuide(ctx, hero, touch, view);

  // --- stick de déplacement (flottant)
  const L = touch.leftStick;
  const lb = L ? { x: L.ox, y: L.oy } : touch.leftBase;
  drawStick(ctx, lb.x, lb.y, u * 0.12, L ? L.x : lb.x, L ? L.y : lb.y, L !== null, null);

  // --- stick de tir (munitions au centre)
  const F = touch.fireStick;
  const fb = touch.fireBase;
  const fo = F ? { x: F.ox, y: F.oy } : fb;
  const weapon = hero.weaponHud();
  drawStick(ctx, fo.x, fo.y, fb.r, F ? F.x : fo.x, F ? F.y : fo.y, F !== null, () => {
    ctx.textAlign = 'center';
    if (weapon.ammo !== undefined) {
      ctx.fillStyle = weapon.ammo <= (weapon.magSize ?? 0) * 0.25 ? COLORS.hpLow : COLORS.hud;
      ctx.font = `800 ${Math.round(u * 0.055)}px ${FONT}`;
      ctx.fillText(String(weapon.ammo), F ? F.x : fo.x, (F ? F.y : fo.y) + u * 0.02);
    } else {
      crosshairGlyph(ctx, F ? F.x : fo.x, F ? F.y : fo.y, u * 0.035);
    }
  });
  // Rechargement / attente de l'arme : anneau autour de la base
  const progress = weapon.reloadProgress ?? (weapon.readyRatio !== undefined && weapon.readyRatio < 1 ? weapon.readyRatio : undefined);
  if (progress !== undefined) {
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fo.x, fo.y, fb.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
    ctx.stroke();
  }

  // --- boutons
  const slots = hero.abilitySlots();
  for (const b of touch.buttons) {
    const slot = slots.find((s) => s.input === b.slot);
    drawButton(ctx, b.x, b.y, b.r, b.slot, slot, touch.isDown(b.slot), drawIcon);
  }
  for (const m of touch.metaButtons) {
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.hud;
    ctx.font = `800 ${Math.round(m.r * 1.05)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(m.label, m.x, m.y + m.r * 0.36);
  }
}

function drawStick(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  r: number,
  kx: number,
  ky: number,
  active: boolean,
  inner: (() => void) | null,
): void {
  // Le bouton suit le pouce, limité au bord de la base.
  const dx = kx - ox;
  const dy = ky - oy;
  const d = Math.hypot(dx, dy);
  const k = d > r ? r / d : 1;
  const x = ox + dx * k;
  const y = oy + dy * k;
  ctx.save();
  ctx.globalAlpha = active ? 0.9 : 0.45;
  ctx.fillStyle = 'rgba(10,14,20,0.35)';
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? 'rgba(233,238,245,0.55)' : 'rgba(233,238,245,0.3)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (inner) {
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.75;
    // Le contenu suit le bouton du stick
    inner();
    ctx.restore();
  }
}

function crosshairGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = COLORS.hud;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * r * 0.5, y + dy * r * 0.5);
    ctx.lineTo(x + dx * r * 1.5, y + dy * r * 1.5);
  }
  ctx.stroke();
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  slotId: TouchSlot,
  s: AbilitySlot | undefined,
  down: boolean,
  drawIcon: IconFn,
): void {
  const color = s?.color ?? COLORS.hud;
  const onCooldown = (s?.cooldown ?? 0) > 0;
  const noCharges = s?.maxCharges !== undefined && (s.charges ?? 0) <= 0;
  const ready = !onCooldown && !noCharges;

  ctx.save();
  ctx.fillStyle = down ? 'rgba(255,255,255,0.22)' : s?.active ? 'rgba(255,255,255,0.12)' : 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (s?.active) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = ready ? color : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = s?.active || down ? 3.5 : 2.5;
  ctx.stroke();

  if (s) {
    ctx.save();
    ctx.translate(x, y);
    const k = (r * 1.25) / 40;
    ctx.scale(k, k);
    drawIcon(ctx, s.icon, 0, 0, ready ? color : COLORS.hudDim);
    ctx.restore();
  } else {
    // Mêlée (poing) ou rechargement (flèche circulaire)
    ctx.strokeStyle = COLORS.hud;
    ctx.fillStyle = COLORS.hud;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.lineCap = 'round';
    if (slotId === 'reload') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, -Math.PI * 0.2, Math.PI * 1.4);
      ctx.stroke();
      const ax = x + Math.cos(-Math.PI * 0.2) * r * 0.45;
      const ay = y + Math.sin(-Math.PI * 0.2) * r * 0.45;
      ctx.beginPath();
      ctx.moveTo(ax - r * 0.22, ay - r * 0.05);
      ctx.lineTo(ax + r * 0.2, ay - r * 0.12);
      ctx.lineTo(ax + r * 0.02, ay + r * 0.24);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.font = `${Math.round(r * 0.9)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('👊', x, y + r * 0.32);
    }
  }

  // Recharge : secteur sombre + secondes restantes
  if (s && onCooldown && s.cooldownMax) {
    const ratio = s.cooldown! / s.cooldownMax;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.hud;
    ctx.font = `800 ${Math.round(r * 0.62)}px ${FONT}`;
    ctx.textAlign = 'center';
    const cd = s.cooldown!;
    ctx.fillText(cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1), x, y + r * 0.22);
  }
  // Charges : pastilles sous le bouton
  if (s?.maxCharges !== undefined) {
    const n = s.maxCharges;
    const pr = Math.max(2.5, r * 0.11);
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * pr * 3;
      const py = y + r + pr * 2.2;
      ctx.fillStyle = i < (s.charges ?? 0) ? color : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, TAU);
      ctx.fill();
    }
  }
  if (s?.bar !== undefined) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, s.bar)));
    ctx.stroke();
  }
  ctx.restore();
}

/** Ligne de visée (stick de tir) et aperçu d'une compétence visée en glissant. */
function drawAimGuide(ctx: CanvasRenderingContext2D, hero: Hero, touch: TouchControls, v: { scale: number; tx: number; ty: number }): void {
  const sx = hero.x * v.scale + v.tx;
  const sy = hero.y * v.scale + v.ty;
  const a = touch.aimAngle;
  ctx.save();
  if (touch.preview) {
    // Portée de la compétence, trait jusqu'au point visé, cercle d'impact
    const range = touch.preview.range * v.scale;
    const dist = Math.min(touch.aimDist, touch.preview.range) * v.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(sx, sy, range, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,224,102,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a) * dist, sy + Math.sin(a) * dist);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * dist, sy + Math.sin(a) * dist, 10, 0, TAU);
    ctx.stroke();
  } else if (touch.firing) {
    const len = Math.min(touch.aimDist, 320) * v.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * hero.radius * 1.6 * v.scale, sy + Math.sin(a) * hero.radius * 1.6 * v.scale);
    ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRotateHint(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(5,7,10,0.85)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLORS.hud;
  ctx.textAlign = 'center';
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText('⟳', w / 2, h / 2 - 24);
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(t('touch.rotate'), w / 2, h / 2 + 12);
}
