import { LANGS, getLang, onLangChange, setLang, t } from '../../i18n';
import { morph } from '../morph';
import { onThemeChange } from '../theme';

/**
 * Écran HTML par-dessus le canvas (menus, configuration, scores).
 * - Rendu par mise à jour en place (morph) : seuls les éléments qui changent sont touchés, à
 *   l'affichage comme à chaque action ou changement de langue (pas de « rechargement » visible).
 * - Clics par délégation : un bouton `data-action="x"` appelle onAction('x').
 * - Clavier : le jeu transmet les touches à l'écran visible (handleKey).
 * - `covers` : l'écran cache entièrement le jeu (fond opaque, variable CSS `--screen-covers: 1`
 *   posée par le thème) ; le jeu peut alors cesser de dessiner derrière.
 */
export abstract class Screen {
  protected readonly root: HTMLDivElement;
  private shown = false;
  private coversGame = false;

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
    onThemeChange(() => {
      if (this.shown) this.measureCover();
    });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** L'écran est affiché et cache entièrement le jeu. */
  get covers(): boolean {
    return this.shown && this.coversGame;
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
    morph(
      this.root,
      `<div class="screen-inner">
        <div class="lang-toggle" role="group" aria-label="${t('select.language')}">
          ${LANGS.map(
            (l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`,
          ).join('')}
        </div>
        ${this.html()}
      </div>`,
    );
  }

  show(): void {
    this.shown = true;
    this.render();
    this.root.classList.add('visible');
    this.measureCover();
  }

  hide(): void {
    this.shown = false;
    this.root.classList.remove('visible');
  }

  private measureCover(): void {
    this.coversGame = getComputedStyle(this.root).getPropertyValue('--screen-covers').trim() === '1';
  }
}

/** Numéro de touche 1-9 (rangée du haut ou pavé numérique), sinon null. */
export function digitOf(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}
