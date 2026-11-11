import { LANGS, t, type TKey } from '../../i18n';
import { THEMES, getTheme, setTheme, type ThemeId } from '../theme';
import { ART_IDS, ART_META, avatarSvg, bannerSvg, type ArtId } from './art';
import { profile } from './profile';

/**
 * PANNEAU « PARAMÈTRES » (langue, thème, pseudo, photo de profil, bannière), partagé par le menu
 * principal et le menu Échap en jeu (« Options ») : même HTML, mêmes actions, même style.
 * L'écran qui l'affiche délègue ses clics à `settingsAction` et branche `bindSettingsInputs`.
 */

const THEME_NAMES: Record<ThemeId, TKey> = {
  greece: 'lobby.theme.greece',
  night: 'lobby.theme.night',
  myth: 'lobby.theme.myth',
  esport: 'lobby.theme.esport',
};

export const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"/></svg>';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** La modale des paramètres (fond assombri + panneau). Le bouton de fermeture a `data-action="close"`. */
export function settingsModal(): string {
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
        <button type="button" class="lb-close" data-action="close" data-key="close-settings" aria-label="${t('lobby.close')}">${CLOSE_ICON}</button>
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

/** Actions du panneau (langue, thème, avatar, bannière). Retourne true si l'action était à lui. */
export function settingsAction(action: string, el: HTMLElement): boolean {
  switch (action) {
    case 'lang':
      profile.setLang(el.dataset.langChoice === 'en' ? 'en' : 'fr');
      return true;
    case 'theme':
      setTheme(el.dataset.themeChoice as ThemeId);
      return true;
    case 'avatar':
      profile.set({ avatar: el.dataset.art as ArtId });
      return true;
    case 'banner':
      profile.set({ banner: el.dataset.art as ArtId });
      return true;
  }
  return false;
}

/** Pseudo : enregistré à la validation du champ (pas à chaque touche : l'écran se redessine). */
export function bindSettingsInputs(root: HTMLElement): void {
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.name === 'lb-name') profile.set({ name: el.value.trim().slice(0, 16) });
  });
}
