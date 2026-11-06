import { t } from '../../i18n';
import { Screen, digitOf } from './Screen';

const ICONS = {
  practice:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/>',
  deathmatch:
    '<path d="M4 3l7 7-2 2-7-7V3h2Zm16 0h2v2l-7 7-2-2 7-7ZM3 19l5-5 2 2-5 5H3v-2Zm18 0v2h-2l-5-5 2-2 5 5Z"/>',
};

export type MenuChoice = 'practice' | 'deathmatch';

/** Menu principal : Champ de tir ou Deathmatch. */
export class MainMenu extends Screen {
  constructor(
    parent: HTMLElement,
    private readonly onChoose: (choice: MenuChoice) => void,
  ) {
    super(parent, 'main-menu');
  }

  protected html(): string {
    const card = (id: MenuChoice, index: number, name: string, desc: string) => `
      <button type="button" class="mode-card mode-${id}" data-action="${id}">
        <span class="mode-index">${index}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[id]}</svg>
        <span class="mode-name">${name}</span>
        <span class="mode-desc">${desc}</span>
      </button>`;
    return `
      <h1 class="menu-title">${t('menu.title')}</h1>
      <p class="select-sub">${t('menu.subtitle')}</p>
      <div class="mode-cards">
        ${card('practice', 1, t('menu.practice'), t('menu.practice.desc'))}
        ${card('deathmatch', 2, t('menu.deathmatch'), t('menu.deathmatch.desc'))}
      </div>`;
  }

  protected override onAction(action: string): void {
    if (action === 'practice' || action === 'deathmatch') this.onChoose(action);
  }

  override handleKey(e: KeyboardEvent): boolean {
    const d = digitOf(e);
    if (d === 1) this.onChoose('practice');
    else if (d === 2) this.onChoose('deathmatch');
    else return false;
    return true;
  }
}
