import { LANGS, getLang, onLangChange, setLang, t } from '../../i18n';

/**
 * Écran HTML par-dessus le canvas (menus, configuration, scores).
 * - Rendu en innerHTML, refait à chaque affichage et à chaque changement de langue.
 * - Clics par délégation : un bouton `data-action="x"` appelle onAction('x').
 * - Clavier : le jeu transmet les touches à l'écran visible (handleKey).
 */
export abstract class Screen {
  protected readonly root: HTMLDivElement;
  private shown = false;

  constructor(parent: HTMLElement, extraClass = '') {
    this.root = document.createElement('div');
    this.root.className = `screen ${extraClass}`.trim();
    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const langBtn = target.closest<HTMLButtonElement>('[data-lang]');
      if (langBtn) {
        setLang(langBtn.dataset.lang as (typeof LANGS)[number]);
        return;
      }
      const el = target.closest<HTMLElement>('[data-action]');
      if (el) this.onAction(el.dataset.action!, el);
    });
    onLangChange(() => {
      if (this.shown) this.render();
    });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Contenu de l'écran (sous la bascule de langue). */
  protected abstract html(): string;
  protected onAction(_action: string, _el: HTMLElement): void {}
  /** Retourne true si la touche a été utilisée. */
  handleKey(_e: KeyboardEvent): boolean {
    return false;
  }

  protected render(): void {
    const lang = getLang();
    this.root.innerHTML = `
      <div class="screen-inner">
        <div class="lang-toggle" role="group" aria-label="${t('select.language')}">
          ${LANGS.map(
            (l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`,
          ).join('')}
        </div>
        ${this.html()}
      </div>`;
  }

  show(): void {
    this.shown = true;
    this.render();
    this.root.classList.add('visible');
  }

  hide(): void {
    this.shown = false;
    this.root.classList.remove('visible');
  }
}

/** Numéro de touche 1-9 (rangée du haut ou pavé numérique), sinon null. */
export function digitOf(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}
