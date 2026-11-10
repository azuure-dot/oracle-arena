import type { ThemeId } from '../theme';
import {
  BOLT,
  HELMET,
  LAUREL_ICON,
  MYTH_MODE_ICONS,
  OLIVE_ICON,
  ROMAN,
  greeceDecor,
  greeceNightDecor,
  laurelWreath,
  oliveWreath,
  skySvg,
} from './ornaments';
import type { ModeId } from './profile';

/**
 * Ce qui change dans le HTML du menu principal selon le style d'interface
 * (le reste est porté par la feuille de style du thème, src/ui/themes/*.css).
 */
export interface LobbyKit {
  /** Contenu de la pastille devant « Hero Shooter ». */
  mark: string;
  /** Icône du badge « Chef ». */
  leaderIcon: string;
  /** Libellé de la place `i` du groupe (0 = le joueur). */
  slot(i: number): string;
  /** Icônes des modes de jeu (contenu d'un SVG 24×24). */
  modeIcons: Record<ModeId, string>;
  /** Décor de fond (SVG), calculé une fois. */
  decor: () => string;
  /** Couronne autour de l'avatar du chef, s'il y en a une. */
  wreath?: (uid: string) => string;
}

const ESPORT_ICONS: Record<ModeId, string> = {
  quickplay:
    '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2.6"/><path d="M12 6.5 17.5 12 12 17.5 6.5 12Z"/>',
  deathmatch:
    '<path d="M4 3l7 7-2 2-7-7V3h2Zm16 0h2v2l-7 7-2-2 7-7ZM3 19l5-5 2 2-5 5H3v-2Zm18 0v2h-2l-5-5 2-2 5 5Z"/>',
  practice:
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/>',
  ranked: '<path d="M12 2 4 5.5v6C4 16.5 7.4 20.6 12 22c4.6-1.4 8-5.5 8-10.5v-6L12 2Zm0 5 1.8 3.7 4 .6-2.9 2.8.7 4L12 16.2 8.4 18.1l.7-4-2.9-2.8 4-.6L12 7Z"/>',
};
const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"/></svg>';

/** Le décor n'est calculé qu'à la première demande. */
function once(make: () => string): () => string {
  let v: string | null = null;
  return () => (v ??= make());
}

export const KITS: Record<ThemeId, LobbyKit> = {
  greece: {
    mark: HELMET,
    leaderIcon: OLIVE_ICON,
    slot: (i) => String(i + 1),
    modeIcons: MYTH_MODE_ICONS,
    decor: once(greeceDecor),
    wreath: oliveWreath,
  },
  night: {
    mark: HELMET,
    leaderIcon: OLIVE_ICON,
    slot: (i) => String(i + 1),
    modeIcons: MYTH_MODE_ICONS,
    decor: once(greeceNightDecor),
    wreath: oliveWreath,
  },
  myth: {
    mark: BOLT,
    leaderIcon: LAUREL_ICON,
    slot: (i) => ROMAN[i],
    modeIcons: MYTH_MODE_ICONS,
    decor: once(skySvg),
    wreath: laurelWreath,
  },
  esport: {
    mark: '',
    leaderIcon: CROWN,
    slot: (i) => String(i + 1).padStart(2, '0'),
    modeIcons: ESPORT_ICONS,
    decor: () => '',
  },
};
