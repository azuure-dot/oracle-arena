/**
 * Ornements de la direction « mythologique » des menus, dessinés en SVG par le code :
 * couronne de laurier, ciel étoilé avec constellations et cercle d'astrolabe, icônes antiques
 * (casque, glaives, arc, éclair). Tout est déterministe : même rendu à chaque affichage.
 */

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * Couronne de laurier centrée sur (0, 0) : deux branches qui partent du bas et montent vers le haut.
 * `r` rayon de la tige, `n` paires de feuilles par branche, `leaf` longueur d'une feuille.
 */
export function laurelPaths(r: number, n: number, leaf: number, from = 100, to = 248, thin = 0.2): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const branch: string[] = [];
  const a0 = rad(from);
  const a1 = rad(to);
  // tige (arc de cercle côté gauche, d'en bas vers le haut)
  branch.push(
    `<path d="M${f(r * Math.cos(a0))} ${f(r * Math.sin(a0))}A${r} ${r} 0 0 1 ${f(r * Math.cos(a1))} ${f(r * Math.sin(a1))}" fill="none" stroke="currentColor" stroke-width="${f(leaf * 0.09)}" stroke-linecap="round"/>`,
  );
  for (let i = 0; i < n; i++) {
    const k = (i + 0.6) / n;
    const a = a0 + (a1 - a0) * k;
    const s = 1 - 0.35 * k; // feuilles plus petites vers la pointe
    const len = leaf * s;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    // direction de la tige (sens de montée) puis feuille inclinée de ±32° vers l'extérieur / l'intérieur
    const tang = (Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI;
    for (const side of [-1, 1]) {
      const ang = tang + side * 32;
      const ca = Math.cos(rad(ang));
      const sa = Math.sin(rad(ang));
      const cx = x + ca * len * 0.5;
      const cy = y + sa * len * 0.5;
      branch.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(len / 2)}" ry="${f(len * thin)}" transform="rotate(${f(ang)} ${f(cx)} ${f(cy)})"/>`);
    }
  }
  // feuille de pointe
  const tx = r * Math.cos(a1);
  const ty = r * Math.sin(a1);
  const tAng = (Math.atan2(Math.cos(a1), -Math.sin(a1)) * 180) / Math.PI;
  const tl = leaf * 0.6;
  const tcx = tx + Math.cos(rad(tAng)) * tl * 0.45;
  const tcy = ty + Math.sin(rad(tAng)) * tl * 0.45;
  branch.push(`<ellipse cx="${f(tcx)}" cy="${f(tcy)}" rx="${f(tl / 2)}" ry="${f(tl * thin)}" transform="rotate(${f(tAng)} ${f(tcx)} ${f(tcy)})"/>`);
  const g = branch.join('');
  return `<g>${g}</g><g transform="scale(-1 1)">${g}</g>`;
}

/** Grande couronne de laurier dorée autour de l'avatar du chef de groupe. */
export function laurelWreath(uid: string): string {
  return `<svg class="lb-wreath" viewBox="-70 -70 140 140" aria-hidden="true">
    <defs><linearGradient id="lw-${uid}" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#f6e2a6"/><stop offset=".55" stop-color="#d6ae57"/><stop offset="1" stop-color="#8f6a2c"/></linearGradient></defs>
    <g fill="url(#lw-${uid})" color="#c9a14d" stroke="none">${laurelPaths(58, 9, 17, 104, 246)}</g>
  </svg>`;
}

/** Petite icône de laurier (badge du chef, mode Classé). */
export const LAUREL_ICON = `<svg viewBox="-12 -12 24 24" aria-hidden="true"><g fill="currentColor">${laurelPaths(8.6, 4, 5.6, 104, 238)}</g></svg>`;

/** Éclair (marque du jeu). */
export const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.2 1.5 4.5 13.4h6.1L8.7 22.5l10.8-13h-6.3l1-8Z"/></svg>';

/** Icônes des modes de jeu (24×24, remplies en currentColor). */
export const MYTH_MODE_ICONS = {
  // casque hoplite de face : visière en T
  quickplay:
    '<path fill-rule="evenodd" d="M12 1.8c-4.6 0-7.8 3.6-7.8 8.6v6.4c0 .7.3 1.4.9 1.9l3.6 3.3h2.1v-5.6h2.4V22h2.1l3.6-3.3c.6-.5.9-1.2.9-1.9v-6.4c0-5-3.2-8.6-7.8-8.6ZM6.6 9.7h4.3v2.1l-1.2 1.6H6.6V9.7Zm6.5 0h4.3v3.7h-3.1l-1.2-1.6V9.7Zm-2 1.2h1.8v5.2h-1.8z"/>',
  // deux glaives croisés
  deathmatch:
    '<g transform="rotate(45 12 12)"><path d="M11 1.6h2l.5 13.2h-3Z"/><rect x="8.1" y="14.8" width="7.8" height="1.8" rx=".9"/><rect x="11.15" y="16.6" width="1.7" height="3.6"/><circle cx="12" cy="21.2" r="1.2"/></g><g transform="rotate(-45 12 12)"><path d="M11 1.6h2l.5 13.2h-3Z"/><rect x="8.1" y="14.8" width="7.8" height="1.8" rx=".9"/><rect x="11.15" y="16.6" width="1.7" height="3.6"/><circle cx="12" cy="21.2" r="1.2"/></g>',
  // arc bandé et flèche
  practice:
    '<path d="M6.2 2.4c5.6 3.4 5.6 15.8 0 19.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M6.2 2.4v19.2" fill="none" stroke="currentColor" stroke-width=".9"/><path d="M2.6 12h16" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M22 12l-4.2-2.8v5.6Z"/><path d="M2.6 12 1 9.6M2.6 12 1 14.4M4.4 12 2.8 9.6M4.4 12l-1.6 2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  ranked: `<g transform="translate(12 12)">${laurelPaths(8.6, 4, 5.6, 104, 238)}</g>`,
} as const;

/** Chiffres romains des places du groupe. */
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Constellations (points reliés), en coordonnées du ciel 1600×900. */
const CONSTELLATIONS: [number, number][][] = [
  // en haut à gauche : une lyre
  [
    [150, 92],
    [196, 150],
    [262, 132],
    [300, 205],
    [238, 228],
    [196, 150],
  ],
  // en haut à droite : un chasseur (épaules, ceinture, jambes)
  [
    [1290, 70],
    [1352, 128],
    [1420, 92],
    [1352, 128],
    [1372, 190],
    [1398, 196],
    [1424, 202],
    [1442, 268],
    [1424, 202],
    [1398, 196],
    [1372, 190],
    [1330, 262],
  ],
  // en bas à droite, discrète : un serpent
  [
    [1230, 760],
    [1288, 728],
    [1352, 744],
    [1404, 706],
    [1470, 720],
    [1520, 676],
  ],
];

/**
 * Ciel du menu : étoiles, constellations et grand cercle d'astrolabe (chiffres romains)
 * derrière le groupe. Immobile.
 */
export function skySvg(): string {
  const r = rng(7);
  const stars: string[] = [];
  for (let i = 0; i < 110; i++) {
    const x = r() * 1600;
    const y = r() * 900;
    const big = r() < 0.12;
    stars.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(big ? 1.4 + r() : 0.5 + r() * 0.8)}" opacity="${f(big ? 0.75 : 0.25 + r() * 0.4)}"/>`);
  }
  const lines = CONSTELLATIONS.map(
    (c) => `<polyline points="${c.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#e8cf8c" stroke-width="1" opacity=".22"/>`,
  ).join('');
  const nodes = CONSTELLATIONS.flat()
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#f6e6b4" opacity=".75"/><circle cx="${x}" cy="${y}" r="7" fill="#f6e6b4" opacity=".08"/>`)
    .join('');

  // astrolabe : cercles, graduations, chiffres romains
  const cx = 800;
  const cy = 470;
  const ticks: string[] = [];
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180;
    const long = d % 30 === 0;
    const r0 = long ? 492 : 502;
    ticks.push(
      `<line x1="${f(cx + Math.cos(a) * r0)}" y1="${f(cy + Math.sin(a) * r0)}" x2="${f(cx + Math.cos(a) * 514)}" y2="${f(cy + Math.sin(a) * 514)}"/>`,
    );
  }
  const numerals = ROMAN.concat(['XI', 'XII'])
    .map((n, i) => {
      const a = ((i * 30 - 60) * Math.PI) / 180;
      return `<text x="${f(cx + Math.cos(a) * 466)}" y="${f(cy + Math.sin(a) * 466)}" text-anchor="middle" dominant-baseline="central">${n}</text>`;
    })
    .join('');
  const astrolabe = `<g class="lb-astrolabe" fill="none" stroke="#d9b45f">
      <circle cx="${cx}" cy="${cy}" r="514" stroke-width="1.2"/>
      <circle cx="${cx}" cy="${cy}" r="502" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="440" stroke-width=".8" stroke-dasharray="2 9"/>
      <g stroke-width="1">${ticks.join('')}</g>
      <g fill="#d9b45f" stroke="none" font-family="Cinzel, serif" font-size="20" letter-spacing="2">${numerals}</g>
    </g>`;

  return `<svg class="lb-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${astrolabe}
    <g fill="#f3ead2">${stars.join('')}</g>
    ${lines}${nodes}
  </svg>`;
}

// ------------------------------------------------------------------ Grèce antique

/** Couronne d'olivier (feuilles fines, vert argenté) autour de l'avatar du chef. */
export function oliveWreath(uid: string): string {
  return `<svg class="lb-wreath" viewBox="-70 -70 140 140" aria-hidden="true">
    <defs><linearGradient id="ow-${uid}" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#b8c27e"/><stop offset=".6" stop-color="#7d8a45"/><stop offset="1" stop-color="#4f5a26"/></linearGradient></defs>
    <g fill="url(#ow-${uid})" color="#5d6a2e" stroke="none">${laurelPaths(58, 11, 18, 104, 248, 0.15)}</g>
  </svg>`;
}

/** Petite icône d'olivier (badge du chef). */
export const OLIVE_ICON = `<svg viewBox="-12 -12 24 24" aria-hidden="true"><g fill="currentColor">${laurelPaths(8.6, 5, 5.8, 104, 240, 0.15)}</g></svg>`;

/** Casque hoplite (marque du jeu en Grèce antique). */
export const HELMET = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${MYTH_MODE_ICONS.quickplay}</svg>`;

interface ColumnTones {
  flute: string;
  neck: string;
  abacus: string;
  edge: string;
}
const DAY_STONE: ColumnTones = { flute: '#9d907a', neck: '#cfc4ad', abacus: '#e9e2d2', edge: '#b5a98f' };
const NIGHT_STONE: ColumnTones = { flute: '#11182a', neck: '#3b4764', abacus: '#4a5674', edge: '#283149' };

/** Colonne dorique (chapiteau, fût cannelé) dans le repère 1600×900 du décor. */
function doricColumn(cx: number, w: number, top: number, uid: string, tone: ColumnTones = DAY_STONE): string {
  const flutes: string[] = [];
  for (let i = 1; i < 10; i++) {
    const x = cx - w / 2 + (w * i) / 10;
    flutes.push(`<line x1="${f(x)}" y1="${top + 46}" x2="${f(x)}" y2="900"/>`);
  }
  const a = w * 0.72;
  const e = w * 0.66;
  return `<g>
    <rect x="${f(cx - w / 2)}" y="${top + 44}" width="${w}" height="${900 - top - 44}" fill="url(#col-${uid})"/>
    <g stroke="${tone.flute}" stroke-width="1.6" opacity=".45">${flutes.join('')}</g>
    <rect x="${f(cx - w / 2 - 2)}" y="${top + 38}" width="${w + 4}" height="6" fill="${tone.neck}"/>
    <path d="M${f(cx - e)} ${top + 16}H${f(cx + e)}C${f(cx + e - 4)} ${top + 30} ${f(cx + w / 2 + 8)} ${top + 36} ${f(cx + w / 2 + 2)} ${top + 38}H${f(cx - w / 2 - 2)}C${f(cx - w / 2 - 8)} ${top + 36} ${f(cx - e + 4)} ${top + 30} ${f(cx - e)} ${top + 16}Z" fill="url(#col-${uid})"/>
    <rect x="${f(cx - a)}" y="${top}" width="${f(a * 2)}" height="16" fill="${tone.abacus}" stroke="${tone.edge}" stroke-width="1"/>
  </g>`;
}

/**
 * Décor « Grèce antique » : ciel d'été en haut, soleil, deux colonnes doriques sur les bords.
 * Immobile.
 */
export function greeceDecor(): string {
  return `<svg class="lb-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="gr-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9cc3e6" stop-opacity=".75"/>
        <stop offset=".38" stop-color="#cfe0ec" stop-opacity=".35"/>
        <stop offset=".62" stop-color="#ece5d6" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="gr-sun" cx="1260" cy="40" r="420" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff6d8" stop-opacity=".95"/>
        <stop offset=".35" stop-color="#fbe7b0" stop-opacity=".4"/>
        <stop offset="1" stop-color="#fbe7b0" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="col-a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#c9bea6"/><stop offset=".35" stop-color="#f5f0e5"/><stop offset=".7" stop-color="#ddd3bf"/><stop offset="1" stop-color="#b0a48a"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#gr-sky)"/>
    <rect width="1600" height="900" fill="url(#gr-sun)"/>
    <g opacity=".4">${doricColumn(40, 92, 70, 'a')}${doricColumn(1560, 92, 70, 'a')}</g>
  </svg>`;
}

/**
 * Décor « Nuit » : ciel bleu nuit étoilé, pleine lune et son halo, colonnes au clair de lune.
 * Immobile.
 */
export function greeceNightDecor(): string {
  const r = rng(23);
  const stars: string[] = [];
  for (let i = 0; i < 120; i++) {
    const x = r() * 1600;
    const y = Math.pow(r(), 1.6) * 560; // plus d'étoiles en haut du ciel
    const big = r() < 0.1;
    stars.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(big ? 1.3 + r() * 0.8 : 0.5 + r() * 0.7)}" opacity="${f(big ? 0.85 : 0.3 + r() * 0.45)}"/>`);
  }
  return `<svg class="lb-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="gn-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22325c" stop-opacity=".95"/>
        <stop offset=".4" stop-color="#1b2848" stop-opacity=".5"/>
        <stop offset=".68" stop-color="#141b2a" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="gn-halo" cx="1270" cy="120" r="380" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#dfe8ff" stop-opacity=".42"/>
        <stop offset=".3" stop-color="#9fb4e6" stop-opacity=".14"/>
        <stop offset="1" stop-color="#9fb4e6" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="gn-moon" cx=".42" cy=".38" r=".7">
        <stop offset="0" stop-color="#fbf8ee"/><stop offset=".7" stop-color="#e3e1d6"/><stop offset="1" stop-color="#c9c8c0"/>
      </radialGradient>
      <linearGradient id="col-n" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#1c2438"/><stop offset=".35" stop-color="#4b5878"/><stop offset=".7" stop-color="#2f3a54"/><stop offset="1" stop-color="#171e30"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#gn-sky)"/>
    <g fill="#f4f1e6">${stars.join('')}</g>
    <rect width="1600" height="900" fill="url(#gn-halo)"/>
    <circle cx="1270" cy="120" r="46" fill="url(#gn-moon)"/>
    <g fill="#b9b8b0" opacity=".35"><circle cx="1255" cy="108" r="9"/><circle cx="1288" cy="136" r="6"/><circle cx="1262" cy="140" r="4"/></g>
    <g opacity=".75">${doricColumn(40, 92, 70, 'n', NIGHT_STONE)}${doricColumn(1560, 92, 70, 'n', NIGHT_STONE)}</g>
  </svg>`;
}
