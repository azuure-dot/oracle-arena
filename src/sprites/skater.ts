import { TAU } from '../core/math';
import { grid, mirrorGrid, type Grid } from './pixelArt';
import { propImage } from './SpriteRenderer';
import { SKATER_SHEET as S, SKATER_SHEET_PALETTE } from './skaterSheet';

/**
 * SPRITES DU SKATER — les poses viennent telles quelles de la planche du joueur
 * (concept/skater-sheet.png → src/sprites/skaterSheet.ts, via tools/extract_skater.py).
 *
 * La planche contient 12 poses sur le skate et 12 à pied. On les range ici en
 * 8 directions × 2 images (A/B) ; une direction absente de la planche est le
 * miroir de la direction opposée. Pour changer une pose : modifier le numéro ici.
 *
 * Les accessoires animés par le jeu (planche qui tourne pendant un trick, planche
 * brandie pendant les coups, équipement lancé) sont dessinés dans le même style :
 * mêmes couleurs, contour noir.
 */

export const SKATER_PALETTE = SKATER_SHEET_PALETTE;

/** 8 directions, dans l'ordre des angles : 0 = droite, puis sens horaire (y vers le bas). */
export type Dir8 = 'right' | 'downRight' | 'down' | 'downLeft' | 'left' | 'upLeft' | 'up' | 'upRight';
const DIRS: Dir8[] = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'];

export function dir8(angle: number): Dir8 {
  const a = ((angle % TAU) + TAU) % TAU;
  return DIRS[Math.round(a / (TAU / 8)) % 8];
}

/**
 * Une pose : numéro dans la planche (ou nom d'une pose retouchée, voir CUSTOM)
 * + miroir horizontal éventuel.
 */
type Pose = readonly [index: number | CustomPose, mirrored?: boolean];

/**
 * Sur la planche : 2 images par direction. Le Skater est GOOFY partout (pied droit devant).
 * La planche le dessine regardant vers où il va ; on lit son pied avant ainsi :
 * de face, sa jambe droite est à gauche de l'écran ; de dos, à droite ; de profil,
 * c'est la jambe la plus proche (plus claire) quand il va à droite, la plus lointaine
 * quand il va à gauche. Un miroir change goofy en regular : les poses retournées
 * sont donc retouchées (voir CUSTOM).
 */
const RIDE: Record<Dir8, readonly [Pose, Pose]> = {
  down: [['downA'], ['downB']],
  downRight: [['downRightA'], ['downRightB']],
  right: [[2], [10]],
  upRight: [[3], [5]],
  up: [['upA'], ['upB']],
  upLeft: [['upLeftA'], ['upLeftB']],
  left: [['leftA'], ['leftB']],
  downLeft: [[7], ['downLeftB']],
};

/**
 * À pied, planche à la main (juste après les coups) : 2 images par direction.
 * Dans la planche, les poses 22-23 (profil) regardent à droite et les poses 13 et 19
 * (trois quarts) vers le bas à gauche : on les retourne pour l'autre côté.
 */
const FOOT: Record<Dir8, readonly [Pose, Pose]> = {
  down: [[12], [18]],
  downRight: [[13, true], [19, true]],
  right: [[22], [23]],
  upRight: [[16], [21, true]],
  up: [[15], [21]],
  upLeft: [[16, true], [21]],
  left: [[22, true], [23, true]],
  downLeft: [[13], [19]],
};

/**
 * Corps sans la planche (sauts, coups) : poses de face / dos / profil dont on retire
 * la planche (lignes du bas), seuls les pieds restent.
 */
const BODY: Record<Dir8, Pose> = {
  down: [0],
  downRight: [0],
  right: [2],
  upRight: [4],
  up: [4],
  upLeft: [4, true], // la pose de dos est tournée vers le haut à droite
  left: [2, true],
  downLeft: [0],
};

// ------------------------------------------------------------------ poses retouchées

/** Superpose des calques (lignes de texte, '.' = transparent) sur une grille, agrandie si besoin. */
function paint(base: Grid, w: number, h: number, layers: [row: number, col: number, lines: string[]][]): Grid {
  const c = Array.from({ length: h }, (_, y) => [...(base[y] ?? '').padEnd(w, '.')].slice(0, w));
  for (const [row, col, lines] of layers)
    lines.forEach((line, dy) =>
      [...line].forEach((ch, dx) => {
        if (ch !== '.' && c[row + dy] && col + dx < w) c[row + dy][col + dx] = ch;
      }),
    );
  const rows = c.map((r) => r.join(''));
  while (rows.length && !/[^.]/.test(rows[rows.length - 1])) rows.pop();
  return rows;
}

/** Remplace la tête (lignes 0..rows-1) d'une pose par celle d'une autre, décalée de `shift` colonnes. */
function withHead(body: Grid, head: Grid, rows: number, shift: number): Grid {
  const w = body[0].length;
  const top = head.slice(0, rows).map((r) => {
    const out: string[] = [];
    for (let x = 0; x < w; x++) out.push(r[x - shift] ?? '.');
    return out.join('');
  });
  return [...top, ...body.slice(rows)];
}

/** Décale une grille de `off` colonnes dans une largeur `w`. */
function shiftRows(g: Grid, w: number, off: number): string[] {
  return g.map((r) => {
    let out = '';
    for (let x = 0; x < w; x++) out += r[x - off] ?? '.';
    return out;
  });
}

/** Haut du corps d'une pose (lignes 0..split-1) sur les jambes et la planche d'une autre. */
function compose(upper: Grid, lower: Grid, split: number, upperShift = 0): Grid {
  const w = Math.max(upper[0].length + Math.max(0, upperShift), lower[0].length);
  return [...shiftRows(upper.slice(0, split), w, upperShift), ...shiftRows(lower.slice(split), w, 0)];
}

/** Jambes : clair ↔ foncé (la jambe proche devient la lointaine et inversement). */
const LEG_SWAP: Record<string, string> = { q: 'k', k: 'q', t: 'n', n: 't' };
function swapLegs(g: Grid, fromRow: number): Grid {
  return g.map((r, y) => (y < fromRow ? r : [...r].map((ch) => LEG_SWAP[ch] ?? ch).join('')));
}

/** Image B : le haut du corps descend d'un pixel (genoux fléchis), pieds et planche en place. */
function crouch(g: Grid, legRow: number): Grid {
  return ['.'.repeat(g[0].length), ...g.slice(0, legRow), ...g.slice(legRow + 1)];
}

/** Planche vue de dessus, pointée vers le haut ou le bas de l'écran (8 de large). */
const BOARD_V: string[] = [
  '.aaaaaa.',
  'agggggga',
  'agxggxga',
  ...Array<string>(6).fill('agggggga'),
  'agxggxga',
  'agggggga',
  'agggggga',
  'avvvvvva',
  '.aaaaaa.',
];
const WHEEL = ['aaa', 'aCa', 'aaa'];
/** Chaussure vue de face (pointe blanche) / de dos (talon). */
const SHOE_FRONT = ['adcna', 'acdca', 'aIHIa', 'aaaaa'];
const SHOE_BACK = ['ahdca', 'acdca', 'aIIIa', 'aaaaa'];
type Layer = [row: number, col: number, lines: string[]];
/** Une jambe : une ligne par rangée, à la colonne donnée. */
const leg = (path: [number, number][], lines: string[]): Layer[] => path.map(([r, c], i): Layer => [r, c, [lines[i]]]);

/**
 * Vers le bas, de face (poses 0 / 6) : planche pointée vers la caméra, pieds l'un
 * derrière l'autre dessus. Goofy : pied droit devant (le plus bas) ; de face, sa
 * jambe droite est à gauche de l'écran, dessinée par-dessus l'autre.
 */
function rideDown(pose: number): Grid {
  return paint(S[pose].slice(0, 24), 20, 42, [
    [26, 6, BOARD_V],
    [28, 4, WHEEL],
    [28, 13, WHEEL],
    [35, 4, WHEEL],
    [35, 13, WHEEL],
    // jambe gauche (à droite de l'écran) : pied arrière, plus haut
    ...leg(
      [[24, 10], [25, 11], [26, 11], [27, 10]],
      ['aqtta', 'atqqa', 'aqqta', 'aqqqa'],
    ),
    [28, 10, SHOE_FRONT],
    // jambe droite (à gauche de l'écran) : pied avant, plus bas
    ...leg(
      [[24, 4], [25, 4], [26, 5], [27, 5], [28, 5], [29, 6], [30, 6], [31, 6]],
      ['ahtqa', 'aqtqa', 'aqqta', 'atqqa', 'aqqqa', 'aqtqa', 'akqqa', 'aqqka'],
    ),
    [32, 6, SHOE_FRONT],
  ]);
}

/**
 * Vers le haut, de dos (pose 4) : planche pointée droit vers le haut (celle de la
 * feuille partait en diagonale, comme vers le haut à droite).
 * Goofy : pied droit devant (le plus haut) ; de dos, sa jambe droite est à droite de l'écran.
 */
function rideUp(): Grid {
  return paint(S[4].slice(0, 24), 18, 42, [
    [26, 5, BOARD_V],
    [28, 3, WHEEL],
    [28, 12, WHEEL],
    [35, 3, WHEEL],
    [35, 12, WHEEL],
    // jambe droite (à droite de l'écran, la plus loin) : pied avant, plus haut
    ...leg(
      [[24, 9], [25, 10], [26, 10], [27, 9]],
      ['aqqna', 'aqqna', 'aqqqa', 'akqqa'],
    ),
    [28, 9, SHOE_BACK],
    // jambe gauche (côté caméra) : pied arrière, plus bas, par-dessus l'autre
    ...leg(
      [[24, 4], [25, 4], [26, 4], [27, 5], [28, 5], [29, 5], [30, 5], [31, 5], [32, 5]],
      ['atqqa', 'atqqa', 'aqtqa', 'aqqqa', 'atqqa', 'aqqqa', 'aqtqa', 'akqqa', 'aqqka'],
    ),
    [33, 5, SHOE_BACK],
  ]);
}

/** Bas-droite de la feuille (corps de la pose 8, tête de la pose 10) : sert au bas-gauche, en miroir. */
const sheetDownRight = () => withHead(S[8], S[10], 11, -1);

/**
 * Poses retouchées (toutes goofy) :
 *  - downA/B : de face, planche pointée vers le bas, pieds l'un derrière l'autre.
 *  - upA/B : de dos, planche pointée droit vers le haut.
 *  - leftA/B : profil droit retourné, jambes échangées (la jambe lointaine devant).
 *  - downRightA/B : profil droit (poses 2 / 10) sur les jambes et la planche en
 *    diagonale du bas-gauche retourné (pose 7) / du bas-droite de la feuille.
 *  - upLeftA/B : profil gauche sur les jambes du haut-droite retourné (poses 3 / 5),
 *    jambes échangées.
 *  - downLeftB : bas-droite de la feuille retourné.
 */
type CustomPose =
  | 'downA'
  | 'downB'
  | 'upA'
  | 'upB'
  | 'leftA'
  | 'leftB'
  | 'downRightA'
  | 'downRightB'
  | 'upLeftA'
  | 'upLeftB'
  | 'downLeftB';
/** Première ligne des jambes dans les poses de la feuille. */
const LEGS = 21;
const CUSTOM: Record<CustomPose, () => Grid> = {
  downA: () => rideDown(0),
  downB: () => crouch(rideDown(6), 25),
  upA: () => rideUp(),
  upB: () => crouch(rideUp(), 25),
  leftA: () => swapLegs(mirrorGrid(S[2]), LEGS),
  leftB: () => swapLegs(mirrorGrid(S[10]), LEGS),
  downRightA: () => compose(S[2], mirrorGrid(S[7]), LEGS, 1),
  downRightB: () => compose(S[10], sheetDownRight(), LEGS),
  upLeftA: () => swapLegs(compose(mirrorGrid(S[2]), mirrorGrid(S[3]), LEGS, -1), LEGS),
  upLeftB: () => swapLegs(compose(mirrorGrid(S[10]), mirrorGrid(S[5]), LEGS, -1), LEGS),
  downLeftB: () => mirrorGrid(sheetDownRight()),
};
/** Pose de la feuille dont le corps est repris tel quel (garde le corps à la même hauteur). */
const CUSTOM_BODY: Partial<Record<CustomPose, number>> = { downA: 0, downB: 6, upA: 4, upB: 4 };

/** Couleurs des chaussures (et du contour noir qui les borde) gardées quand on retire la planche. */
const SHOE = new Set(['b', 'c', 'd', 'e', 'G', 'H', 'I']);

/** Retire la planche d'une pose « sur le skate » : sous le haut du plateau, on ne garde que les pieds. */
function stripBoard(g: Grid): Grid {
  // Haut du plateau : première ligne (dans le tiers bas) avec au moins 3 pixels de grip (g).
  let deck = g.length;
  for (let y = Math.floor(g.length * 0.66); y < g.length; y++) {
    if ([...g[y]].filter((ch) => ch === 'g').length >= 3) {
      deck = y;
      break;
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < g.length; y++) {
    if (y < deck) {
      rows.push(g[y]);
      continue;
    }
    const row = [...g[y]].map((ch, x) => {
      if (SHOE.has(ch)) return ch;
      const near = [g[y][x - 1], g[y][x + 1], g[y - 1]?.[x]].some((n) => n !== undefined && SHOE.has(n));
      return ch === 'a' && near ? 'a' : '.';
    });
    rows.push(row.join(''));
  }
  while (rows.length && !/[^.]/.test(rows[rows.length - 1])) rows.pop();
  return rows;
}

// ------------------------------------------------------------------ images

export interface SkaterFrame {
  img: HTMLCanvasElement;
  /** Centre du torse (colonne, contour inclus) : aligne les poses de largeurs différentes. */
  anchorX: number;
  /** Hauteur de l'image (pixels de sprite, contour inclus). */
  rows: number;
  /** Pose « swing » : épaules (pixels de l'image, contour inclus). */
  shoulders: { x: number; y: number }[];
  /**
   * Pixels qui dépassent sous la ligne de sol habituelle (planche de face, nez vers le bas) :
   * l'image descend d'autant pour que le corps reste à la même hauteur.
   */
  drop: number;
}

/** Colonne moyenne du t-shirt (d) dans la moitié haute : centre du corps. */
function torsoCenter(g: Grid): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(g.length * 0.3); y < g.length * 0.65; y++)
    for (let x = 0; x < g[y].length; x++)
      if (g[y][x] === 'd') {
        sum += x;
        n++;
      }
  return n ? sum / n + 0.5 : g[0].length / 2;
}

/**
 * Pose 4 (de dos) sans la planche : la planche y est en diagonale, le retrait
 * automatique ne suffit pas. Haut du corps tel quel, jambes nettoyées à la main.
 */
const BACK_BODY: Grid = [
  ...S[4].slice(0, 25),
  ...grid(`
    |....aqqqawaqqqa...|
    |....aqqqawaqqta...|
    |....aqqqaaahdcIa..|
    |...atqqqa.aIIIa...|
    |...attqa..aaaa....|
    |...abcca..........|
    |...aIIIa..........|
    |...aaaaa..........|
  `, 'skater.backBody'),
];

/**
 * Pendant les coups, les bras sont redessinés par le jeu (ils tiennent la planche) :
 * on efface les bras pendants des poses « corps » (lignes, colonnes gardées).
 */
const ARMLESS: Record<number, { rows: [number, number]; keep: [number, number] }[]> = {
  0: [{ rows: [18, 22], keep: [5, 14] }],
  2: [{ rows: [16, 21], keep: [8, 99] }],
  4: [
    { rows: [16, 16], keep: [3, 99] },
    { rows: [17, 21], keep: [4, 13] },
  ],
};
/** Épaules (colonne, ligne) dans la pose d'origine (non retournée), d'où partent les bras redessinés. */
const SHOULDERS: Record<number, [number, number][]> = {
  0: [
    [3, 17],
    [16, 17],
  ],
  2: [[6, 15]],
  4: [
    [2, 16],
    [15, 16],
  ],
};

function removeArms(g: Grid, pose: number): Grid {
  const cuts = ARMLESS[pose] ?? [];
  return g.map((row, y) => {
    const cut = cuts.find((c) => y >= c.rows[0] && y <= c.rows[1]);
    if (!cut) return row;
    return [...row].map((ch, x) => (x >= cut.keep[0] && x <= cut.keep[1] ? ch : '.')).join('');
  });
}

const gridCache = new Map<string, Grid>();
function poseGrid(p: Pose, strip: boolean, armless = false): Grid {
  const key = `${p[0]}|${p[1] ? 1 : 0}|${strip ? 1 : 0}|${armless ? 1 : 0}`;
  let g = gridCache.get(key);
  if (!g) {
    const id = p[0];
    if (typeof id === 'string') g = CUSTOM[id]();
    else {
      g = S[id];
      if (strip) g = id === 4 ? BACK_BODY : stripBoard(g);
      if (armless) g = removeArms(g, id);
    }
    if (p[1]) g = mirrorGrid(g);
    gridCache.set(key, g);
  }
  return g;
}

/** ride : sur la planche · foot : à pied, planche à la main · body : sans planche · swing : sans planche ni bras. */
export type SkaterLook = 'ride' | 'foot' | 'body' | 'swing' | 'throw';

/**
 * Lancer d'équipement (clic D), sur la planche : la pose A de la direction, sans son
 * bras droit pendant (zones effacées : [ligne début, ligne fin, colonne début, colonne fin]),
 * et l'épaule droite d'où le jeu redessine le bras qui lance.
 * De profil gauche, le bras droit est caché derrière le corps : rien à effacer, il
 * apparaît en lançant.
 */
const THROW: Record<Dir8, { erase: [number, number, number, number][]; shoulder: [number, number] }> = {
  down: { erase: [[17, 22, 0, 4]], shoulder: [4, 17] },
  downRight: { erase: [[16, 20, 0, 8]], shoulder: [7, 15] },
  right: { erase: [[16, 21, 0, 7]], shoulder: [6, 15] },
  upRight: { erase: [[15, 15, 14, 99], [16, 19, 12, 99], [20, 20, 13, 99]], shoulder: [13, 15] },
  up: { erase: [[17, 21, 13, 99]], shoulder: [13, 16] },
  upLeft: { erase: [], shoulder: [11, 15] },
  left: { erase: [], shoulder: [12, 15] },
  downLeft: { erase: [[17, 21, 0, 4]], shoulder: [3, 16] },
};
const throwCache = new Map<Dir8, Grid>();
function throwGrid(dir: Dir8): Grid {
  let g = throwCache.get(dir);
  if (!g) {
    const cuts = THROW[dir].erase;
    g = poseGrid(RIDE[dir][0], false).map((row, y) =>
      [...row].map((ch, x) => (cuts.some(([y0, y1, x0, x1]) => y >= y0 && y <= y1 && x >= x0 && x <= x1) ? '.' : ch)).join(''),
    );
    throwCache.set(dir, g);
  }
  return g;
}

/** Image d'une pose pour une direction et une image (0/1), avec le contour d'équipe. */
export function skaterFrame(
  look: SkaterLook,
  dir: Dir8,
  frame: number,
  v: { outline: string; silhouette?: string },
): SkaterFrame {
  const bare = look === 'body' || look === 'swing';
  const pose = bare ? BODY[dir] : look === 'throw' ? RIDE[dir][0] : (look === 'ride' ? RIDE : FOOT)[dir][frame % 2];
  const g = look === 'throw' ? throwGrid(dir) : poseGrid(pose, bare, look === 'swing');
  const name = look === 'throw' ? `skater.throw.${dir}` : `skater.${look}.${pose[0]}.${pose[1] ? 'm' : ''}`;
  const img = propImage(name, g, SKATER_PALETTE, { outline: v.outline, silhouette: v.silhouette });
  const w = g[0].length;
  let shoulders: { x: number; y: number }[] = [];
  if (look === 'swing' && typeof pose[0] === 'number')
    shoulders = (SHOULDERS[pose[0]] ?? []).map(([x, y]) => ({ x: (pose[1] ? w - 1 - x : x) + 1, y: y + 1 }));
  else if (look === 'throw') shoulders = [{ x: THROW[dir].shoulder[0] + 1, y: THROW[dir].shoulder[1] + 1 }];
  const body = typeof pose[0] === 'string' ? CUSTOM_BODY[pose[0]] : undefined;
  const drop = body !== undefined ? Math.max(0, g.length - S[body].length) : 0;
  return { img, anchorX: torsoCenter(g) + 1, rows: g.length + 2, shoulders, drop };
}

/** Toutes les poses (galerie). */
export const SKATER_DIRS = DIRS;

// ------------------------------------------------------------------ accessoires (même style)

/** Planche vue un peu de dessus : grip, tranche en bois, roues (sous les pieds pendant un trick). */
export const DECK_GRIP: Grid = grid(`
  |.aaaaaaaaaaaaaaaaaa.|
  |agggggggggggggggggga|
  |axggggggggggggggggxa|
  |.avvvvvvvvvvvvvvuua.|
  |..aaaaaaaaaaaaaaaa..|
  |...aCa........aEa...|
  |...aaa........aaa...|
`, 'deck.grip');

/** Planche retournée (milieu d'un kickflip) : roues en haut, graphisme du dessous visible. */
export const DECK_UNDER: Grid = grid(`
  |...aaa........aaa...|
  |...aCa........aEa...|
  |..aaaaaaaaaaaaaaaa..|
  |.aoorrsyysykqqtnoxa.|
  |aoorrsyyyskqqttnhoxa|
  |.aaaaaaaaaaaaaaaaaa.|
`, 'deck.under');

/** Planche sur la tranche : image intermédiaire d'une rotation. */
export const DECK_EDGE: Grid = grid(`
  |.aaaaaaaaaaaaaaaaaa.|
  |avvvvvvvvvvvvvvvvuua|
  |.aaaaaaaaaaaaaaaaaa.|
`, 'deck.edge');

/** Équipement lancé au clic droit, toujours dans cet ordre : casque, genouillère, coudière, protège-poignet. */
export const GEAR: readonly Grid[] = [
  grid(`
    |..aaaaaa..|
    |.adddddda.|
    |adjpdddcda|
    |adpddddcda|
    |addddddcda|
    |aaaaaaaaaa|
    |.a......a.|
  `, 'gear.helmet'),
  grid(`
    |.aaaaaa.|
    |adjpddda|
    |adpdddda|
    |aaaaaaaa|
    |aFGGGGFa|
    |aaaaaaaa|
    |addddcda|
    |.adddda.|
    |..aaaa..|
  `, 'gear.knee'),
  grid(`
    |.aaaaaa.|
    |akqqqqka|
    |aqtkkkqa|
    |aaaaaaaa|
    |aGGFFGGa|
    |aaaaaaaa|
    |.aaaaaa.|
  `, 'gear.elbow'),
  grid(`
    |.aaaaa.|
    |apmmmpa|
    |amdddma|
    |amdddma|
    |aaaaaaa|
    |aFGGGFa|
    |aaaaaaa|
    |apmmmpa|
    |.aaaaa.|
  `, 'gear.wrist'),
];

export type DeckFace = 'grip' | 'under' | 'edge';
const DECKS: Record<DeckFace, Grid> = { grip: DECK_GRIP, under: DECK_UNDER, edge: DECK_EDGE };

/** Image d'une face de la planche (sans contour d'équipe : le contour noir est dans le dessin). */
export function deckImage(face: DeckFace, silhouette?: string): HTMLCanvasElement {
  return propImage(`deck.${face}`, DECKS[face], SKATER_PALETTE, { outline: null, silhouette });
}

/** Image d'un équipement lancé, contour à la couleur de l'équipe du lanceur. */
export function gearImage(i: number, outline: string): HTMLCanvasElement {
  return propImage(`gear.${i}`, GEAR[i % GEAR.length], SKATER_PALETTE, { outline });
}
