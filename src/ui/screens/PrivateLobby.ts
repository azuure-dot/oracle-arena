import { HEROES, ROLE_KEYS } from '../../heroes/registry';
import { t, type TKey } from '../../i18n';
import { NetError, net } from '../../network/NetworkManager';
import {
  MATCH_MINUTES,
  MAX_PLAYERS,
  NET_MODE_ORDER,
  NET_MODES,
  type NetModeId,
  type RoomSettings,
  type RoomState,
} from '../../../server/src/types/network';
import { PRACTICE_MAP, QUICKPLAY_MAPS } from '../../world/maps';
import { escapeHtml } from './PrivateHub';
import { Screen } from './Screen';
import '../net.css';

const MODE_NAMES: Record<NetModeId, TKey> = {
  practice: 'menu.practice',
  deathmatch: 'menu.deathmatch',
  control: 'mode.control',
  escort: 'mode.escort',
};

const MAP_NAMES = new Map([PRACTICE_MAP, ...QUICKPLAY_MAPS].map((m) => [m.id, m.nameKey]));
/** La carte du Deathmatch est l'arène du champ de tir : on l'appelle « Arène » dans le salon. */
const mapName = (id: string): string => (id === 'practice' ? t('net.lobby.arena') : t(MAP_NAMES.get(id) ?? 'menu.practice'));

export const NET_HERO_KEY = 'hero-shooter.net-hero';

/**
 * SALON PRIVÉ : code à partager, joueurs (6 places), réglages de l'hôte (mode, carte, durée,
 * bots), choix du héros, « Prêt / Pas prêt ». « Lancer la partie » est réservé à l'hôte et ne
 * s'active que quand tous les vrais joueurs sont prêts. Tout l'état vient du serveur
 * (ROOM_UPDATED) : l'écran se redessine en place à chaque changement.
 */
export class PrivateLobby extends Screen {
  private error: TKey | null = null;
  private copied = 0;

  constructor(
    parent: HTMLElement,
    private readonly onLeave: () => void,
  ) {
    super(parent, 'net-screen net-lobby');
    net.roomUpdated.on(() => this.visible && this.render());
  }

  override show(): void {
    this.error = null;
    super.show();
  }

  private get room(): RoomState | null {
    return net.room;
  }

  protected html(): string {
    const room = this.room;
    if (!room) return `<h1>${t('net.lobby.title')}</h1>`;
    const host = net.isHost;
    const s = room.settings;
    const me = room.players.find((p) => p.id === net.you);

    // --- joueurs
    const slots: string[] = room.players.map((p) => {
      const hero = HEROES.find((h) => h.id === p.heroId) ?? HEROES[0];
      return `
        <li class="net-player${p.id === net.you ? ' is-me' : ''}" style="--hero-color:${hero.color}">
          <span class="hero-dot"></span>
          <span class="net-player-name">${escapeHtml(p.name)}${p.id === net.you ? ` <small>(${t('net.lobby.you')})</small>` : ''}</span>
          <span class="net-player-hero">${hero.name}</span>
          ${p.isHost ? `<span class="net-badge net-badge--host">${t('net.lobby.host')}</span>` : ''}
          <span class="net-badge ${p.ready ? 'net-badge--ready' : 'net-badge--wait'}">${t(p.ready ? 'net.lobby.ready' : 'net.lobby.notReady')}</span>
        </li>`;
    });
    for (let i = room.players.length; i < MAX_PLAYERS; i++) {
      slots.push(`<li class="net-player is-empty"><span class="hero-dot"></span><span class="net-player-name">${t(s.fillBots ? 'net.lobby.botSlot' : 'net.lobby.empty')}</span></li>`);
    }

    // --- réglages (modifiables par l'hôte seulement)
    const seg = <T extends string | number | boolean>(
      action: string,
      values: readonly T[],
      current: T,
      label: (v: T) => string,
      soon?: (v: T) => boolean,
    ) =>
      values
        .map(
          (v) =>
            `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === current}" ${host ? '' : 'disabled'}>${label(v)}${
              soon?.(v) ? ` <small class="net-soon">${t('net.lobby.soon')}</small>` : ''
            }</button>`,
        )
        .join('');

    // --- héros
    const heroes = HEROES.map(
      (h) => `
        <button type="button" class="net-hero" data-action="hero" data-value="${h.id}" aria-pressed="${me?.heroId === h.id}"
          style="--hero-color:${h.color}" ${me?.ready ? 'disabled' : ''}>
          <span class="hero-dot"></span><strong>${h.name}</strong><small>${t(ROLE_KEYS[h.role])}</small>
        </button>`,
    ).join('');

    // --- lancement
    const humansReady = room.players.every((p) => p.ready);
    const participants = s.fillBots ? MAX_PLAYERS : room.players.length;
    const online = NET_MODES[s.mode].online;
    let wait: TKey;
    if (!online) wait = 'net.lobby.wait.mode';
    else if (participants < 2) wait = 'net.lobby.wait.few';
    else if (!humansReady) wait = 'net.lobby.wait.ready';
    else if (!host) wait = 'net.lobby.wait.host';
    else wait = 'net.lobby.go';
    const canStart = host && online && humansReady && participants >= 2;

    return `
      <h1>${t('net.lobby.title')}</h1>
      <div class="net-code-box">
        <span class="setup-label">${t('net.lobby.code')}</span>
        <strong class="net-code" aria-label="${t('net.lobby.code')} ${room.code.split('').join(' ')}">${room.code}</strong>
        <button type="button" class="btn net-copy" data-action="copy">${t(this.copied ? 'net.lobby.copied' : 'net.lobby.copy')}</button>
        <p class="net-share">${t('net.lobby.share')}</p>
      </div>
      <div class="net-lobby-grid">
        <section class="setup-panel net-panel">
          <span class="setup-label">${t('net.lobby.players')} · ${room.players.length}/${MAX_PLAYERS}</span>
          <ol class="net-players">${slots.join('')}</ol>
          <span class="setup-label">${t('net.lobby.hero')}</span>
          <div class="net-heroes">${heroes}</div>
        </section>
        <section class="setup-panel net-panel">
          <span class="setup-label">${t('net.lobby.settings')}</span>
          ${host ? '' : `<p class="net-hint">${t('net.lobby.hostOnly')}</p>`}
          <div class="setup-row">
            <span class="setup-label">${t('net.lobby.mode')}</span>
            <div class="segmented net-seg-wrap">${seg('mode', NET_MODE_ORDER, s.mode, (m) => t(MODE_NAMES[m]), (m) => !NET_MODES[m].online)}</div>
          </div>
          <div class="setup-row">
            <span class="setup-label">${t('net.lobby.map')}</span>
            <div class="segmented">${seg('map', NET_MODES[s.mode].maps, s.mapId, mapName)}</div>
          </div>
          <div class="setup-row">
            <span class="setup-label">${t('net.lobby.duration')}</span>
            <div class="segmented">${seg('minutes', MATCH_MINUTES, s.minutes as (typeof MATCH_MINUTES)[number], (n) => t('dm.minutes', { n }))}</div>
          </div>
          <div class="setup-row">
            <span class="setup-label">${t('net.lobby.bots')}</span>
            <div class="segmented">${seg('bots', [true, false], s.fillBots, (b) => t(b ? 'net.lobby.yes' : 'net.lobby.no'))}</div>
          </div>
        </section>
      </div>
      <p class="net-wait${canStart ? ' is-go' : ''}" aria-live="polite">${t(room.phase === 'playing' ? 'net.lobby.inGame' : wait)}</p>
      ${this.error ? `<p class="net-error" role="alert">${t(this.error)}</p>` : ''}
      <div class="screen-actions">
        <button type="button" class="btn" data-action="leave"><kbd>${t('key.escape')}</kbd> ${t('net.lobby.leave')}</button>
        <button type="button" class="btn${me?.ready ? '' : ' btn-primary'}" data-action="ready">${t(me?.ready ? 'net.lobby.setNotReady' : 'net.lobby.setReady')}</button>
        ${host ? `<button type="button" class="btn btn-primary net-start" data-action="start" ${canStart ? '' : 'disabled'}>${t('net.lobby.start')}</button>` : ''}
      </div>`;
  }

  private async send(action: () => Promise<unknown>): Promise<void> {
    try {
      this.error = null;
      await action();
    } catch (e) {
      this.error = e instanceof NetError ? (`net.err.${e.code}` as TKey) : 'net.err.bad_request';
      if (this.visible) this.render();
    }
  }

  private settings(patch: Partial<RoomSettings>): void {
    void this.send(() => net.updateSettings(patch));
  }

  protected override onAction(action: string, el: HTMLElement): void {
    const v = el.dataset.value ?? '';
    const me = this.room?.players.find((p) => p.id === net.you);
    switch (action) {
      case 'leave':
        this.leave();
        return;
      case 'copy':
        void navigator.clipboard?.writeText(this.room?.code ?? '').then(() => {
          window.clearTimeout(this.copied);
          this.copied = window.setTimeout(() => {
            this.copied = 0;
            if (this.visible) this.render();
          }, 1500);
          this.render();
        });
        return;
      case 'mode':
        this.settings({ mode: v as NetModeId });
        return;
      case 'map':
        this.settings({ mapId: v });
        return;
      case 'minutes':
        this.settings({ minutes: Number(v) });
        return;
      case 'bots':
        this.settings({ fillBots: v === 'true' });
        return;
      case 'hero':
        try {
          localStorage.setItem(NET_HERO_KEY, v);
        } catch {
          /* non mémorisé */
        }
        void this.send(() => net.selectHero(v));
        return;
      case 'ready':
        void this.send(() => net.setReady(!me?.ready));
        return;
      case 'start':
        void this.send(() => net.startGame());
        return;
    }
  }

  private leave(): void {
    void net.leaveRoom();
    this.onLeave();
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.leave();
      return true;
    }
    return false;
  }
}
