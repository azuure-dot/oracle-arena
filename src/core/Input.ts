/**
 * Gestion clavier + souris.
 * On utilise `KeyboardEvent.code` (position physique de la touche) :
 * KeyW/KeyA/KeyS/KeyD correspondent donc à ZQSD sur un clavier AZERTY
 * et à WASD sur un clavier QWERTY, sans configuration.
 */
export class Input {
  mouseX = 0; // coordonnées écran (px CSS)
  mouseY = 0;

  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private buttonsDown = [false, false, false];
  private buttonsPressed = [false, false, false];

  private static readonly PREVENT = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ShiftLeft',
    'ShiftRight',
    'Tab',
  ]);

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.keysPressed.add(e.code);
      this.keysDown.add(e.code);
      if (Input.PREVENT.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      this.buttonsDown[e.button] = true;
      this.buttonsPressed[e.button] = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.buttonsDown[e.button] = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keysDown.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.keysPressed.has(c));
  }

  /** 0 = gauche, 1 = milieu, 2 = droit */
  isMouseDown(button: 0 | 1 | 2): boolean {
    return this.buttonsDown[button];
  }

  wasMousePressed(button: 0 | 1 | 2): boolean {
    return this.buttonsPressed[button];
  }

  /** À appeler à la fin de chaque frame pour vider les événements "pressés". */
  endFrame(): void {
    this.keysPressed.clear();
    this.buttonsPressed.fill(false);
  }

  private reset(): void {
    this.keysDown.clear();
    this.keysPressed.clear();
    this.buttonsDown.fill(false);
    this.buttonsPressed.fill(false);
  }
}
