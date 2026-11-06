import { t } from '../../i18n';
import { DM_LIMITS, type DeathmatchConfig } from '../../modes/DeathmatchMode';
import { Screen, digitOf } from './Screen';

const STORAGE_KEY = 'hero-shooter.dm-config';

function loadConfig(): DeathmatchConfig {
  const fallback: DeathmatchConfig = { bots: 5, minutes: 3 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DeathmatchConfig> | null;
    const bots = Number(raw?.bots);
    const minutes = Number(raw?.minutes);
    return {
      bots: bots >= DM_LIMITS.minBots && bots <= DM_LIMITS.maxBots ? bots : fallback.bots,
      minutes: (DM_LIMITS.durations as readonly number[]).includes(minutes) ? minutes : fallback.minutes,
    };
  } catch {
    return fallback;
  }
}

/** Configuration du Deathmatch : nombre de bots et durée, puis « Suivant ». */
export class DeathmatchSetup extends Screen {
  config: DeathmatchConfig = loadConfig();

  constructor(
    parent: HTMLElement,
    private readonly onNext: (config: DeathmatchConfig) => void,
    private readonly onBack: () => void,
  ) {
    super(parent, 'dm-setup');
  }

  protected html(): string {
    const bots: number[] = [];
    for (let n = DM_LIMITS.minBots; n <= DM_LIMITS.maxBots; n++) bots.push(n);
    const seg = (action: string, values: number[], current: number, label: (n: number) => string) =>
      values
        .map(
          (n) =>
            `<button type="button" data-action="${action}" data-value="${n}" aria-pressed="${n === current}">${label(n)}</button>`,
        )
        .join('');
    return `
      <h1>${t('menu.deathmatch')}</h1>
      <p class="select-sub">${t('dm.subtitle')}</p>
      <div class="setup-panel">
        <div class="setup-row">
          <span class="setup-label">${t('dm.bots')}</span>
          <div class="segmented" role="group" aria-label="${t('dm.bots')}">
            ${seg('bots', bots, this.config.bots, String)}
          </div>
        </div>
        <div class="setup-row">
          <span class="setup-label">${t('dm.duration')}</span>
          <div class="segmented" role="group" aria-label="${t('dm.duration')}">
            ${seg('minutes', [...DM_LIMITS.durations], this.config.minutes, (n) => t('dm.minutes', { n }))}
          </div>
        </div>
        <p class="setup-summary">${t('dm.summary', { bots: this.config.bots, min: this.config.minutes })}</p>
      </div>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="back"><kbd>${t('key.escape')}</kbd> ${t('ui.back')}</button>
        <button type="button" class="btn btn-primary" data-action="next">${t('ui.next')} <kbd>${t('key.enter')}</kbd></button>
      </div>`;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      /* stockage indisponible : réglage non mémorisé */
    }
  }

  protected override onAction(action: string, el: HTMLElement): void {
    const value = Number(el.dataset.value);
    if (action === 'bots') this.config = { ...this.config, bots: value };
    else if (action === 'minutes') this.config = { ...this.config, minutes: value };
    else if (action === 'next') return this.next();
    else if (action === 'back') return this.onBack();
    else return;
    this.save();
    this.render();
  }

  private next(): void {
    this.save();
    this.onNext(this.config);
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') this.onBack();
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.next();
    else {
      const d = digitOf(e);
      if (d === null || d > DM_LIMITS.maxBots) return false;
      this.config = { ...this.config, bots: d }; // touches 1-7 : nombre de bots
      this.save();
      this.render();
    }
    return true;
  }
}
