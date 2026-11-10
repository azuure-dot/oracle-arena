/**
 * Avatars et bannières de profil, générés en SVG (en attendant les illustrations finales).
 * Un thème par héros, d'après leurs couleurs :
 * - Elio : bonnet violet, lignes urbaines ; bannière street-art avec traces de roues de skate.
 * - Kora : lunettes de protection turquoise, éclaboussures ; bannière taches d'eau azur et orange.
 * - Torsten : marteau runique électrique ; bannière éclairs et runes sur acier.
 * - Camellia : auréole dorée et ailes sur rose crevette ; bannière plumes or et blanches.
 * - Flux : viseur cybernétique et circuits ; bannière grille « glitch » et lignes de code.
 * `uid` rend uniques les identifiants (dégradés, filtres) quand plusieurs SVG cohabitent.
 */

export type ArtId = 'elio' | 'kora' | 'torsten' | 'camellia' | 'flux';
export const ART_IDS: ArtId[] = ['elio', 'kora', 'torsten', 'camellia', 'flux'];

/** Nom affiché et couleur d'accent de chaque thème. */
export const ART_META: Record<ArtId, { name: string; accent: string }> = {
  elio: { name: 'Elio', accent: '#b07cff' },
  kora: { name: 'Kora', accent: '#3ef2d0' },
  torsten: { name: 'Torsten', accent: '#5ad0ff' },
  camellia: { name: 'Camellia', accent: '#ffb3b9' },
  flux: { name: 'Flux', accent: '#3ef2ff' },
};

const INK = '#0b0912';

/** Pseudo-hasard déterministe : chaque dessin est identique d'un affichage à l'autre. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
const f = (n: number) => n.toFixed(1);

// ------------------------------------------------------------------ avatars (100 × 100)

export function avatarSvg(id: ArtId, uid: string): string {
  const u = `${id}-${uid}`;
  const body = AVATARS[id](u);
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

const AVATARS: Record<ArtId, (u: string) => string> = {
  elio: (u) => {
    // Lignes urbaines : silhouettes d'immeubles et rues en perspective
    const r = rng(11);
    let city = '';
    let x = 0;
    while (x < 100) {
      const w = 8 + r() * 10;
      const h = 18 + r() * 30;
      city += `<rect x="${f(x)}" y="${f(100 - h)}" width="${f(w)}" height="${f(h)}" fill="#1a0d33"/>`;
      for (let wy = 100 - h + 4; wy < 96; wy += 6)
        if (r() < 0.55) city += `<rect x="${f(x + 2 + r() * (w - 5))}" y="${f(wy)}" width="2" height="2" fill="#c9a6ff" opacity=".55"/>`;
      x += w + 1;
    }
    return `
      <defs>
        <linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f4dff"/><stop offset="1" stop-color="#2a1052"/></linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g${u})"/>
      <g stroke="#d9c2ff" stroke-width=".8" opacity=".35">
        <path d="M0 62 L100 38 M0 74 L100 52 M20 0 L46 100 M70 0 L58 100" fill="none"/>
      </g>
      ${city}
      <path d="M22 100 C24 80 36 72 50 72 C64 72 76 80 78 100 Z" fill="${INK}"/>
      <circle cx="50" cy="52" r="17" fill="${INK}"/>
      <path d="M31 50 C31 32 41 25 50 25 C59 25 69 32 69 50 Z" fill="#a771ff" stroke="${INK}" stroke-width="2"/>
      <rect x="30" y="45" width="40" height="9" rx="3" fill="#7d48e6" stroke="${INK}" stroke-width="2"/>
      <g stroke="#5a2fb0" stroke-width="1.4"><path d="M36 46v7M41 46v7M46 46v7M51 46v7M56 46v7M61 46v7M66 46v7"/></g>
      <path d="M40 30 C44 27 48 27 52 28" stroke="#e4d2ff" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="50" cy="22" r="5.5" fill="#c49cff" stroke="${INK}" stroke-width="2"/>
      <rect x="1.5" y="1.5" width="97" height="97" fill="none" stroke="#d9c2ff" stroke-opacity=".5" stroke-width="1.5"/>`;
  },

  kora: (u) => {
    const r = rng(23);
    let drops = '';
    for (let i = 0; i < 14; i++) {
      const x = r() * 100;
      const y = r() * 100;
      const s = 1.5 + r() * 4;
      drops += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="#c9fbff" opacity="${f(0.25 + r() * 0.45)}"/>`;
    }
    return `
      <defs>
        <radialGradient id="g${u}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#2fd8ef"/><stop offset=".6" stop-color="#0a7fa6"/><stop offset="1" stop-color="#05324a"/></radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g${u})"/>
      <path d="M-4 78 C14 66 24 88 42 76 C58 66 70 84 104 70 L104 104 L-4 104 Z" fill="#0b5f7c" opacity=".75"/>
      <path d="M8 18 C14 10 24 14 22 22 C20 28 10 28 8 18 Z M78 14 C86 10 92 18 86 24 C80 28 74 20 78 14 Z" fill="#9ef6ff" opacity=".45"/>
      ${drops}
      <rect x="6" y="44" width="88" height="10" rx="5" fill="#073345" stroke="${INK}" stroke-width="2"/>
      <rect x="18" y="33" width="29" height="25" rx="11" fill="#073345" stroke="${INK}" stroke-width="2.5"/>
      <rect x="53" y="33" width="29" height="25" rx="11" fill="#073345" stroke="${INK}" stroke-width="2.5"/>
      <rect x="21.5" y="36.5" width="22" height="18" rx="8" fill="#3ef2d0"/>
      <rect x="56.5" y="36.5" width="22" height="18" rx="8" fill="#3ef2d0"/>
      <path d="M25 41 C28 38 33 38 36 39" stroke="#e8fffb" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M60 41 C63 38 68 38 71 39" stroke="#e8fffb" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <rect x="45.5" y="42" width="9" height="6" rx="2" fill="#f07a28" stroke="${INK}" stroke-width="1.8"/>
      <rect x="1.5" y="1.5" width="97" height="97" fill="none" stroke="#bff9ff" stroke-opacity=".5" stroke-width="1.5"/>`;
  },

  torsten: (u) => `
      <defs>
        <radialGradient id="g${u}" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#1d3550"/><stop offset="1" stop-color="#070b12"/></radialGradient>
        <filter id="b${u}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>
      </defs>
      <rect width="100" height="100" fill="url(#g${u})"/>
      <g stroke="#2a4a6a" stroke-width=".8" opacity=".6"><path d="M0 20H100M0 40H100M0 60H100M0 80H100" fill="none"/></g>
      <g transform="rotate(-38 50 50)">
        <rect x="27" y="22" width="46" height="30" rx="4" fill="#5ad0ff" opacity=".55" filter="url(#b${u})"/>
        <rect x="46" y="44" width="8" height="46" rx="3" fill="#6b4a32" stroke="${INK}" stroke-width="2"/>
        <g stroke="#3a2618" stroke-width="1.6"><path d="M46 58h8M46 64h8M46 70h8M46 76h8"/></g>
        <circle cx="50" cy="92" r="4.5" fill="#9fb0c4" stroke="${INK}" stroke-width="2"/>
        <path d="M30 24 h40 l4 4 v20 l-4 4 h-40 l-4 -4 v-20 Z" fill="#a7b6c8" stroke="${INK}" stroke-width="2.5"/>
        <path d="M33 27 h34 v4 h-34 Z" fill="#d4dde8" opacity=".7"/>
        <path d="M46 31 v16 M46 31 l7 4 l-7 4 l8 8" stroke="#5ad0ff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M46 31 v16 M46 31 l7 4 l-7 4 l8 8" stroke="#e6f9ff" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <path d="M78 12 l-6 12 h6 l-7 14" stroke="#7fe0ff" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <path d="M18 70 l-5 9 h5 l-6 11" stroke="#7fe0ff" stroke-width="1.6" fill="none" stroke-linejoin="round" opacity=".8"/>
      <rect x="1.5" y="1.5" width="97" height="97" fill="none" stroke="#9fe6ff" stroke-opacity=".45" stroke-width="1.5"/>`,

  camellia: (u) => {
    const wing = (side: number) => {
      let p = '';
      for (let i = 0; i < 5; i++) {
        const a = -0.15 - i * 0.28;
        const len = 30 - i * 3;
        const x0 = 50 + side * 7;
        const y0 = 56;
        const x1 = x0 + side * Math.cos(a) * len;
        const y1 = y0 + Math.sin(a) * len;
        p += `<path d="M${f(x0)} ${f(y0)} Q ${f((x0 + x1) / 2 + side * 3)} ${f((y0 + y1) / 2 + 9)} ${f(x1)} ${f(y1)} Q ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2 - 3)} ${f(x0)} ${f(y0)} Z" fill="${i % 2 ? '#fff7ef' : '#ffffff'}" stroke="${INK}" stroke-width="1.6"/>`;
      }
      return p;
    };
    return `
      <defs>
        <linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8f9c"/><stop offset="1" stop-color="#b8344c"/></linearGradient>
        <filter id="b${u}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
      </defs>
      <rect width="100" height="100" fill="url(#g${u})"/>
      <circle cx="50" cy="52" r="34" fill="#ffd9a0" opacity=".25"/>
      ${wing(-1)}${wing(1)}
      <path d="M50 50 C44 58 44 74 50 84 C56 74 56 58 50 50 Z" fill="#f2c14e" stroke="${INK}" stroke-width="1.8"/>
      <ellipse cx="50" cy="26" rx="18" ry="6" fill="none" stroke="#ffd23f" stroke-width="6" opacity=".55" filter="url(#b${u})"/>
      <ellipse cx="50" cy="26" rx="18" ry="6" fill="none" stroke="${INK}" stroke-width="5"/>
      <ellipse cx="50" cy="26" rx="18" ry="6" fill="none" stroke="#ffd23f" stroke-width="3"/>
      <path d="M36 24 C40 21 46 20 50 20" stroke="#fff6cf" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <rect x="1.5" y="1.5" width="97" height="97" fill="none" stroke="#ffe0e3" stroke-opacity=".55" stroke-width="1.5"/>`;
  },

  flux: (u) => {
    const r = rng(41);
    let traces = '';
    for (let i = 0; i < 9; i++) {
      const y = 8 + r() * 84;
      const x0 = r() < 0.5 ? 0 : 100;
      const x1 = x0 === 0 ? 18 + r() * 18 : 82 - r() * 18;
      const dy = (r() - 0.5) * 16;
      const c = r() < 0.5 ? '#a35cff' : '#3ef2ff';
      traces += `<path d="M${x0} ${f(y)} H${f(x1)} L${f(x1 + (x0 === 0 ? 6 : -6))} ${f(y + dy)}" stroke="${c}" stroke-width="1.4" fill="none" opacity=".75"/><circle cx="${f(x1 + (x0 === 0 ? 6 : -6))}" cy="${f(y + dy)}" r="1.8" fill="${c}"/>`;
    }
    const reticle = (dx: number, color: string, op: number) => `
      <g transform="translate(${dx} 0)" stroke="${color}" fill="none" opacity="${op}">
        <circle cx="50" cy="50" r="22" stroke-width="3"/>
        <circle cx="50" cy="50" r="11" stroke-width="2"/>
        <path d="M50 20v12M50 68v12M20 50h12M68 50h12" stroke-width="3" stroke-linecap="square"/>
      </g>`;
    return `
      <defs>
        <linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1040"/><stop offset="1" stop-color="#07060f"/></linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g${u})"/>
      <g stroke="#2a1d55" stroke-width=".6"><path d="M0 25H100M0 50H100M0 75H100M25 0V100M50 0V100M75 0V100" fill="none"/></g>
      ${traces}
      ${reticle(-2, '#ff3ec8', 0.75)}${reticle(2, '#3ef2ff', 0.75)}${reticle(0, '#e9f6ff', 1)}
      <circle cx="50" cy="50" r="3.5" fill="#ff3ec8"/>
      <rect x="14" y="70" width="22" height="3" fill="#3ef2ff" opacity=".8"/><rect x="64" y="27" width="16" height="3" fill="#ff3ec8" opacity=".8"/>
      <rect x="1.5" y="1.5" width="97" height="97" fill="none" stroke="#c9b4ff" stroke-opacity=".45" stroke-width="1.5"/>`;
  },
};

// ------------------------------------------------------------------ bannières (200 × 320)

export function bannerSvg(id: ArtId, uid: string): string {
  const u = `b-${id}-${uid}`;
  return `<svg viewBox="0 0 200 320" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${BANNERS[id](u)}</svg>`;
}

const BANNERS: Record<ArtId, (u: string) => string> = {
  elio: (u) => {
    const r = rng(7);
    let shapes = '';
    const cols = ['#7b4fd6', '#b07cff', '#3d2373', '#5a2fb0', '#1a0d33'];
    for (let i = 0; i < 16; i++) {
      const x = r() * 200;
      const y = r() * 320;
      const s = 18 + r() * 46;
      const a = r() * 360;
      const kind = Math.floor(r() * 3);
      const c = cols[Math.floor(r() * cols.length)];
      const shape =
        kind === 0
          ? `<polygon points="0,${f(-s)} ${f(s * 0.87)},${f(s / 2)} ${f(-s * 0.87)},${f(s / 2)}"/>`
          : kind === 1
            ? `<rect x="${f(-s / 2)}" y="${f(-s / 4)}" width="${f(s)}" height="${f(s / 2)}"/>`
            : `<polygon points="${f(-s / 2)},0 0,${f(-s / 2)} ${f(s / 2)},0 0,${f(s / 2)}"/>`;
      shapes += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)})" fill="${c}" stroke="${INK}" stroke-width="2.5" opacity="${f(0.55 + r() * 0.4)}">${shape}</g>`;
    }
    const track = (y: number, bend: number) =>
      `<path d="M-10 ${y} C 60 ${y - bend} 140 ${y + bend} 210 ${y - 10}" stroke="#e7dbff" stroke-width="3" stroke-dasharray="9 7" fill="none" opacity=".55"/>` +
      `<path d="M-10 ${y + 16} C 60 ${y + 16 - bend} 140 ${y + 16 + bend} 210 ${y + 6}" stroke="#e7dbff" stroke-width="3" stroke-dasharray="9 7" fill="none" opacity=".55"/>`;
    return `
      <defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140a26"/><stop offset="1" stop-color="#05030a"/></linearGradient></defs>
      <rect width="200" height="320" fill="url(#g${u})"/>
      ${shapes}
      ${track(96, 40)}${track(236, -34)}
      <path d="M24 170 l12 -14 l8 10 l14 -18 l10 12" stroke="#d6b8ff" stroke-width="3" fill="none" stroke-linejoin="round"/>`;
  },

  kora: (_u) => {
    const r = rng(19);
    const blob = (cx: number, cy: number, rad: number, color: string, op: number) => {
      let d = '';
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = rad * (0.7 + r() * 0.5);
        const x = cx + Math.cos(a) * k;
        const y = cy + Math.sin(a) * k;
        d += i === 0 ? `M${f(x)} ${f(y)}` : ` Q ${f(cx + Math.cos(a - 0.35) * rad * 1.2)} ${f(cy + Math.sin(a - 0.35) * rad * 1.2)} ${f(x)} ${f(y)}`;
      }
      return `<path d="${d} Z" fill="${color}" opacity="${op}"/>`;
    };
    let dots = '';
    for (let i = 0; i < 40; i++) {
      const c = r() < 0.7 ? '#3ef2d0' : '#f07a28';
      dots += `<circle cx="${f(r() * 200)}" cy="${f(r() * 320)}" r="${f(1.5 + r() * 5)}" fill="${c}" opacity="${f(0.35 + r() * 0.5)}"/>`;
    }
    return `
      <rect width="200" height="320" fill="#061019"/>
      ${blob(60, 80, 70, '#1aa7d6', 0.8)}${blob(150, 190, 80, '#0e6f95', 0.85)}${blob(40, 260, 55, '#3ef2d0', 0.55)}
      ${blob(150, 60, 34, '#f07a28', 0.85)}${blob(80, 180, 26, '#ff9a4d', 0.8)}${blob(170, 290, 28, '#f07a28', 0.7)}
      ${dots}
      <path d="M0 140 C 40 120 80 160 120 140 C 160 120 180 150 200 140" stroke="#c9fbff" stroke-width="2.5" fill="none" opacity=".5"/>`;
  },

  torsten: (u) => {
    const r = rng(31);
    const bolt = (x: number, y: number, len: number) => {
      let d = `M${f(x)} ${f(y)}`;
      let cx = x;
      let cy = y;
      for (let i = 0; i < 6; i++) {
        cx += (r() - 0.5) * 34;
        cy += len / 6;
        d += ` L${f(cx)} ${f(cy)}`;
      }
      return `<path d="${d}" stroke="#5ad0ff" stroke-width="7" fill="none" opacity=".35" filter="url(#b${u})" stroke-linejoin="round"/><path d="${d}" stroke="#bff0ff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`;
    };
    const runes = ['ᚱ', 'ᚦ', 'ᛉ', 'ᚨ', 'ᛏ', 'ᚠ'];
    let rr = '';
    for (let i = 0; i < 7; i++) {
      rr += `<text x="${f(20 + r() * 160)}" y="${f(40 + r() * 260)}" font-size="${f(22 + r() * 18)}" fill="#7fe0ff" opacity="${f(0.35 + r() * 0.5)}" font-family="serif" text-anchor="middle" filter="url(#s${u})">${runes[i % runes.length]}</text>`;
    }
    let brushed = '';
    for (let y = 4; y < 320; y += 6) brushed += `<path d="M0 ${y} H200" stroke="#ffffff" stroke-opacity="${f(0.02 + r() * 0.04)}"/>`;
    return `
      <defs>
        <linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a5564"/><stop offset=".55" stop-color="#252c36"/><stop offset="1" stop-color="#11151b"/></linearGradient>
        <filter id="b${u}" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="4"/></filter>
        <filter id="s${u}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#5ad0ff"/></filter>
      </defs>
      <rect width="200" height="320" fill="url(#g${u})"/>
      ${brushed}
      ${rr}
      ${bolt(60, -10, 340)}${bolt(150, -10, 200)}
      <path d="M0 0 L60 0 L0 60 Z M200 320 L140 320 L200 260 Z" fill="#0b0f15" opacity=".6"/>`;
  },

  camellia: (u) => {
    const r = rng(53);
    const feather = (x: number, y: number, s: number, a: number, c: string) =>
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)}) scale(${f(s)})"><path d="M0 -20 C 8 -12 8 10 0 22 C -8 10 -8 -12 0 -20 Z" fill="${c}" stroke="#5a2a10" stroke-opacity=".35" stroke-width="1"/><path d="M0 -18 V22" stroke="#c99a3a" stroke-width="1.2"/></g>`;
    let fs = '';
    for (let i = 0; i < 18; i++) fs += feather(r() * 200, r() * 320, 0.6 + r() * 1.1, r() * 360, r() < 0.5 ? '#fff8ee' : '#f2c14e');
    return `
      <defs>
        <linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8f9c"/><stop offset=".55" stop-color="#e86a6a"/><stop offset="1" stop-color="#e8b04a"/></linearGradient>
        <radialGradient id="h${u}" cx=".5" cy=".3" r=".6"><stop offset="0" stop-color="#fff3c4" stop-opacity=".75"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="200" height="320" fill="url(#g${u})"/>
      <rect width="200" height="320" fill="url(#h${u})"/>
      <ellipse cx="100" cy="90" rx="70" ry="20" fill="none" stroke="#ffe27a" stroke-width="3" opacity=".7"/>
      <ellipse cx="100" cy="90" rx="90" ry="28" fill="none" stroke="#fff3c4" stroke-width="1.5" opacity=".5"/>
      ${fs}`;
  },

  flux: (_u) => {
    const r = rng(67);
    let grid = '';
    for (let x = 0; x <= 200; x += 20) grid += `<path d="M${x} 0 V320" stroke="#3a1f7a" stroke-width="1"/>`;
    for (let y = 0; y <= 320; y += 20) grid += `<path d="M0 ${y} H200" stroke="#3a1f7a" stroke-width="1"/>`;
    let code = '';
    for (let y = 18; y < 320; y += 12) {
      let x = 10 + Math.floor(r() * 4) * 10;
      while (x < 190 && r() < 0.85) {
        const w = 8 + r() * 34;
        const c = r() < 0.65 ? '#7f5cff' : r() < 0.5 ? '#3ef2ff' : '#ff3ec8';
        code += `<rect x="${f(x)}" y="${y}" width="${f(Math.min(w, 190 - x))}" height="4" fill="${c}" opacity="${f(0.35 + r() * 0.5)}"/>`;
        x += w + 5;
      }
    }
    let glitch = '';
    for (let i = 0; i < 6; i++) {
      const y = r() * 320;
      const h = 4 + r() * 14;
      glitch += `<rect x="${f(-10 + r() * 60)}" y="${f(y)}" width="${f(80 + r() * 140)}" height="${f(h)}" fill="${r() < 0.5 ? '#3ef2ff' : '#ff3ec8'}" opacity=".28"/>`;
    }
    return `
      <rect width="200" height="320" fill="#090615"/>
      ${grid}${code}${glitch}
      <path d="M0 0 H200 V320 H0 Z" fill="none" stroke="#a35cff" stroke-width="3" opacity=".6"/>`;
  },
};
