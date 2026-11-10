import { t, type TKey } from '../../i18n';
import { NetError, SERVER_URL, net } from '../../network/NetworkManager';
import { ROOM_CODE_LENGTH } from '../../../server/src/types/network';
import { profile } from '../lobby/profile';
import { Screen } from './Screen';
import '../net.css';

/**
 * PARTIES PRIVÉES — premier écran : pseudo, « Créer une partie privée » ou « Rejoindre une
 * partie » avec le code du salon. Pas de compte : le pseudo est celui du profil local.
 * La connexion au serveur ne s'ouvre qu'ici (le jeu solo ne se connecte jamais).
 */
export class PrivateHub extends Screen {
  private code = '';
  private busy = false;
  private error: TKey | null = null;

  constructor(
    parent: HTMLElement,
    /** Salon créé ou rejoint : on passe au salon. */
    private readonly onEnter: () => void,
    private readonly onBack: () => void,
  ) {
    super(parent, 'net-screen net-hub');
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'net-code') {
        const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
        if (clean !== el.value) el.value = clean;
        this.code = clean;
        this.root.querySelector<HTMLButtonElement>('[data-action="join"]')!.disabled =
          this.busy || clean.length !== ROOM_CODE_LENGTH;
      }
    });
    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'net-name') profile.set({ name: el.value.trim().slice(0, 16) });
    });
    net.statusChanged.on(() => this.visible && this.render());
  }

  /** Affiche l'écran avec un message (ex. « salon fermé »). */
  showWith(error: TKey | null): void {
    this.error = error;
    this.show();
  }

  override show(): void {
    super.show();
    // On réveille la connexion en arrière-plan : le premier clic sera instantané.
    net.connect().catch(() => {});
  }

  protected html(): string {
    const name = profile.get().name;
    const status =
      net.status === 'connecting'
        ? `<p class="net-status">${t('net.status.connecting')}</p>`
        : '';
    const error = this.error ? `<p class="net-error" role="alert">${t(this.error)}</p>` : '';
    return `
      <h1>${t('net.title')}</h1>
      <p class="select-sub">${t('net.subtitle')}</p>
      <div class="setup-panel net-panel">
        <label class="setup-row">
          <span class="setup-label">${t('net.name')}</span>
          <input class="net-input" name="net-name" type="text" maxlength="16" autocomplete="nickname" spellcheck="false"
            value="${escapeHtml(name)}" placeholder="${t('lobby.defaultName')}">
        </label>
        <div class="net-choices">
          <section class="net-choice">
            <h2>${t('net.create')}</h2>
            <p>${t('net.create.desc')}</p>
            <button type="button" class="btn btn-primary" data-action="create" ${this.busy ? 'disabled' : ''}>${t('net.create.btn')}</button>
          </section>
          <section class="net-choice">
            <h2>${t('net.join')}</h2>
            <p>${t('net.join.desc')}</p>
            <div class="net-join">
              <input class="net-input net-code-input" name="net-code" type="text" inputmode="text" autocapitalize="characters"
                autocomplete="off" spellcheck="false" maxlength="${ROOM_CODE_LENGTH}" placeholder="ABC123"
                aria-label="${t('net.code')}" value="${this.code}">
              <button type="button" class="btn btn-primary" data-action="join"
                ${this.busy || this.code.length !== ROOM_CODE_LENGTH ? 'disabled' : ''}>${t('net.join.btn')}</button>
            </div>
          </section>
        </div>
        ${status}${error}
        <p class="net-server">${t('net.server', { url: SERVER_URL })}</p>
      </div>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="back"><kbd>${t('key.escape')}</kbd> ${t('ui.back')}</button>
      </div>`;
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await action();
      this.busy = false;
      this.onEnter();
    } catch (e) {
      this.busy = false;
      this.error = e instanceof NetError ? (`net.err.${e.code}` as TKey) : 'net.err.bad_request';
      if (this.visible) this.render();
    }
  }

  private heroId(): string {
    try {
      return localStorage.getItem('hero-shooter.net-hero') ?? 'thor';
    } catch {
      return 'thor';
    }
  }

  private playerName(): string {
    const input = this.root.querySelector<HTMLInputElement>('[name="net-name"]');
    const name = (input?.value ?? profile.get().name).trim().slice(0, 16);
    if (name !== profile.get().name) profile.set({ name });
    return name || t('lobby.defaultName');
  }

  protected override onAction(action: string): void {
    if (action === 'back') this.onBack();
    else if (action === 'create') void this.run(() => net.createRoom(this.playerName(), this.heroId()));
    else if (action === 'join' && this.code.length === ROOM_CODE_LENGTH) {
      void this.run(() => net.joinRoom(this.code, this.playerName(), this.heroId()));
    }
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.onBack();
      return true;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target instanceof HTMLInputElement && e.target.name === 'net-code') {
      this.onAction('join');
      return true;
    }
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
