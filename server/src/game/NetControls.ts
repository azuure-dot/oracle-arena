import type { Action, HeroControls } from '../../../src/core/Controls';
import type { Vec2 } from '../../../src/core/math';
import { ACTION_BITS, type PlayerInput } from '../types/network';

/**
 * Temps de marche qu'un joueur peut « avoir d'avance » sur l'horloge du serveur (s). Ses commandes
 * arrivent par paquets (gigue du réseau) : on les accepte tant que leur durée cumulée ne dépasse
 * pas le temps réellement écoulé, plus cette marge. Au-delà (client trafiqué qui annonce des
 * images trop longues), la durée en trop est ignorée : impossible d'aller plus vite que les autres.
 */
export const MOVE_BUDGET_MAX = 0.25;
/** Sans commande depuis ce temps (s), le joueur est « muet » : le serveur fait vivre sa physique. */
export const SILENCE = 0.2;

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
  /** Temps de marche disponible (s) : crédité par la simulation, consommé par les commandes. */
  private budget = 0.1;
  /** Temps de simulation écoulé depuis la dernière commande reçue (s). */
  private silence = 0;

  /** Applique une commande reçue (valeurs déjà vérifiées). false : doublon ou message en retard. */
  apply(input: PlayerInput): boolean {
    if (input.seq <= this.lastSeq) return false;
    this.lastSeq = input.seq;
    this.silence = 0;
    // Longueur ≤ 1 (stick analogique tactile : une petite inclinaison = marche lente, comme en solo).
    const len = Math.hypot(input.mx, input.my);
    this.move = len > 1 ? { x: input.mx / len, y: input.my / len } : { x: input.mx, y: input.my };
    this.aimX = input.ax;
    this.aimY = input.ay;
    this.heldMask = input.held;
    this.pressedMask |= input.pressed;
    return true;
  }

  /**
   * Le temps de la simulation avance : crédit de marche (le trop-plein est perdu : un client dont
   * les images sont plafonnées envoie un peu moins de temps que le réel, sans conséquence).
   * Retourne true si le joueur est muet depuis plus de SILENCE secondes.
   */
  credit(dt: number): boolean {
    this.budget = Math.min(MOVE_BUDGET_MAX, this.budget + dt);
    this.silence += dt;
    return this.silence > SILENCE;
  }

  /** Durée de marche accordée pour une commande de `dt` secondes. */
  consume(dt: number): number {
    const ok = Math.min(dt, this.budget);
    this.budget -= ok;
    return ok;
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
