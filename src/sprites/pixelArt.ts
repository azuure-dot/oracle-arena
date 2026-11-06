/**
 * Outils de pixel art "en texte".
 *
 * Un sprite est une grille de caractères : chaque lettre = une couleur de la palette,
 * '.' = transparent. Les lignes sont encadrées par des '|' pour que les erreurs de
 * largeur sautent aux yeux dans le code :
 *
 *   grid(`
 *     |..hhhh..|
 *     |.hsssh..|
 *   `)
 *
 * Le contour (1 px) est ajouté automatiquement autour des pixels opaques :
 * on ne dessine jamais les contours à la main, et on peut les colorer par équipe.
 */

export type Grid = readonly string[];
export type Palette = Readonly<Record<string, string>>;

/** Lit une grille encadrée par des '|' et vérifie que toutes les lignes ont la même largeur. */
export function grid(src: string, name = 'sprite'): Grid {
  const rows = src
    .split('\n')
    .filter((l) => l.includes('|'))
    .map((l) => {
      const a = l.indexOf('|');
      const b = l.lastIndexOf('|');
      return l.slice(a + 1, b);
    });
  const w = rows[0]?.length ?? 0;
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`[${name}] ligne ${i} : largeur ${r.length} au lieu de ${w} → "${r}"`);
  });
  return rows;
}

export const mirrorRow = (row: string): string => [...row].reverse().join('');
export const mirrorGrid = (g: Grid): Grid => g.map(mirrorRow);

export interface RenderOptions {
  /** Couleur du contour auto (null = pas de contour). */
  outline: string | null;
  /** Si défini : silhouette unie de cette couleur (flash de dégâts, Rappel...). */
  silhouette?: string;
}

/** Transforme une grille en petit canvas (1 pixel de grille = 1 pixel de canvas). */
export function renderGrid(rows: Grid, palette: Palette, opts: RenderOptions, name = 'sprite'): HTMLCanvasElement {
  const pad = opts.outline ? 1 : 0;
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const W = w + pad * 2;
  const H = h + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);

  const opaque = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
  const put = (x: number, y: number, hex: string) => {
    const [r, gg, b] = hexToRgb(hex);
    const i = (y * W + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = gg;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const color = opts.silhouette ?? palette[ch];
      if (!color) throw new Error(`[${name}] couleur inconnue '${ch}' (ligne ${y}, colonne ${x})`);
      put(x + pad, y + pad, color);
    }
  }

  if (opts.outline) {
    const outline = opts.silhouette ?? opts.outline;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (opaque(x, y)) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
          put(x + pad, y + pad, outline);
        }
      }
    }
  }

  g.putImageData(img, 0, 0);
  return canvas;
}

const rgbCache = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const v = hex.replace('#', '');
    const full = v.length === 3 ? [...v].map((x) => x + x).join('') : v;
    c = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    rgbCache.set(hex, c);
  }
  return c;
}
