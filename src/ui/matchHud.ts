import { COLORS } from '../config';
import { t } from '../i18n';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

export interface FeedName {
  name: string;
  hero: string;
  color: string;
}

export interface FeedLine {
  killer: FeedName | null; // null : mort sans tueur (zone de dégâts)
  victim: FeedName;
  /** La ligne concerne le joueur : fond surligné. */
  highlight: boolean;
  age: number;
}

/** Fil des éliminations, en haut à droite : « Vex (Flux) ✕ Toi (Tempo) ». */
export function drawKillFeed(ctx: CanvasRenderingContext2D, width: number, feed: FeedLine[], top = 30): void {
  const right = width - 20;
  let y = top;
  ctx.font = `700 13px ${FONT}`;
  for (const e of feed) {
    const alpha = e.age < 5 ? 1 : Math.max(0, 1 - (e.age - 5));
    if (alpha <= 0) continue;
    const parts: { text: string; color: string }[] = [];
    if (e.killer) parts.push({ text: `${e.killer.name} (${e.killer.hero})`, color: e.killer.color });
    parts.push({ text: '  ✕  ', color: COLORS.hudDim });
    parts.push({ text: `${e.victim.name} (${e.victim.hero})`, color: e.victim.color });

    const widths = parts.map((p) => ctx.measureText(p.text).width);
    const total = widths.reduce((a, b) => a + b, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = e.highlight ? 'rgba(255,255,255,0.14)' : 'rgba(10,14,20,0.6)';
    ctx.fillRect(right - total - 12, y - 16, total + 18, 23);
    let x = right - total;
    ctx.textAlign = 'left';
    parts.forEach((p, i) => {
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
      x += widths[i];
    });
    ctx.globalAlpha = 1;
    y += 28;
  }
}

/** « +1 ÉLIMINATION · Vex » au centre quand le joueur élimine quelqu'un. */
export function drawKillBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  k: { name: string; age: number } | null,
): void {
  if (!k) return;
  const alpha = k.age < 1.1 ? 1 : Math.max(0, 1 - (k.age - 1.1) / 0.5);
  const pop = 1 + Math.max(0, 0.25 - k.age) * 1.2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2, height * 0.27);
  ctx.scale(pop, pop);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.enemy;
  ctx.font = `900 22px ${FONT}`;
  ctx.fillText(`+1  ${t('hud.dm.elimination')}`, 0, 0);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(k.name, 0, 22);
  ctx.restore();
}

/** Compte à rebours de départ : libellé + grand chiffre, sous le bandeau du mode. */
export function drawCountdown(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  seconds: number,
): void {
  const n = Math.ceil(seconds);
  const frac = seconds - Math.floor(seconds); // 1 → 0 sur chaque seconde : petit « pop »
  const cx = width / 2;
  const y = Math.max(185, height * 0.22); // sous les bandeaux des modes
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,14,20,0.7)';
  ctx.fillRect(cx - 200, y - 30, 400, 104);
  ctx.fillStyle = COLORS.hud;
  ctx.font = `800 15px ${FONT}`;
  ctx.fillText(label.toUpperCase(), cx, y - 6);
  ctx.translate(cx, y + 50);
  const scale = 1 + Math.max(0, frac - 0.75) * 1.2;
  ctx.scale(scale, scale);
  ctx.fillStyle = n <= 3 ? COLORS.accent : COLORS.hud;
  ctx.font = `900 50px ${FONT}`;
  ctx.fillText(String(n), 0, 0);
  ctx.restore();
}
