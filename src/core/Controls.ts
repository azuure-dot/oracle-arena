import type { Input } from './Input';
import { normalize, type Vec2 } from './math';

/**
 * Les héros ne lisent jamais le clavier directement : ils lisent des "commandes".
 * Le joueur les remplit avec le clavier et la souris (PlayerControls),
 * un bot les remplit avec son IA (BotControls). Le code des héros est donc
 * le même pour un humain et pour un bot.
 */
export type Action = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'melee' | 'reload';

export interface HeroControls {
  /** Point visé, en coordonnées monde. */
  readonly aimX: number;
  readonly aimY: number;
  /** Direction de déplacement voulue (normalisée, ou nulle). */
  readonly move: Vec2;
  /** Action maintenue (tir automatique, bouclier...). */
  held(action: Action): boolean;
  /** Action déclenchée cette frame (compétence, mêlée...). */
  pressed(action: Action): boolean;
}

/** Codes physiques des touches : OK en AZERTY (ZQSD) comme en QWERTY (WASD). */
const KEYS: Record<Exclude<Action, 'primary' | 'secondary' | 'melee'>, string[]> = {
  ability1: ['Space'],
  ability2: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
};
const MOUSE: Partial<Record<Action, 0 | 1 | 2>> = { primary: 0, melee: 1, secondary: 2 };

/** Commandes du joueur humain : clavier + souris. */
export class PlayerControls implements HeroControls {
  aimX = 0;
  aimY = 0;
  move: Vec2 = { x: 0, y: 0 };

  constructor(private readonly input: Input) {}

  /** À appeler chaque frame avant la mise à jour du héros. */
  sample(aimX: number, aimY: number): void {
    this.aimX = aimX;
    this.aimY = aimY;
    const i = this.input;
    let mx = 0;
    let my = 0;
    if (i.isDown('KeyW', 'ArrowUp')) my -= 1;
    if (i.isDown('KeyS', 'ArrowDown')) my += 1;
    if (i.isDown('KeyA', 'ArrowLeft')) mx -= 1;
    if (i.isDown('KeyD', 'ArrowRight')) mx += 1;
    this.move = normalize(mx, my);
  }

  held(action: Action): boolean {
    const b = MOUSE[action];
    if (b !== undefined) return this.input.isMouseDown(b);
    return this.input.isDown(...KEYS[action as keyof typeof KEYS]);
  }

  pressed(action: Action): boolean {
    const b = MOUSE[action];
    if (b !== undefined) return this.input.wasMousePressed(b);
    return this.input.wasPressed(...KEYS[action as keyof typeof KEYS]);
  }
}

/** Commandes d'un bot : écrites par son IA à chaque frame. */
export class BotControls implements HeroControls {
  aimX = 0;
  aimY = 0;
  move: Vec2 = { x: 0, y: 0 };
  private readonly down = new Set<Action>();
  private readonly justPressed = new Set<Action>();

  /** L'IA repart de zéro à chaque frame : elle redéclare ce qu'elle maintient. */
  beginFrame(): void {
    this.down.clear();
  }
  /** Après la mise à jour du héros : les pressions ne durent qu'une frame. */
  endFrame(): void {
    this.justPressed.clear();
  }
  releaseAll(): void {
    this.down.clear();
    this.justPressed.clear();
    this.move = { x: 0, y: 0 };
  }

  hold(action: Action): void {
    this.down.add(action);
  }
  press(action: Action): void {
    this.justPressed.add(action);
  }

  held(action: Action): boolean {
    return this.down.has(action) || this.justPressed.has(action);
  }
  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }
}

/** Commandes vides (héros sans contrôleur). */
export const NO_CONTROLS: HeroControls = {
  aimX: 0,
  aimY: 0,
  move: { x: 0, y: 0 },
  held: () => false,
  pressed: () => false,
};
