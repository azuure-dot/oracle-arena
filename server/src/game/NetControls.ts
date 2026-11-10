import type { Action, HeroControls } from '../../../src/core/Controls';
import { normalize, type Vec2 } from '../../../src/core/math';
import { ACTION_BITS, type PlayerInput } from '../types/network';

/**
 * Commandes d'un héros piloté À DISTANCE : remplies par les messages PLAYER_INPUT du joueur.
 * Les héros lisent des `HeroControls` (voir src/core/Controls.ts), sans savoir qui les pilote :
 * le même code de héros sert donc au clavier local, à l'IA des bots et au réseau.
 */
export class NetControls implements HeroControls {
  aimX = 0;
  aimY = 0;
  move: Vec2 = { x: 0, y: 0 };
  /** Dernière commande reçue (renvoyée au client : réconciliation de sa prédiction). */
  lastSeq = 0;
  private heldMask = 0;
  /** Pressions reçues depuis le dernier pas de simulation (aucune n'est perdue). */
  private pressedMask = 0;

  /** Applique une commande reçue (valeurs déjà vérifiées). */
  apply(input: PlayerInput): void {
    if (input.seq <= this.lastSeq) return; // doublon ou message en retard
    this.lastSeq = input.seq;
    this.move = normalize(input.mx, input.my);
    this.aimX = input.ax;
    this.aimY = input.ay;
    this.heldMask = input.held;
    this.pressedMask |= input.pressed;
  }

  held(action: Action): boolean {
    const bit = 1 << ACTION_BITS.indexOf(action);
    return (this.heldMask & bit) !== 0 || (this.pressedMask & bit) !== 0;
  }

  pressed(action: Action): boolean {
    return (this.pressedMask & (1 << ACTION_BITS.indexOf(action))) !== 0;
  }

  /** Après un pas de simulation : les pressions ne durent qu'un pas. */
  endStep(): void {
    this.pressedMask = 0;
  }

  /** Joueur parti ou fin de partie : plus rien d'enfoncé. */
  releaseAll(): void {
    this.heldMask = this.pressedMask = 0;
    this.move = { x: 0, y: 0 };
  }
}

/** Vérifie une commande reçue (nombres finis, bornés) ; null si invalide. */
export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  const seq = num(r.seq, 0, Number.MAX_SAFE_INTEGER);
  const dt = num(r.dt, 0, 0.25);
  const mx = num(r.mx, -1, 1);
  const my = num(r.my, -1, 1);
  const ax = num(r.ax, -5000, 10000);
  const ay = num(r.ay, -5000, 10000);
  const held = num(r.held, 0, 63);
  const pressed = num(r.pressed, 0, 63);
  if ([seq, dt, mx, my, ax, ay, held, pressed].some((v) => v === null)) return null;
  return { seq: seq!, dt: dt!, mx: mx!, my: my!, ax: ax!, ay: ay!, held: held! | 0, pressed: pressed! | 0 };
}
