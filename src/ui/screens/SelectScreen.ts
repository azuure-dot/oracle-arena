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
/** Changement de héros en cours de partie (au spawn) : héros interdits + rappels. */
export interface SwapContext {
  /** Noms des héros déjà pris par les coéquipiers. */
  taken: string[];
  current: string;
  onPick(hero: HeroEntry): void;
  onClose(): void;
}

export class SelectScreen extends Screen {
  private readonly ordered: HeroEntry[];
  mode: ModeKind = 'practice';
  /** Nom de la carte (mode Contrôle), affiché dans le titre. */
  mapName = '';
  /** Défini pendant un changement de héros en jeu. */
  swap: SwapContext | null = null;

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

    const key = { key: `<kbd>${t('key.escape')}</kbd>` };
    let title: string;
    let footer: string;
    if (this.swap) {
      title = t('select.swap');
      footer = t('select.swap.footer', key);
    } else if (this.mode === 'control') {
      title = t('select.title.control', { map: this.mapName });
      footer = t('select.footer.dm', key);
    } else if (this.mode === 'deathmatch') {
      title = t('select.title.dm');
      footer = t('select.footer.dm', key);
    } else {
      title = t('select.title');
      footer = t('select.footer', key);
    }
    return `
      <h1>${title}</h1>
      <p class="select-sub">${t('select.subtitle')} ${this.ordered.map((_, i) => `<kbd>${i + 1}</kbd>`).join(' ')}</p>
      <div class="role-columns">${columns}</div>
      <p class="select-foot">${footer}</p>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="back"><kbd>${t('key.escape')}</kbd> ${t('ui.back')}</button>
      </div>`;
  }

  private isTaken(h: HeroEntry): boolean {
    return !!this.swap && (this.swap.taken.includes(h.name) || this.swap.current === h.name);
  }

  private cardHtml(h: HeroEntry, index: number): string {
    const taken = this.isTaken(h);
    const note = taken && this.swap?.current !== h.name ? `<span class="hero-taken">${t('select.taken')}</span>` : '';
    return `
      <button type="button" class="hero-card${taken ? ' is-taken' : ''}" data-action="pick" data-hero="${h.id}" style="--hero-color:${h.color}" ${taken ? 'disabled aria-disabled="true"' : ''}>
        ${note}
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

  private back(): void {
    if (this.swap) this.swap.onClose();
    else this.onBack();
  }

  private pick(hero: HeroEntry): void {
    if (this.isTaken(hero)) return;
    if (this.swap) this.swap.onPick(hero);
    else this.onPick(hero);
  }

  protected override onAction(action: string, el: HTMLElement): void {
    if (action === 'back') return this.back();
    if (action !== 'pick') return;
    const hero = this.ordered.find((h) => h.id === el.dataset.hero);
    if (hero) this.pick(hero);
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.back();
      return true;
    }
    const d = digitOf(e);
    const hero = d !== null ? this.ordered[d - 1] : undefined;
    if (!hero) return false;
    this.pick(hero);
    return true;
  }
}
