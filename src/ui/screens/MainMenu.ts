import { LANGS, t, type TKey } from '../../i18n';
import { ART_IDS, ART_META, avatarSvg, bannerSvg, type ArtId } from '../lobby/art';
import { KITS } from '../lobby/kits';
import { MODES, PARTY_SIZE, PLAYABLE, profile, type ModeId } from '../lobby/profile';
import { morph } from '../morph';
import { THEMES, getTheme, onThemeChange, setTheme, type ThemeId } from '../theme';
import { Screen, digitOf } from './Screen';

/**
 * MENU PRINCIPAL, dans le style d'interface choisi (Grèce antique, mythologique ou e-sport ;
 * voir src/ui/theme.ts et src/ui/lobby/kits.ts) :
 * - en haut, les onglets (Accueil ; Passe de combat et Boutique verrouillés, « Bientôt ») et la
 *   roue des paramètres ;
 * - au centre, le groupe de 6 : le joueur (chef de groupe, avatar, pseudo, bannière) et 5 places
 *   où ajouter des bots (le jeu en ligne n'existe pas encore) ;
 * - en bas à gauche, JOUER ouvre le tiroir des modes (Partie rapide, Deathmatch, Champ de tir ;
 *   Classé verrouillé) avec la note sur les bots ;
 * - la modale des paramètres : langue, style d'interface, pseudo, photo de profil, bannière.
 * L'état (profil, mode, groupe) vit dans `profile` (src/ui/lobby/profile.ts), mémorisé.
 */

export type MenuChoice = 'quickplay' | 'practice' | 'deathmatch';

const MODE_KEYS: Record<ModeId, { name: TKey; desc: TKey; tag: TKey }> = {
  quickplay: { name: 'menu.quickplay', desc: 'menu.quickplay.desc', tag: 'lobby.tag.quickplay' },
  deathmatch: { name: 'menu.deathmatch', desc: 'menu.deathmatch.desc', tag: 'lobby.tag.deathmatch' },
  practice: { name: 'menu.practice', desc: 'menu.practice.desc', tag: 'lobby.tag.practice' },
  ranked: { name: 'lobby.ranked', desc: 'lobby.ranked.desc', tag: 'lobby.tag.ranked' },
};

const THEME_NAMES: Record<ThemeId, TKey> = {
  greece: 'lobby.theme.greece',
  night: 'lobby.theme.night',
  myth: 'lobby.theme.myth',
  esport: 'lobby.theme.esport',
};

const LOCK = '<svg class="lb-lock" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>';
const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.3-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/></svg>';
const INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"/></svg>';

export class MainMenu extends Screen {
  private settingsOpen = false;
  private drawerOpen = false;
  private enterTimer = 0;
  /** L'entrée animée n'a lieu qu'au premier affichage (pas à chaque retour au menu). */
  private entered = false;
  /** Un panneau vient de s'ouvrir : le focus va à son premier élément utile. */
  private justOpened = false;

  constructor(
    parent: HTMLElement,
    private readonly onChoose: (choice: MenuChoice) => void,
  ) {
    super(parent, 'main-menu');
    profile.subscribe(() => {
      if (this.visible) this.render();
    });
    onThemeChange(() => {
      if (this.visible) this.render();
    });
    // Pseudo : enregistré à la validation du champ (pas à chaque touche : le menu se redessine).
    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'lb-name') profile.set({ name: el.value.trim().slice(0, 16) });
    });
    // Clic sur le fond de la modale ou du tiroir : fermeture.
    this.root.addEventListener('pointerdown', (e) => {
      const el = e.target as HTMLElement;
      if (el.classList.contains('lb-scrim')) this.closePanels();
    });
    // Tab reste dans le panneau ouvert (modale ou tiroir).
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const panel = this.root.querySelector<HTMLElement>('.lb-modal, .lb-drawer');
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"]), input')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      } else if (!panel.contains(document.activeElement)) {
        first.focus();
        e.preventDefault();
      }
    });
  }

  override show(): void {
    this.settingsOpen = this.drawerOpen = false;
    // Entrée animée au tout premier affichage seulement : revenir au menu est instantané.
    if (!this.entered) {
      this.entered = true;
      this.root.classList.add('is-entering');
      window.clearTimeout(this.enterTimer);
      this.enterTimer = window.setTimeout(() => this.root.classList.remove('is-entering'), 1300);
    }
    super.show();
  }

  /**
   * Rendu sans la bascule de langue générique (elle est dans les paramètres). Mise à jour en place :
   * un clic (mode, avatar, bot…) ne modifie que ce qui change, sans rejouer les apparitions.
   */
  protected override render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
    morph(this.root, `<div class="screen-inner">${this.html()}</div>`);
    const opened = this.justOpened
      ? this.root.querySelector<HTMLElement>('.lb-modal [data-autofocus], .lb-drawer [data-autofocus], .lb-drawer .lb-launch')
      : null;
    this.justOpened = false;
    const target = opened ?? (focusKey ? this.root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) : null);
    target?.focus({ preventScroll: true });
  }

  protected html(): string {
    const s = profile.get();
    const kit = KITS[getTheme()];
    return `
      <div class="lobby">
        <div class="lb-decor" aria-hidden="true">${kit.decor()}</div>
        ${this.topBar()}
        <main class="lb-main">
          <div class="lb-party-head">
            <h1 class="lb-title">${t('lobby.party')}</h1>
            <span class="lb-count">${1 + s.party.filter(Boolean).length}/${PARTY_SIZE}</span>
          </div>
          <ol class="lb-party">${this.partyCards()}</ol>
        </main>
        ${this.bottomBar()}
        ${this.drawerOpen ? this.drawer() : ''}
        ${this.settingsOpen ? this.settings() : ''}
      </div>`;
  }

  // ------------------------------------------------------------------ barre du haut

  private topBar(): string {
    const kit = KITS[getTheme()];
    const locked = (key: TKey) => `
      <span class="lb-tab is-locked" aria-disabled="true" title="${t('lobby.soon')}">
        ${LOCK}<span>${t(key)}</span><span class="lb-soon">${t('lobby.soon')}</span>
      </span>`;
    return `
      <header class="lb-top">
        <div class="lb-brand"><span class="lb-mark" aria-hidden="true">${kit.mark}</span>${t('menu.title')}</div>
        <nav class="lb-tabs" aria-label="${t('lobby.nav')}">
          <button type="button" class="lb-tab is-active" aria-current="page" data-action="home" data-key="tab-home">${t('lobby.tab.home')}</button>
          ${locked('lobby.tab.pass')}
          ${locked('lobby.tab.shop')}
        </nav>
        <button type="button" class="lb-icon-btn" data-action="settings" data-key="settings" aria-label="${t('lobby.settings')}" aria-haspopup="dialog" aria-expanded="${this.settingsOpen}">${GEAR}</button>
      </header>`;
  }

  // ------------------------------------------------------------------ groupe

  private partyCards(): string {
    const s = profile.get();
    const kit = KITS[getTheme()];
    const name = s.name || t('lobby.defaultName');
    const me = `
      <li class="lb-card is-me" style="--accent:${ART_META[s.avatar].accent}">
        <div class="lb-card-banner">${bannerSvg(s.banner, 'me')}</div>
        <span class="lb-leader">${kit.leaderIcon}${t('lobby.leader')}</span>
        <div class="lb-medal">
          <div class="lb-card-avatar">${avatarSvg(s.avatar, 'me')}</div>
          ${kit.wreath ? kit.wreath('me') : ''}
        </div>
        <div class="lb-plate">
          <strong class="lb-name">${escapeHtml(name)}</strong>
          <span class="lb-rule" aria-hidden="true"></span>
          <span class="lb-sub">${t('lobby.you')}</span>
        </div>
      </li>`;
    const others = s.party
      .map((bot, i) => {
        const num = kit.slot(i + 1);
        if (!bot) {
          return `
            <li class="lb-card is-empty">
              <button type="button" class="lb-card-btn" data-action="slot" data-slot="${i}" data-key="slot-${i}" title="${t('lobby.invite.hint')}">
                <span class="lb-slot">${num}</span>
                <span class="lb-plus" aria-hidden="true">+</span>
                <span class="lb-invite">${t('lobby.invite')}</span>
              </button>
            </li>`;
        }
        return `
          <li class="lb-card is-bot" style="--accent:${ART_META[bot].accent}">
            <div class="lb-card-banner">${bannerSvg(bot, `s${i}`)}</div>
            <span class="lb-slot">${num}</span>
            <div class="lb-medal"><div class="lb-card-avatar">${avatarSvg(bot, `s${i}`)}</div></div>
            <div class="lb-plate">
              <strong class="lb-name">${ART_META[bot].name}</strong>
              <span class="lb-rule" aria-hidden="true"></span>
              <span class="lb-sub">${t('lobby.bot')}</span>
            </div>
            <button type="button" class="lb-remove" data-action="slot" data-slot="${i}" data-key="slot-${i}" aria-label="${t('lobby.remove', { name: ART_META[bot].name })}">${CLOSE}</button>
          </li>`;
      })
      .join('');
    return me + others;
  }

  // ------------------------------------------------------------------ bas : jouer

  private bottomBar(): string {
    const s = profile.get();
    return `
      <footer class="lb-bottom">
        <div class="lb-play">
          <button type="button" class="lb-play-btn" data-action="drawer" data-key="play" aria-haspopup="dialog" aria-expanded="${this.drawerOpen}">
            <span class="lb-play-main">${t('lobby.play')}</span>
            <span class="lb-play-sub">${t(MODE_KEYS[s.mode].name)}</span>
          </button>
          <div class="lb-info">
            <button type="button" class="lb-info-btn" aria-describedby="lb-note" data-key="info" aria-label="${t('lobby.notice.title')}">${INFO}</button>
            <p class="lb-tip" id="lb-note" role="tooltip">${t('lobby.notice')}</p>
          </div>
        </div>
        <p class="lb-foot">${t('lobby.version')}</p>
      </footer>`;
  }

  private drawer(): string {
    const s = profile.get();
    const icons = KITS[getTheme()].modeIcons;
    const cards = MODES.map((m, i) => {
      const k = MODE_KEYS[m];
      const playable = PLAYABLE.includes(m);
      const sel = s.mode === m;
      return `
        <li>
          <button type="button" class="lb-mode${sel ? ' is-selected' : ''}${playable ? '' : ' is-locked'}" data-action="mode" data-mode="${m}" data-key="mode-${m}"
            ${playable ? `aria-pressed="${sel}"` : 'aria-disabled="true"'} ${sel ? 'data-autofocus' : ''}>
            <svg class="lb-mode-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${icons[m]}</svg>
            <span class="lb-mode-text">
              <span class="lb-mode-name">${t(k.name)}${playable ? `<kbd>${i + 1}</kbd>` : ''}</span>
              <span class="lb-mode-desc">${t(k.desc)}</span>
            </span>
            <span class="lb-mode-tag">${playable ? '' : LOCK}${t(k.tag)}</span>
          </button>
        </li>`;
    }).join('');
    return `
      <div class="lb-scrim lb-scrim--drawer"></div>
      <section class="lb-drawer" role="dialog" aria-modal="true" aria-labelledby="lb-drawer-title">
        <header class="lb-panel-head">
          <h2 id="lb-drawer-title">${t('lobby.modes')}</h2>
          <button type="button" class="lb-close" data-action="close" data-key="close-drawer" aria-label="${t('lobby.close')}">${CLOSE}</button>
        </header>
        <ul class="lb-modes">${cards}</ul>
        <p class="lb-note">${INFO}<span>${t('lobby.notice')}</span></p>
        <button type="button" class="lb-launch" data-action="launch" data-key="launch">${t('lobby.launch', { mode: t(MODE_KEYS[s.mode].name) })}</button>
      </section>`;
  }

  // ------------------------------------------------------------------ paramètres

  private settings(): string {
    const s = profile.get();
    const langs = LANGS.map(
      (l) =>
        `<button type="button" data-action="lang" data-lang-choice="${l}" data-key="lang-${l}" aria-pressed="${s.lang === l}">${l === 'fr' ? 'Français' : 'English'} <small>${l.toUpperCase()}</small></button>`,
    ).join('');
    const themes = THEMES.map(
      (id) =>
        `<button type="button" data-action="theme" data-theme-choice="${id}" data-key="theme-${id}" aria-pressed="${getTheme() === id}">${t(THEME_NAMES[id])}</button>`,
    ).join('');
    const avatars = ART_IDS.map(
      (a) => `
        <button type="button" class="lb-pick lb-pick--avatar" data-action="avatar" data-art="${a}" data-key="avatar-${a}" aria-pressed="${s.avatar === a}" aria-label="${ART_META[a].name}">
          ${avatarSvg(a, `pick-${a}`)}<span>${ART_META[a].name}</span>
        </button>`,
    ).join('');
    const banners = ART_IDS.map(
      (a) => `
        <button type="button" class="lb-pick lb-pick--banner" data-action="banner" data-art="${a}" data-key="banner-${a}" aria-pressed="${s.banner === a}" aria-label="${ART_META[a].name}">
          ${bannerSvg(a, `pick-${a}`)}<span>${ART_META[a].name}</span>
        </button>`,
    ).join('');
    return `
      <div class="lb-scrim lb-scrim--modal"></div>
      <section class="lb-modal" role="dialog" aria-modal="true" aria-labelledby="lb-settings-title">
        <header class="lb-panel-head">
          <h2 id="lb-settings-title">${t('lobby.settings')}</h2>
          <button type="button" class="lb-close" data-action="close" data-key="close-settings" aria-label="${t('lobby.close')}">${CLOSE}</button>
        </header>
        <div class="lb-modal-body">
          <section class="lb-set">
            <h3>${t('lobby.lang')}</h3>
            <div class="lb-seg" role="group" aria-label="${t('lobby.lang')}">${langs}</div>
          </section>
          <section class="lb-set">
            ${
              THEMES.length > 1
                ? `<h3>${t('lobby.theme')}</h3>
            <div class="lb-seg lb-seg--wrap" role="group" aria-label="${t('lobby.theme')}">${themes}</div>`
                : ''
            }
            <label class="lb-field">
              <span>${t('lobby.name')}</span>
              <input name="lb-name" type="text" maxlength="16" autocomplete="nickname" spellcheck="false"
                value="${escapeHtml(s.name)}" placeholder="${t('lobby.defaultName')}" data-key="name" data-autofocus>
            </label>
          </section>
          <section class="lb-set">
            <h3>${t('lobby.avatar')}</h3>
            <div class="lb-picks lb-picks--avatar">${avatars}</div>
          </section>
          <section class="lb-set">
            <h3>${t('lobby.banner')}</h3>
            <div class="lb-picks lb-picks--banner">${banners}</div>
          </section>
        </div>
      </section>`;
  }

  // ------------------------------------------------------------------ actions

  private closePanels(): void {
    if (!this.settingsOpen && !this.drawerOpen) return;
    const back = this.settingsOpen ? 'settings' : 'play';
    this.settingsOpen = this.drawerOpen = false;
    this.render();
    this.root.querySelector<HTMLElement>(`[data-key="${back}"]`)?.focus({ preventScroll: true });
  }

  private launch(): void {
    const m = profile.get().mode;
    if (m === 'ranked') return;
    this.drawerOpen = false;
    this.onChoose(m);
  }

  protected override onAction(action: string, el: HTMLElement): void {
    switch (action) {
      case 'home':
        return;
      case 'settings':
        this.drawerOpen = false;
        this.settingsOpen = true;
        this.justOpened = true;
        this.render();
        return;
      case 'drawer':
        this.settingsOpen = false;
        this.drawerOpen = true;
        this.justOpened = true;
        this.render();
        return;
      case 'close':
        this.closePanels();
        return;
      case 'mode': {
        const m = el.dataset.mode as ModeId;
        if (!PLAYABLE.includes(m)) return;
        if (profile.get().mode === m) this.launch(); // second clic sur le mode choisi : on joue
        else profile.set({ mode: m });
        return;
      }
      case 'launch':
        this.launch();
        return;
      case 'slot':
        profile.toggleBot(Number(el.dataset.slot));
        return;
      case 'lang':
        profile.setLang(el.dataset.langChoice === 'en' ? 'en' : 'fr');
        return;
      case 'theme':
        setTheme(el.dataset.themeChoice as ThemeId);
        return;
      case 'avatar':
        profile.set({ avatar: el.dataset.art as ArtId });
        return;
      case 'banner':
        profile.set({ banner: el.dataset.art as ArtId });
        return;
    }
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLInputElement) return false; // on tape son pseudo
    if (e.code === 'Escape') {
      if (!this.settingsOpen && !this.drawerOpen) return false;
      this.closePanels();
      return true;
    }
    const d = digitOf(e);
    if (d !== null && d <= PLAYABLE.length && !this.settingsOpen) {
      // 1-3 : choisit le mode (et ouvre le tiroir pour le montrer) ; Entrée : joue
      profile.set({ mode: PLAYABLE[d - 1] });
      if (!this.drawerOpen) {
        this.drawerOpen = true;
        this.justOpened = true;
        this.render();
      }
      return true;
    }
    if (this.drawerOpen && (e.code === 'Enter' || e.code === 'NumpadEnter') && !(e.target instanceof HTMLButtonElement)) {
      this.launch();
      return true;
    }
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
