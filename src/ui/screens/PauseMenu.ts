import { t } from '../../i18n';
import { profile } from '../lobby/profile';
import { bindSettingsInputs, settingsAction, settingsModal } from '../lobby/settingsPanel';
import { morph } from '../morph';
import { onThemeChange } from '../theme';
import { Screen } from './Screen';
import '../ingame.css';

/**
 * MENU ÉCHAP EN JEU : « Revenir au jeu », « Options » (le panneau Paramètres du menu principal,
 * voir lobby/settingsPanel.ts) et « Quitter la partie ». Même style que le menu principal
 * (panneau de marbre à liseré d'or), posé sur la partie assombrie : il ne la cache pas.
 * En solo la partie est figée tant qu'il est ouvert ; en ligne elle continue (Game.update).
 */
export class PauseMenu extends Screen {
  private settingsOpen = false;
  private online = false;
  /** Le panneau vient de s'ouvrir : le focus va à son premier bouton. */
  private justOpened = false;

  constructor(
    parent: HTMLElement,
    private readonly onResume: () => void,
    private readonly onQuit: () => void,
  ) {
    super(parent, 'pause-menu');
    bindSettingsInputs(this.root);
    profile.subscribe(() => this.visible && this.render());
    onThemeChange(() => this.visible && this.render());
    // Clic sur le fond assombri : on ferme les options, sinon on reprend la partie.
    this.root.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).classList.contains('lb-scrim')) return;
      if (this.settingsOpen) this.closeSettings();
      else this.onResume();
    });
  }

  /** Ouvre le menu (`online` : la partie continue derrière, on le rappelle). */
  open(online: boolean): void {
    this.online = online;
    this.settingsOpen = false;
    this.justOpened = true;
    this.show();
  }

  /** Sans la bascule de langue générique : la langue est dans les Options. */
  protected override render(): void {
    morph(this.root, `<div class="screen-inner">${this.html()}</div>`);
    if (this.justOpened) {
      this.justOpened = false;
      this.root.querySelector<HTMLElement>('.lb-modal [data-autofocus], .lb-pause-actions button')?.focus({ preventScroll: true });
    }
  }

  protected html(): string {
    if (this.settingsOpen) return settingsModal();
    return `
      <div class="lb-scrim lb-scrim--modal lb-scrim--pause"></div>
      <section class="lb-modal lb-pause" role="dialog" aria-modal="true" aria-labelledby="lb-pause-title">
        <header class="lb-panel-head">
          <h2 id="lb-pause-title">${t('pause.title')}</h2>
        </header>
        <div class="lb-pause-actions">
          <button type="button" class="lb-launch" data-action="resume">${t('pause.resume')}</button>
          <button type="button" class="lb-pause-btn" data-action="options">${t('pause.options')}</button>
          <button type="button" class="lb-pause-btn lb-pause-btn--quit" data-action="quit">${t('pause.quit')}</button>
        </div>
        ${this.online ? `<p class="lb-pause-note">${t('pause.online')}</p>` : ''}
        <p class="lb-pause-hint">${t('pause.hint')}</p>
      </section>`;
  }

  private closeSettings(): void {
    this.settingsOpen = false;
    this.justOpened = true;
    this.render();
  }

  protected override onAction(action: string, el: HTMLElement): void {
    switch (action) {
      case 'resume':
        this.onResume();
        return;
      case 'options':
        this.settingsOpen = true;
        this.justOpened = true;
        this.render();
        return;
      case 'close':
        this.closeSettings();
        return;
      case 'quit':
        this.onQuit();
        return;
      default:
        settingsAction(action, el);
    }
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape') return false;
    if (this.settingsOpen) this.closeSettings();
    else this.onResume();
    return true;
  }
}
