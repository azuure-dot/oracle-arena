import { COLORS } from '../config';
import { ordinal, t } from '../i18n';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

export interface FeedName {
  name: string;
  hero: string;
  isPlayer: boolean;
}

export interface DeathmatchHudFrame {
  remaining: number; // s
  kills: number;
  rank: number;
  total: number;
  feed: { killer: FeedName | null; victim: FeedName; age: number }[];
  lastKill: { name: string; age: number } | null;
}

/** Bandeau du Deathmatch : chrono, éliminations, position, fil des éliminations. */
export class DeathmatchHud {
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, f: DeathmatchHudFrame): void {
    this.drawTopBar(ctx, width, f);
    this.drawFeed(ctx, width, f);
    this.drawKillBanner(ctx, width, height, f);
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, width: number, f: DeathmatchHudFrame): void {
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

  /** Fil des éliminations, en haut à droite : « Vex (Flux) ✕ Toi (Tempo) ». */
  private drawFeed(ctx: CanvasRenderingContext2D, width: number, f: DeathmatchHudFrame): void {
    const right = width - 20;
    let y = 30;
    ctx.font = `700 13px ${FONT}`;
    for (const e of f.feed) {
      const alpha = e.age < 5 ? 1 : Math.max(0, 1 - (e.age - 5));
      if (alpha <= 0) continue;
      const parts: { text: string; color: string }[] = [];
      const nameColor = (n: FeedName) => (n.isPlayer ? COLORS.ally : COLORS.hud);
      if (e.killer) parts.push({ text: `${e.killer.name} (${e.killer.hero})`, color: nameColor(e.killer) });
      parts.push({ text: '  ✕  ', color: COLORS.enemy });
      parts.push({ text: `${e.victim.name} (${e.victim.hero})`, color: nameColor(e.victim) });

      const widths = parts.map((p) => ctx.measureText(p.text).width);
      const total = widths.reduce((a, b) => a + b, 0);
      ctx.globalAlpha = alpha;
      const involvesPlayer = e.killer?.isPlayer || e.victim.isPlayer;
      ctx.fillStyle = involvesPlayer ? 'rgba(77,163,255,0.22)' : 'rgba(10,14,20,0.6)';
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

  /** « ÉLIMINATION · Vex » au centre quand le joueur marque un point. */
  private drawKillBanner(ctx: CanvasRenderingContext2D, width: number, height: number, f: DeathmatchHudFrame): void {
    const k = f.lastKill;
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
}
