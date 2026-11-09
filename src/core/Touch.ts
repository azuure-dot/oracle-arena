import { hostile, type Combatant } from '../entities/Combatant';
import type { InputSlot } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import { lineOfSight } from '../world/Visibility';
import type { Action } from './Controls';
import { angleDiff, type Vec2 } from './math';

/**
 * COMMANDES TACTILES (téléphone, tablette) : jouable à deux pouces.
 *
 * - Pouce gauche : stick de déplacement flottant (il apparaît là où le pouce se pose, moitié
 *   gauche de l'écran).
 * - Pouce droit : stick de tir en bas à droite. Poussé, le héros vise dans cette direction et
 *   tire en continu (arme principale) ; une aide à la visée se cale sur l'ennemi le plus proche
 *   de la direction poussée.
 * - Boutons de compétences en arc autour du stick de tir. Selon le héros (`TouchHint`) :
 *   - « aim » : appui = lancer sur la cible automatique (ennemi le plus proche, allié, soi-même...),
 *     glisser depuis le bouton = viser (direction et distance), relâcher = lancer ;
 *   - « hold » : maintenu tant que le pouce reste dessus (bouclier, forme tortue), glisser oriente ;
 *   - « tap » : déclenché dès l'appui (la compétence choisit seule sa cible ou sa direction).
 * - Petits boutons : mêlée, rechargement ; en haut à gauche : quitter, changer de héros.
 *
 * Le mode tactile s'active au premier toucher et se coupe dès qu'on utilise la souris ou le clavier.
 * Il ne fait que remplir les mêmes commandes que le clavier (voir PlayerControls).
 */

export type TouchMode = 'aim' | 'hold' | 'tap';
/** Cible automatique d'un appui sans glisser. `auto` : allié blessé, sinon ennemi. */
export type TouchTarget = 'enemy' | 'ally' | 'self' | 'auto';
export interface TouchHint {
  mode: TouchMode;
  /** Portée de la visée en glissant (et de la recherche de cible automatique). */
  range?: number;
  target?: TouchTarget;
}
export const DEFAULT_TOUCH_HINT: TouchHint = { mode: 'aim', range: 420, target: 'enemy' };

/** Boutons tactiles : les emplacements de compétences, plus le rechargement. */
export type TouchSlot = InputSlot | 'reload';

/** Bouton « méta » (touche simulée) : quitter (Échap), changer de héros (C). */
export interface MetaButton {
  code: string;
  label: string;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

interface ButtonTouch extends Stick {
  slot: TouchSlot;
  hint: TouchHint;
  dragged: boolean;
}

export interface ButtonLayout {
  slot: TouchSlot;
  x: number;
  y: number;
  r: number;
}

export interface MetaLayout extends MetaButton {
  x: number;
  y: number;
  r: number;
}

/** Ce que le mode de jeu donne aux commandes tactiles à chaque image. */
export interface TouchFrame {
  width: number;
  height: number;
  player: Combatant & { aim: number; dead: boolean };
  targets: readonly Combatant[];
  arena: Arena;
  /** Boutons de compétences du héros (dans l'ordre d'affichage). */
  slots: TouchSlot[];
  hints: Partial<Record<InputSlot, TouchHint>>;
  meta: MetaButton[];
  dt: number;
}

const SLOT_ACTION: Record<TouchSlot, Action> = {
  primary: 'primary',
  secondary: 'secondary',
  ability1: 'ability1',
  ability2: 'ability2',
  melee: 'melee',
  reload: 'reload',
};

/** Fraction du rayon du stick à partir de laquelle il compte (zone morte). */
const DEAD = 0.22;
/** Glissé (px) à partir duquel un bouton « aim » est visé à la main. */
const DRAG_START = 14;
/** Aide à la visée du stick de tir : cône (rad) et portée. */
const ASSIST_CONE = 0.24;
const ASSIST_RANGE = 820;
/** Après une visée à la main, le héros garde cette direction ce temps avant de regarder où il va. */
const KEEP_AIM = 1.1;

export class TouchControls {
  /** Mode tactile en cours (affichage des sticks, visée au doigt). */
  active = false;
  move: Vec2 = { x: 0, y: 0 };
  /** Visée : direction et distance depuis le héros. */
  aimAngle = 0;
  aimDist = 260;
  /** Aperçu à dessiner (visée d'une compétence en cours). */
  preview: { slot: TouchSlot; range: number } | null = null;
  firing = false;

  private left: Stick | null = null;
  private fire: Stick | null = null;
  private button: ButtonTouch | null = null;
  private readonly heldSet = new Set<Action>();
  private readonly pressedSet = new Set<Action>();
  /** Appuis à résoudre à la prochaine mise à jour (il faut le monde pour la cible automatique). */
  private pending: { slot: TouchSlot; hint: TouchHint; manual: boolean }[] = [];
  private sinceManualAim = 99;

  // Disposition (px écran), recalculée à chaque image
  unit = 300;
  leftBase = { x: 0, y: 0 };
  fireBase = { x: 0, y: 0, r: 40 };
  buttons: ButtonLayout[] = [];
  metaButtons: MetaLayout[] = [];
  private width = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onMetaPress: (code: string) => void,
  ) {
    const opts = { passive: false } as const;
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts);
    canvas.addEventListener('pointermove', (e) => this.moveEvt(e), opts);
    canvas.addEventListener('pointerup', (e) => this.up(e), opts);
    canvas.addEventListener('pointercancel', (e) => this.up(e), opts);
    // Souris ou clavier : retour aux commandes classiques.
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) this.deactivate();
    });
    window.addEventListener('keydown', () => this.deactivate());
    if (window.matchMedia?.('(pointer: coarse)').matches) this.active = true;
  }

  // ------------------------------------------------------------ lecture (PlayerControls)

  held(action: Action): boolean {
    return this.active && (this.heldSet.has(action) || this.pressedSet.has(action));
  }
  pressed(action: Action): boolean {
    return this.active && this.pressedSet.has(action);
  }
  /** Point visé (monde), depuis la position du héros. */
  aimPoint(p: Vec2): Vec2 {
    return { x: p.x + Math.cos(this.aimAngle) * this.aimDist, y: p.y + Math.sin(this.aimAngle) * this.aimDist };
  }
  /** Bouton en cours d'appui (surbrillance). */
  isDown(slot: TouchSlot): boolean {
    return this.button?.slot === slot || (slot === 'primary' && this.fire !== null);
  }
  /** Sticks en cours (dessin). */
  get leftStick(): Stick | null {
    return this.left;
  }
  get fireStick(): Stick | null {
    return this.fire;
  }
  get aimingButton(): ButtonTouch | null {
    return this.button;
  }

  endFrame(): void {
    this.pressedSet.clear();
  }

  /** Oublie les doigts posés (nouvelle partie, changement de héros). */
  resetTouches(): void {
    this.left = this.fire = this.button = null;
    this.heldSet.clear();
    this.pressedSet.clear();
    this.pending = [];
    this.move = { x: 0, y: 0 };
  }

  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.left = this.fire = this.button = null;
    this.heldSet.clear();
    this.pressedSet.clear();
    this.pending = [];
    this.move = { x: 0, y: 0 };
  }

  // ------------------------------------------------------------ disposition

  private layout(f: TouchFrame): void {
    const w = f.width;
    const h = f.height;
    this.width = w;
    const u = Math.min(h, w * 0.5);
    this.unit = u;
    const m = Math.max(10, u * 0.04); // marge des bords
    this.leftBase = { x: m + u * 0.2, y: h - m - u * 0.22 };
    this.fireBase = { x: w - m - u * 0.24, y: h - m - u * 0.24, r: u * 0.125 };
    const F = this.fireBase;
    const buttons: ButtonLayout[] = [];
    // Compétences en arc autour du stick de tir : à gauche, en haut à gauche, en haut.
    const abilities = f.slots.filter((s) => s === 'secondary' || s === 'ability1' || s === 'ability2');
    const arc = abilities.length >= 3 ? [180, 228, 276] : abilities.length === 2 ? [190, 255] : [215];
    abilities.forEach((slot, i) => {
      const a = (arc[i] * Math.PI) / 180;
      const d = u * 0.31;
      buttons.push({ slot, x: F.x + Math.cos(a) * d, y: F.y + Math.sin(a) * d, r: u * 0.085 });
    });
    if (f.slots.includes('melee')) {
      buttons.push({ slot: 'melee', x: F.x - u * 0.33, y: F.y + u * 0.12, r: u * 0.058 });
    }
    if (f.slots.includes('reload')) {
      const a = (318 * Math.PI) / 180;
      buttons.push({ slot: 'reload', x: F.x + Math.cos(a) * u * 0.25, y: F.y + Math.sin(a) * u * 0.25 - u * 0.04, r: u * 0.05 });
    }
    this.buttons = buttons;
    const mr = u * 0.055;
    this.metaButtons = f.meta.map((b, i) => ({ ...b, x: m + mr + i * (mr * 2 + m * 0.6), y: m + mr, r: mr }));
  }

  // ------------------------------------------------------------ pointeurs

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.active = true;
    tryFullscreen();
    try {
      this.canvas.setPointerCapture(e.pointerId); // le pouce peut sortir du canvas sans perdre le stick
    } catch {
      /* pointeur déjà relâché */
    }
    const { x, y } = this.local(e);
    const touch = { id: e.pointerId, ox: x, oy: y, x, y };

    for (const b of this.metaButtons) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.4) {
        this.onMetaPress(b.code); // touche simulée, lue à la prochaine image
        return;
      }
    }
    for (const b of this.buttons) {
      if (Math.hypot(x - b.x, y - b.y) > b.r * 1.25) continue;
      // Un seul bouton à la fois : un nouvel appui remplace l'ancien (relâchement perdu...).
      if (this.button?.hint.mode === 'hold') this.heldSet.delete(SLOT_ACTION[this.button.slot]);
      const hint = this.hints[b.slot as InputSlot] ?? (b.slot === 'melee' || b.slot === 'reload' ? { mode: 'tap' as const } : DEFAULT_TOUCH_HINT);
      this.button = { ...touch, ox: b.x, oy: b.y, slot: b.slot, hint, dragged: false };
      const action = SLOT_ACTION[b.slot];
      if (hint.mode === 'tap') this.pending.push({ slot: b.slot, hint, manual: false });
      else if (hint.mode === 'hold') {
        this.heldSet.add(action);
        this.pressedSet.add(action);
      }
      return;
    }
    if (x < (this.width || this.canvas.clientWidth) * 0.5) {
      if (!this.left) this.left = touch;
      return;
    }
    if (!this.fire) {
      // Près de la base : stick fixe ; ailleurs à droite : il naît sous le pouce.
      const F = this.fireBase;
      this.fire = Math.hypot(x - F.x, y - F.y) < F.r * 1.6 ? { ...touch, ox: F.x, oy: F.y } : touch;
    }
  }

  /** Position du doigt en px CSS dans le canvas (comme la souris dans Input). */
  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private moveEvt(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const { x, y } = this.local(e);
    for (const s of [this.left, this.fire, this.button]) {
      if (s && s.id === e.pointerId) {
        s.x = x;
        s.y = y;
      }
    }
    const b = this.button;
    if (b && b.id === e.pointerId && !b.dragged && Math.hypot(b.x - b.ox, b.y - b.oy) > DRAG_START) b.dragged = true;
  }

  private up(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    if (this.left?.id === e.pointerId) {
      this.left = null;
      this.move = { x: 0, y: 0 };
    }
    if (this.fire?.id === e.pointerId) this.fire = null;
    const b = this.button;
    if (b && b.id === e.pointerId) {
      this.button = null;
      if (b.hint.mode === 'hold') this.heldSet.delete(SLOT_ACTION[b.slot]);
      else if (b.hint.mode === 'aim') this.pending.push({ slot: b.slot, hint: b.hint, manual: b.dragged });
    }
  }

  // ------------------------------------------------------------ chaque image

  private hints: Partial<Record<InputSlot, TouchHint>> = {};

  /** À appeler avant la mise à jour du héros. */
  update(f: TouchFrame): void {
    this.hints = f.hints;
    this.layout(f);
    if (!this.active) return;
    this.sinceManualAim += f.dt;
    const u = this.unit;
    const p = f.player;

    // Déplacement
    const L = this.left;
    if (L) {
      const dx = L.x - L.ox;
      const dy = L.y - L.oy;
      const max = u * 0.12;
      const len = Math.hypot(dx, dy);
      // Le pouce s'éloigne trop : la base le suit (stick toujours sous le pouce).
      if (len > max * 1.6) {
        L.ox = L.x - (dx / len) * max * 1.6;
        L.oy = L.y - (dy / len) * max * 1.6;
      }
      const k = Math.min(1, len / max);
      this.move = k < DEAD ? { x: 0, y: 0 } : { x: (dx / len) * k, y: (dy / len) * k };
    }

    // Visée d'une compétence en glissant depuis son bouton
    const b = this.button;
    this.preview = null;
    if (b && b.hint.mode !== 'tap') {
      const range = b.hint.range ?? DEFAULT_TOUCH_HINT.range!;
      if (b.dragged) {
        const dx = b.x - b.ox;
        const dy = b.y - b.oy;
        this.aimAngle = Math.atan2(dy, dx);
        this.aimDist = Math.max(30, Math.min(1, Math.hypot(dx, dy) / (u * 0.22)) * range);
        this.sinceManualAim = 0;
      }
      if (b.hint.mode === 'aim') this.preview = { slot: b.slot, range };
    }

    // Stick de tir : vise et tire (aide à la visée)
    const F = this.fire;
    this.firing = false;
    this.heldSet.delete('primary');
    if (F) {
      const dx = F.x - F.ox;
      const dy = F.y - F.oy;
      const len = Math.hypot(dx, dy);
      if (len > u * 0.12 * DEAD) {
        const a = Math.atan2(dy, dx);
        const t = this.assist(p, f, a);
        this.aimAngle = t ? Math.atan2(t.y - p.y, t.x - p.x) : a;
        this.aimDist = t ? Math.hypot(t.x - p.x, t.y - p.y) : 300;
        this.sinceManualAim = 0;
        this.heldSet.add('primary');
        this.firing = true;
      }
    }

    // Appuis en attente : cible automatique si on n'a pas visé à la main
    for (const q of this.pending) {
      if (!q.manual && q.hint.mode === 'aim') this.autoAim(p, f, q.hint);
      if (q.hint.mode === 'aim') this.sinceManualAim = 0;
      this.pressedSet.add(SLOT_ACTION[q.slot]);
    }
    this.pending = [];

    // Sans visée récente : le héros regarde où il va.
    if (!F && !b && this.sinceManualAim > KEEP_AIM && (this.move.x || this.move.y)) {
      this.aimAngle = Math.atan2(this.move.y, this.move.x);
      this.aimDist = 260;
    }
  }

  /** Aide à la visée : ennemi visible le plus proche de la direction poussée. */
  private assist(p: Combatant, f: TouchFrame, angle: number): Combatant | null {
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const c of f.targets) {
      if (!c.alive || !hostile(p, c) || c.stealthed || c.safe) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < 1 || d > ASSIST_RANGE) continue;
      const off = Math.abs(angleDiff(angle, Math.atan2(c.y - p.y, c.x - p.x)));
      if (off > ASSIST_CONE) continue;
      if (!lineOfSight(f.arena, p.x, p.y, c.x, c.y)) continue;
      const score = off * 600 + d * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Appui simple sur un bouton « aim » : vise la cible automatique de la compétence. */
  private autoAim(p: Combatant, f: TouchFrame, hint: TouchHint): void {
    const range = (hint.range ?? DEFAULT_TOUCH_HINT.range!) * 1.25;
    const kind = hint.target ?? 'enemy';
    if (kind === 'self') {
      this.aimDist = 1;
      return;
    }
    const pick = (wantAlly: boolean, hurtOnly: boolean): Combatant | null => {
      let best: Combatant | null = null;
      let bestScore = Infinity;
      for (const c of f.targets) {
        if (c === p || !c.alive || hostile(p, c) === wantAlly) continue;
        if (wantAlly ? c.decoy : c.stealthed || c.safe) continue;
        if (hurtOnly && c.hp / c.maxHp >= 0.8) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d > range || !lineOfSight(f.arena, p.x, p.y, c.x, c.y)) continue;
        // Alliés : le plus blessé d'abord ; ennemis : le plus proche, de préférence devant.
        const score = wantAlly ? (c.hp / c.maxHp) * 1000 + d : d + Math.abs(angleDiff(this.aimAngle, Math.atan2(c.y - p.y, c.x - p.x))) * 120;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    };
    const t =
      kind === 'enemy' ? pick(false, false) : kind === 'ally' ? pick(true, false) : (pick(true, true) ?? pick(false, false));
    if (!t) return; // personne : direction actuelle
    this.aimAngle = Math.atan2(t.y - p.y, t.x - p.x);
    this.aimDist = Math.hypot(t.x - p.x, t.y - p.y);
  }
}

/** Plein écran et paysage au premier toucher (si le navigateur le permet). */
let fullscreenTried = false;
function tryFullscreen(): void {
  if (fullscreenTried) return;
  fullscreenTried = true;
  const el = document.documentElement;
  const req = el.requestFullscreen?.bind(el);
  if (!req || document.fullscreenElement) return;
  req({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
    .catch(() => {});
}
