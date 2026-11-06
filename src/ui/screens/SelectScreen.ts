import { INPUT_LABEL_KEYS } from '../../heroes/Hero';
import { ROLE_KEYS, ROLE_ORDER, type HeroEntry, type Role } from '../../heroes/registry';
import { t } from '../../i18n';
import type { ModeKind } from '../../modes/GameMode';
import { Screen, digitOf } from './Screen';

const ROLE_ICONS: Record<Role, string> = {
  tank: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/>',
  damage:
    '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" stroke-width="2.5"/>',
  support: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>',
};

/**
 * Sélection du héros, regroupés par rôle (clic ou touches 1/2/3).
 * Sert aux deux modes : seuls le titre et le pied de page changent.
 */
export class SelectScreen extends Screen {
  private readonly ordered: HeroEntry[];
  mode: ModeKind = 'practice';

  constructor(
    parent: HTMLElement,
    heroes: HeroEntry[],
    private readonly onPick: (hero: HeroEntry) => void,
    private readonly onBack: () => void,
  ) {
    super(parent, 'select-screen');
    this.ordered = ROLE_ORDER.flatMap((role) => heroes.filter((h) => h.role === role));
  }

  protected html(): string {
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

    const dm = this.mode === 'deathmatch';
    const footer = t(dm ? 'select.footer.dm' : 'select.footer', { key: `<kbd>${t('key.escape')}</kbd>` });
    return `
      <h1>${t(dm ? 'select.title.dm' : 'select.title')}</h1>
      <p class="select-sub">${t('select.subtitle')} ${this.ordered.map((_, i) => `<kbd>${i + 1}</kbd>`).join(' ')}</p>
      <div class="role-columns">${columns}</div>
      <p class="select-foot">${footer}</p>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="back"><kbd>${t('key.escape')}</kbd> ${t('ui.back')}</button>
      </div>`;
  }

  private cardHtml(h: HeroEntry, index: number): string {
    return `
      <button type="button" class="hero-card" data-action="pick" data-hero="${h.id}" style="--hero-color:${h.color}">
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

  protected override onAction(action: string, el: HTMLElement): void {
    if (action === 'back') return this.onBack();
    if (action !== 'pick') return;
    const hero = this.ordered.find((h) => h.id === el.dataset.hero);
    if (hero) this.onPick(hero);
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.onBack();
      return true;
    }
    const d = digitOf(e);
    const hero = d !== null ? this.ordered[d - 1] : undefined;
    if (!hero) return false;
    this.onPick(hero);
    return true;
  }
}
