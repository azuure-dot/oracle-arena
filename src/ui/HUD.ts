import { COLORS } from '../config';
import { degToRad } from '../core/math';
import { INPUT_LABEL_KEYS, type AbilityIcon, type AbilitySlot, type Hero } from '../heroes/Hero';
import { t } from '../i18n';
import type { TouchControls } from '../core/Touch';
import type { Stats } from './Stats';
import { drawTouchControls } from './touchHud';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

export interface HudFrame {
  width: number;
  height: number;
  mouseX: number;
  mouseY: number;
  aimDistance: number;
  hero: Hero;
  time: number;
  fps: number;
  /** Champ de tir uniquement : panneau DPS / dégâts / tourelles. */
  stats?: Stats;
  turretsEnabled?: boolean;
  /** Aide (touche H) : titre et lignes propres au mode. */
  helpTitle: string;
  helpFooter: string[];
  /** Hauteur du haut de l'aide (sous le bandeau des modes en ligne). */
  helpTop?: number;
  /** Sous le compte à rebours de réapparition (ex. « Éliminé par Vex »). */
  deathMessage?: string;
  /** Transformation monde → écran (aperçus de visée tactile). */
  view?: { scale: number; tx: number; ty: number };
  /** Commandes tactiles actives : sticks et boutons à l'écran, à la place de la barre et du viseur. */
  touch?: TouchControls;
}

/** Interface en espace écran, générique : elle lit abilitySlots()/weaponHud() du héros. */
export class HUD {
  private hitmarker = 0;
  private hitmarkerKill = false;
  showHelp = true;

  onHit(killed: boolean): void {
    this.hitmarker = killed ? 0.25 : 0.12;
    this.hitmarkerKill = killed;
  }

  update(dt: number): void {
    this.hitmarker = Math.max(0, this.hitmarker - dt);
  }

  draw(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const touch = f.touch?.active ? f.touch : null;
    this.drawDamageVignette(ctx, f);
    if (touch) {
      // Téléphone : PV en haut à gauche (sous les boutons Quitter / Héros), compétences et
      // munitions sur les boutons tactiles, pas de viseur ni d'aide clavier.
      this.drawHealth(ctx, f, 16, touch.unit * 0.04 + touch.unit * 0.11 + 58, 180);
    } else {
      this.drawHealth(ctx, f);
      this.drawAbilities(ctx, f);
      this.drawWeapon(ctx, f);
    }
    this.drawStats(ctx, f);
    if (this.showHelp && !touch) this.drawHelp(ctx, f);
    if (f.hero.dead) this.drawRespawn(ctx, f);
    else if (f.hero.stunTimer > 0) this.drawStunned(ctx, f);
    if (touch) {
      drawTouchControls(ctx, f.width, f.height, f.hero, touch, f.view ?? { scale: 1, tx: 0, ty: 0 }, (c, icon, x, y, color) => this.drawIcon(c, icon, x, y, color));
      this.drawHitmarkerAt(ctx, f, touch);
    } else this.drawCrosshair(ctx, f);
  }

  /** Tactile : marqueur de touche au point visé. */
  private drawHitmarkerAt(ctx: CanvasRenderingContext2D, f: HudFrame, touch: TouchControls): void {
    if (this.hitmarker <= 0 || !f.view) return;
    const p = touch.aimPoint(f.hero);
    this.drawCrosshair(ctx, { ...f, mouseX: p.x * f.view.scale + f.view.tx, mouseY: p.y * f.view.scale + f.view.ty }, true);
  }

  /** Étourdi : rappel au-dessus de la barre de compétences. */
  private drawStunned(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    ctx.textAlign = 'center';
    ctx.font = `900 22px ${FONT}`;
    ctx.fillStyle = '#ffe066';
    ctx.fillText(`${t('hud.stunned')} ${f.hero.stunTimer.toFixed(1)}`, f.width / 2, f.height * 0.62);
  }

  /** Mort : compte à rebours de réapparition au centre de l'écran. */
  private drawRespawn(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const cy = f.height * 0.38;
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.fillRect(f.width / 2 - 190, cy - 44, 380, f.deathMessage ? 96 : 70);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.hud;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(t('hud.respawn', { s: Math.max(0, f.hero.respawnTimer).toFixed(1) }), f.width / 2, cy);
    if (f.deathMessage) {
      ctx.fillStyle = COLORS.enemy;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(f.deathMessage, f.width / 2, cy + 32);
    }
  }

  // ---------------------------------------------------------------- PV

  private drawDamageVignette(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const t = f.hero.hurtTimer / 0.3;
    if (t <= 0) return;
    const g = ctx.createRadialGradient(
      f.width / 2,
      f.height / 2,
      Math.min(f.width, f.height) * 0.35,
      f.width / 2,
      f.height / 2,
      Math.max(f.width, f.height) * 0.7,
    );
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,40,60,${0.35 * t})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.width, f.height);
  }

  private drawHealth(ctx: CanvasRenderingContext2D, f: HudFrame, x = 28, y = f.height - 34, w = 280): void {
    const h = f.hero;
    const barH = 18;

    ctx.textAlign = 'left';
    ctx.fillStyle = h.stats.color;
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(h.name.toUpperCase(), x, y - 34);

    const hpTxt = `${Math.ceil(h.hp)}`;
    ctx.fillStyle = COLORS.hud;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(hpTxt, x, y - 8);
    const hpW = ctx.measureText(hpTxt).width;
    ctx.fillStyle = COLORS.hudDim;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(` / ${h.maxHp}`, x + hpW, y - 8);

    const segHp = h.maxHp > 300 ? 50 : 25;
    const segs = Math.floor(h.maxHp / segHp);
    const gap = 3;
    const segW = (w - gap * (segs - 1)) / segs;
    for (let i = 0; i < segs; i++) {
      const sx = x + i * (segW + gap);
      const fill = Math.max(0, Math.min(1, (h.hp - i * segHp) / segHp));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      this.skewRect(ctx, sx, y, segW, barH);
      if (fill > 0) {
        ctx.fillStyle = h.hp / h.maxHp < 0.35 ? COLORS.hpLow : COLORS.hpPlayer;
        this.skewRect(ctx, sx, y, segW * fill, barH);
      }
    }
  }

  // ---------------------------------------------------------- compétences

  private drawAbilities(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const slots = f.hero.abilitySlots();
    const size = 70;
    const gap = 26;
    const total = slots.length * size + (slots.length - 1) * gap;
    const y = f.height - size - 62;
    slots.forEach((slot, i) => this.drawSlot(ctx, slot, f.width / 2 - total / 2 + i * (size + gap), y, size));
  }

  private drawSlot(ctx: CanvasRenderingContext2D, s: AbilitySlot, x: number, y: number, size: number): void {
    const color = s.color ?? COLORS.accent;
    const onCooldown = (s.cooldown ?? 0) > 0;
    const noCharges = s.maxCharges !== undefined && (s.charges ?? 0) <= 0;
    const ready = !onCooldown && !noCharges;

    // Cadre
    ctx.fillStyle = s.active ? 'rgba(255,255,255,0.10)' : 'rgba(10,14,20,0.72)';
    ctx.fillRect(x, y, size, size);
    if (s.active) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x, y, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = ready ? color : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = s.active ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

    this.drawIcon(ctx, s.icon, x + size / 2, y + size / 2, ready ? color : COLORS.hudDim);

    // Balayage radial du cooldown
    if (onCooldown && s.cooldownMax) {
      const ratio = s.cooldown! / s.cooldownMax;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, size - 4, size - 4);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.moveTo(x + size / 2, y + size / 2);
      ctx.arc(x + size / 2, y + size / 2, size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = COLORS.hud;
      ctx.font = `800 24px ${FONT}`;
      ctx.textAlign = 'center';
      const cd = s.cooldown!;
      ctx.fillText(cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1), x + size / 2, y + size / 2 + 9);
    }

    // Charges (chiffre + pastilles)
    if (s.maxCharges !== undefined) {
      ctx.fillStyle = COLORS.hud;
      ctx.font = `800 18px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(s.charges ?? 0), x + size - 6, y + size - 7);
      const pipW = 18;
      const pipGap = 5;
      const totalW = s.maxCharges * pipW + (s.maxCharges - 1) * pipGap;
      for (let i = 0; i < s.maxCharges; i++) {
        const px = x + size / 2 - totalW / 2 + i * (pipW + pipGap);
        const py = y + size + 24;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(px, py, pipW, 5);
        if (i < (s.charges ?? 0)) {
          ctx.fillStyle = color;
          ctx.fillRect(px, py, pipW, 5);
        } else if (i === s.charges) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(px, py, pipW * (s.chargeProgress ?? 0), 5);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Jauge (PV du bouclier, durée du Surrégime...)
    if (s.bar !== undefined) {
      const by = y + size + 24;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, by, size, 5);
      ctx.fillStyle = color;
      ctx.fillRect(x, by, size * Math.max(0, Math.min(1, s.bar)), 5);
    }

    this.keyLabel(ctx, x + size / 2, y - 8, t(INPUT_LABEL_KEYS[s.input]).toUpperCase());
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.hudDim;
    ctx.fillText(s.name.toUpperCase(), x + size / 2, y + size + 16);
    if (s.label) {
      ctx.fillStyle = color;
      ctx.font = `800 11px ${FONT}`;
      ctx.fillText(s.label, x + size / 2, y + size + (s.bar !== undefined || s.maxCharges !== undefined ? 42 : 30));
    }
  }

  private keyLabel(ctx: CanvasRenderingContext2D, cx: number, y: number, txt: string): void {
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    const w = ctx.measureText(txt).width + 10;
    ctx.fillStyle = 'rgba(233,238,245,0.9)';
    ctx.fillRect(cx - w / 2, y - 12, w, 16);
    ctx.fillStyle = '#10141a';
    ctx.fillText(txt, cx, y);
  }

  private drawIcon(ctx: CanvasRenderingContext2D, icon: AbilityIcon, cx: number, cy: number, color: string): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    switch (icon) {
      case 'blink':
        for (let i = 0; i < 2; i++) {
          const ox = cx - 10 + i * 14;
          ctx.beginPath();
          ctx.moveTo(ox - 6, cy - 12);
          ctx.lineTo(ox + 6, cy);
          ctx.lineTo(ox - 6, cy + 12);
          ctx.stroke();
        }
        break;
      case 'recall': {
        ctx.beginPath();
        ctx.arc(cx, cy, 15, -Math.PI * 0.2, Math.PI * 1.45);
        ctx.stroke();
        const a = -Math.PI * 0.2;
        const ax = cx + Math.cos(a) * 15;
        const ay = cy + Math.sin(a) * 15;
        ctx.beginPath();
        ctx.moveTo(ax - 7, ay - 3);
        ctx.lineTo(ax + 7, ay - 3);
        ctx.lineTo(ax, ay + 7);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + 6, cy + 4);
        ctx.stroke();
        break;
      }
      case 'shield':
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy - 14);
        ctx.quadraticCurveTo(cx, cy - 20, cx + 14, cy - 14);
        ctx.lineTo(cx + 14, cy + 2);
        ctx.quadraticCurveTo(cx + 12, cy + 14, cx, cy + 18);
        ctx.quadraticCurveTo(cx - 12, cy + 14, cx - 14, cy + 2);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'fire':
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.quadraticCurveTo(cx + 16, cy - 2, cx + 10, cy + 12);
        ctx.quadraticCurveTo(cx, cy + 20, cx - 10, cy + 12);
        ctx.quadraticCurveTo(cx - 16, cy - 2, cx, cy - 18);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(cx, cy + 7, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'charge':
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 14);
        ctx.lineTo(cx + 12, cy);
        ctx.lineTo(cx - 6, cy + 14);
        ctx.stroke();
        ctx.lineWidth = 3;
        for (const oy of [-8, 0, 8]) {
          ctx.beginPath();
          ctx.moveTo(cx - 18, cy + oy);
          ctx.lineTo(cx - 10, cy + oy);
          ctx.stroke();
        }
        break;
      case 'boop':
        for (let i = 0; i < 3; i++) {
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx - 12, cy, 8 + i * 8, -0.7, 0.7);
          ctx.stroke();
        }
        break;
      case 'swap':
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = `900 16px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('⇄', cx, cy + 6);
        break;
      case 'gear':
        // Casque de skate
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 15, Math.PI, 0);
        ctx.lineTo(cx + 15, cy + 8);
        ctx.lineTo(cx - 15, cy + 8);
        ctx.closePath();
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 10);
        ctx.lineTo(cx - 4, cy - 3);
        ctx.moveTo(cx + 4, cy - 10);
        ctx.lineTo(cx + 4, cy - 3);
        ctx.stroke();
        break;
      case 'trick': {
        // Planche en l'air qui tourne
        ctx.save();
        ctx.translate(cx, cy - 2);
        ctx.rotate(-0.35);
        ctx.beginPath();
        ctx.roundRect(-17, -5, 34, 10, 5);
        ctx.stroke();
        ctx.restore();
        for (const ox of [-9, 9]) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy + 11 - ox * 0.35, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 21, -2.6, -1.2);
        ctx.stroke();
        break;
      }
      case 'turtle': {
        // Tortue vue de dessus : carapace, tête et pattes
        ctx.beginPath();
        ctx.ellipse(cx, cy + 2, 13, 11, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy - 13, 4.5, 0, Math.PI * 2);
        ctx.fill();
        for (const [ox, oy] of [[-13, -6], [13, -6], [-12, 11], [12, 11]]) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy + 2);
        ctx.lineTo(cx + 7, cy + 2);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 10);
        ctx.stroke();
        break;
      }
      case 'shell': {
        // Carapace qui ricoche sur un mur
        ctx.beginPath();
        ctx.arc(cx - 4, cy + 4, 10, Math.PI, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + 16, cy - 16);
        ctx.lineTo(cx + 16, cy + 14);
        ctx.stroke();
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx + 6, cy);
        ctx.lineTo(cx + 14, cy - 8);
        ctx.lineTo(cx + 2, cy - 16);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'bomb': {
        // Bombe à eau ronde avec sa mèche
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillRect(cx - 3, cy - 10, 6, 5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 10);
        ctx.quadraticCurveTo(cx + 4, cy - 18, cx + 10, cy - 15);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - 4, cy + 1, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hammer': {
        // Marteau penché + éclair
        ctx.save();
        ctx.translate(cx - 2, cy + 2);
        ctx.rotate(-0.6);
        ctx.fillRect(-2, -4, 4, 20);
        ctx.fillRect(-11, -14, 22, 11);
        ctx.restore();
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + 15, cy - 18);
        ctx.lineTo(cx + 9, cy - 6);
        ctx.lineTo(cx + 15, cy - 6);
        ctx.lineTo(cx + 8, cy + 6);
        ctx.stroke();
        break;
      }
      case 'feather': {
        // Plume penchée au-dessus d'un cercle de soin
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 12, 16, 5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.translate(cx + 1, cy - 3);
        ctx.rotate(-0.8);
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.quadraticCurveTo(3, -8, -13, -3);
        ctx.lineTo(-11, 0);
        ctx.lineTo(-13, 3);
        ctx.quadraticCurveTo(3, 8, 15, 0);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'wing': {
        // Aile déployée + flèche d'élan
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy + 8);
        ctx.quadraticCurveTo(cx - 12, cy - 14, cx + 14, cy - 16);
        ctx.quadraticCurveTo(cx + 6, cy - 8, cx + 10, cy - 4);
        ctx.quadraticCurveTo(cx + 2, cy - 2, cx + 6, cy + 3);
        ctx.quadraticCurveTo(cx - 2, cy + 3, cx, cy + 9);
        ctx.quadraticCurveTo(cx - 8, cy + 6, cx - 14, cy + 8);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + 4, cy + 15);
        ctx.lineTo(cx + 16, cy + 15);
        ctx.moveTo(cx + 11, cy + 10);
        ctx.lineTo(cx + 16, cy + 15);
        ctx.lineTo(cx + 11, cy + 20);
        ctx.stroke();
        break;
      }
      case 'angel': {
        // Petit ange : boule, auréole, deux petites ailes
        ctx.beginPath();
        ctx.arc(cx, cy + 3, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 11, 8, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * 7, cy + 1);
          ctx.quadraticCurveTo(cx + s * 20, cy - 8, cx + s * 18, cy + 6);
          ctx.quadraticCurveTo(cx + s * 13, cy + 4, cx + s * 7, cy + 6);
          ctx.fill();
        }
        break;
      }
      case 'amp':
        ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
          const h = [8, 16, 24, 14][i];
          ctx.beginPath();
          ctx.moveTo(cx - 12 + i * 8, cy + 12);
          ctx.lineTo(cx - 12 + i * 8, cy + 12 - h);
          ctx.stroke();
        }
        break;
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ arme

  private drawWeapon(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const w = f.hero.weaponHud();
    const right = f.width - 28;
    const base = f.height - 34;

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.hudDim;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(w.name.toUpperCase(), right, base - 64);

    if (w.magSize !== undefined && w.ammo !== undefined) {
      ctx.font = `600 18px ${FONT}`;
      const maxTxt = ` / ${w.magSize}`;
      ctx.fillText(maxTxt, right, base - 14);
      const maxW = ctx.measureText(maxTxt).width;
      ctx.fillStyle = w.ammo <= w.magSize * 0.25 ? COLORS.hpLow : COLORS.hud;
      ctx.font = `800 42px ${FONT}`;
      ctx.fillText(String(w.ammo), right - maxW, base - 12);

      const tickW = w.magSize > 30 ? 3 : 6;
      const tickGap = 2;
      const totalW = w.magSize * (tickW + tickGap) - tickGap;
      for (let i = 0; i < w.magSize; i++) {
        ctx.fillStyle = i < w.ammo ? COLORS.bullet : 'rgba(255,255,255,0.12)';
        ctx.fillRect(right - totalW + i * (tickW + tickGap), base, tickW, 10);
      }
    } else {
      // Arme de mêlée : pas de munitions, une jauge "prêt"
      ctx.fillStyle = COLORS.hud;
      ctx.font = `800 34px ${FONT}`;
      ctx.fillText(t('hud.melee'), right, base - 14);
      const ratio = Math.max(0, Math.min(1, w.readyRatio ?? 1));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(right - 160, base, 160, 8);
      ctx.fillStyle = ratio >= 1 ? COLORS.hud : COLORS.hudDim;
      ctx.fillRect(right - 160, base, 160 * ratio, 8);
    }

    if (w.reloadProgress !== undefined) {
      const bw = 200;
      const bx = f.width / 2 - bw / 2;
      const by = f.height / 2 + 60;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 2, by - 2, bw + 4, 10);
      ctx.fillStyle = COLORS.accent;
      ctx.fillRect(bx, by, bw * w.reloadProgress, 6);
      ctx.fillStyle = COLORS.hud;
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(t('hud.reloading'), f.width / 2, by - 8);
    }
  }

  // ---------------------------------------------------------- stats / aide

  private drawStats(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    if (!f.stats) return;
    const x = f.width - 24;
    let y = 30;
    ctx.textAlign = 'right';
    ctx.font = `700 13px ${FONT}`;
    const lines: [string, string][] = [
      [t('hud.dps'), f.stats.dps(f.time).toFixed(0)],
      [t('hud.damage'), Math.round(f.stats.totalDamage).toString()],
      [t('hud.kills'), f.stats.kills.toString()],
      [t('hud.turrets'), t(f.turretsEnabled ? 'hud.on' : 'hud.off')],
      [t('hud.fps'), f.fps.toFixed(0)],
    ];
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    ctx.fillRect(x - 190, y - 18, 198, lines.length * 20 + 12);
    for (const [label, value] of lines) {
      ctx.fillStyle = COLORS.hudDim;
      ctx.fillText(label, x - 60, y);
      ctx.fillStyle = COLORS.hud;
      ctx.fillText(value, x, y);
      y += 20;
    }
  }

  private drawHelp(ctx: CanvasRenderingContext2D, f: HudFrame): void {
    const lines = [
      f.helpTitle,
      t('help.move'),
      t('help.line', { key: t('key.primary'), name: f.hero.weaponHud().name }),
      ...f.hero.abilitySlots().map((s) => t('help.line', { key: t(INPUT_LABEL_KEYS[s.input]), name: s.name })),
      ...(f.hero.hasQuickMelee() ? [t('help.line', { key: t('key.melee'), name: t('melee.name') })] : []),
      ...f.helpFooter,
    ];
    const x = 24;
    let y = f.helpTop ?? 30;
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    ctx.fillRect(x - 10, y - 20, 320, lines.length * 19 + 14);
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? f.hero.stats.color : COLORS.hud;
      ctx.font = i === 0 ? `800 14px ${FONT}` : `500 13px ${FONT}`;
      ctx.fillText(l, x, y);
      y += 19;
    });
  }

  // ---------------------------------------------------------------- viseur

  private drawCrosshair(ctx: CanvasRenderingContext2D, f: HudFrame, hitmarkerOnly = false): void {
    const { mouseX: mx, mouseY: my } = f;
    if (hitmarkerOnly) {
      this.drawHitmarker(ctx, mx, my);
      return;
    }
    // Le cercle montre la vraie dispersion à la distance du curseur.
    const half = degToRad(f.hero.spreadDeg) / 2;
    const spreadR = Math.max(6, Math.tan(half) * f.aimDistance);

    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mx, my, spreadR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);

    this.drawHitmarker(ctx, mx, my);
  }

  private drawHitmarker(ctx: CanvasRenderingContext2D, mx: number, my: number): void {
    if (this.hitmarker > 0) {
      const s = this.hitmarkerKill ? 12 : 9;
      const inner = 4;
      ctx.strokeStyle = this.hitmarkerKill ? '#ff4d5e' : '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.moveTo(mx + dx * inner, my + dy * inner);
        ctx.lineTo(mx + dx * s, my + dy * s);
      }
      ctx.stroke();
    }
  }

  private skewRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const k = 5;
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w + k, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  }
}
