import greeceCss from './themes/greece.css?inline';
import nightCss from './themes/greece-night.css?inline';

/**
 * Thème des menus, au choix dans les Paramètres (« Thème » : Jour / Nuit) et mémorisé :
 * - « greece » (Jour) : Grèce antique au soleil — marbre, blanc et or, temple ; par défaut ;
 * - « night » (Nuit) : la même Grèce antique au clair de lune — marbre sombre, bleu nuit, or,
 *   ciel étoilé et lune ; c'est greece.css + greece-night.css (les couleurs seulement).
 *
 * Deux autres styles complets restent dans le dépôt, hors du jeu (ni chargés, ni proposés) :
 * - src/ui/themes/myth.css : mythologique (nuit étoilée, or, constellations ; police Cinzel) ;
 * - src/ui/themes/esport.css : e-sport (sombre, néon, coins biseautés ; police Chakra Petch).
 * Pour en remettre un : l'importer ici en `?inline`, l'ajouter à CSS et à THEMES, et réinstaller
 * sa police (`@fontsource/cinzel` ou `@fontsource/chakra-petch`, importée dans src/main.ts).
 * Il apparaît alors tout seul dans le choix « Thème » des Paramètres (mémorisé).
 */

export type ThemeId = 'greece' | 'night' | 'myth' | 'esport';

const CSS: Partial<Record<ThemeId, string>> = { greece: greeceCss, night: `${greeceCss}\n${nightCss}` };
/** Styles proposés au joueur (le premier est le style par défaut). */
export const THEMES = Object.keys(CSS) as ThemeId[];

const STORAGE_KEY = 'hero-shooter.theme';
const listeners = new Set<(id: ThemeId) => void>();

function load(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return v && THEMES.includes(v) ? v : THEMES[0];
  } catch {
    return THEMES[0];
  }
}

let current: ThemeId = load();

export function getTheme(): ThemeId {
  return current;
}

/** Pose la feuille du style courant (à appeler une fois au démarrage). */
export function applyTheme(): void {
  let el = document.getElementById('ui-theme') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'ui-theme';
    document.head.appendChild(el);
  }
  el.textContent = CSS[current] ?? '';
  document.documentElement.dataset.theme = current;
  void bakeVeins(current);
}

/** Veines du marbre déjà converties en image, par source SVG. */
const bakedVeins = new Map<string, string>();

/**
 * Les veines du marbre (`--g-veins`) sont un SVG à filtre de bruit : joli mais coûteux à
 * redessiner à chaque fois qu'un écran s'affiche. On le dessine UNE fois dans une image (PNG
 * en mémoire) que le navigateur affiche ensuite comme une simple texture. En cas d'échec, le
 * SVG d'origine reste utilisé : seul le coût change, pas l'apparence.
 */
async function bakeVeins(theme: ThemeId): Promise<void> {
  const root = document.documentElement;
  root.style.removeProperty('--g-veins');
  const raw = getComputedStyle(root).getPropertyValue('--g-veins').trim();
  const src = /^url\(["']?(data:image\/svg\+xml,.+?)["']?\)$/s.exec(raw)?.[1];
  if (!src) return;
  try {
    let url = bakedVeins.get(src);
    if (!url) {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 700;
      canvas.height = img.naturalHeight || 700;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
      if (!blob) return;
      url = URL.createObjectURL(blob);
      bakedVeins.set(src, url);
    }
    if (theme === current) root.style.setProperty('--g-veins', `url("${url}")`);
  } catch {
    /* image non convertible : on garde le SVG */
  }
}

export function setTheme(id: ThemeId): void {
  if (id === current || !THEMES.includes(id)) return;
  current = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* stockage indisponible : le choix vaut pour cette session */
  }
  applyTheme();
  listeners.forEach((cb) => cb(id));
}

export function onThemeChange(cb: (id: ThemeId) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
