import { INPUT_LABEL_KEYS } from '../heroes/Hero';
import { ROLE_KEYS, ROLE_ORDER, type HeroEntry, type Role } from '../heroes/registry';
import { LANGS, getLang, onLangChange, setLang, t } from '../i18n';

const ROLE_ICONS: Record<Role, string> = {
  tank: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/>',
  damage:
    '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" stroke-width="2.5"/>',
  support: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>',
};

/**
 * Écran de sélection (HTML/CSS par-dessus le canvas) :
 * héros regroupés par rôle, bascule de langue FR/EN, touches 1/2/3 ou clic.
 */
export class SelectScreen {
  private readonly root: HTMLDivElement;
  private readonly ordered: HeroEntry[];
  private visible = false;

  constructor(
    parent: HTMLElement,
    heroes: HeroEntry[],
    private readonly onPick: (hero: HeroEntry) => void,
  ) {
    this.ordered = ROLE_ORDER.flatMap((role) => heroes.filter((h) => h.role === role));
    this.root = document.createElement('div');
    this.root.className = 'select-screen';

    // Délégation d'événements : survit aux re-rendus lors d'un changement de langue.
    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const langBtn = target.closest<HTMLButtonElement>('[data-lang]');
      if (langBtn) {
        setLang(langBtn.dataset.lang as (typeof LANGS)[number]);
        return;
      }
      const card = target.closest<HTMLButtonElement>('[data-hero]');
      if (card) {
        const hero = this.ordered.find((h) => h.id === card.dataset.hero);
        if (hero) this.onPick(hero);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) {
        const hero = this.ordered[Number(m[1]) - 1];
        if (hero) this.onPick(hero);
      }
    });

    onLangChange(() => this.render());
    this.render();
    parent.appendChild(this.root);
  }

  private render(): void {
    const lang = getLang();
    const columns = ROLE_ORDER.map((role) => {
      const cards = this.ordered
        .filter((h) => h.role === role)
        .map((h) => this.cardHtml(h, this.ordered.indexOf(h) + 1))
        .join('');
      if (!cards) return '';
      return `
        <section class="role-col role-${role}">
          <h2 class="role-header">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ROLE_ICONS[role]}</svg>
            ${t(ROLE_KEYS[role])}
          </h2>
          ${cards}
        </section>`;
    }).join('');

    this.root.innerHTML = `
      <div class="select-inner">
        <div class="lang-toggle" role="group" aria-label="${t('select.language')}">
          ${LANGS.map(
            (l) =>
              `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`,
          ).join('')}
        </div>
        <h1>${t('select.title')}</h1>
        <p class="select-sub">${t('select.subtitle')} ${this.ordered.map((_, i) => `<kbd>${i + 1}</kbd>`).join(' ')}</p>
        <div class="role-columns">${columns}</div>
        <p class="select-foot">${t('select.footer', { key: `<kbd>${t('key.escape')}</kbd>` })}</p>
      </div>`;
  }

  private cardHtml(h: HeroEntry, index: number): string {
    return `
      <button type="button" class="hero-card" data-hero="${h.id}" style="--hero-color:${h.color}">
        <div class="hero-head">
          <div class="hero-avatar">${h.name[0]}</div>
          <div>
            <div class="hero-name">${h.name}</div>
            <div class="hero-role">${h.hp} ${t('unit.hp')}</div>
          </div>
          <span class="hero-index">${index}</span>
        </div>
        <p class="hero-tagline">${t(h.tagline)}</p>
        <ul class="hero-abilities">
          ${h.abilities
            .map(
              (a) =>
                `<li><kbd>${t(INPUT_LABEL_KEYS[a.input])}</kbd><span><b>${t(a.name)}</b><small>${t(a.desc)}</small></span></li>`,
            )
            .join('')}
        </ul>
      </button>`;
  }

  show(): void {
    this.visible = true;
    this.root.classList.add('visible');
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('visible');
  }
}
