/**
 * PERSONNAGES EN VUE DE DESSUS (façon Bopz.io) — rendu vectoriel commun à tous les héros.
 *
 * La caméra est juste au-dessus des têtes : un héros est une boule (sa tête vue d'en haut)
 * qu'on reconnaît à ses cheveux ou à son couvre-chef, avec deux mains rondes qui tiennent
 * l'arme. Tout se dessine dans le repère du personnage, regard vers +x : le héros tourne
 * simplement avec la souris (rotation du repère). Seule la lumière (ombre en aplat, reflet)
 * reste fixe à l'écran : voir `shade`.
 *
 * Ordre de dessin habituel : arme → boule (peau) → cheveux / couvre-chef → mains.
 */

export const LINE = '#1b1630';
export const TAU = Math.PI * 2;

// ------------------------------------------------------------ cache d'images

/**
 * Suréchantillonnage des images en cache : assez pour rester net avec le zoom de la caméra
 * (~2) sur un écran haute densité.
 */
const SS = 4;
const cache = new Map<string, HTMLCanvasElement>();

/**
 * Dessine `draw` une seule fois dans une image en cache (carré de `size` unités autour de
 * l'origine), puis la recopie à chaque appel. Les têtes, armes et mains ne sont donc pas
 * redessinées à chaque image (chemins, contours, lueurs coûtent cher sur une carte
 * graphique intégrée) : seule la copie tournée de l'image l'est.
 */
export function cached(ctx: CanvasRenderingContext2D, key: string, size: number, draw: (c: CanvasRenderingContext2D) => void): void {
  let img = cache.get(key);
  if (!img) {
    img = document.createElement('canvas');
    img.width = img.height = Math.ceil(size * 2 * SS);
    const c = img.getContext('2d')!;
    c.scale(SS, SS);
    c.translate(size, size);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    draw(c);
    cache.set(key, img);
  }
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true; // image suréchantillonnée : réduite en douceur
  ctx.drawImage(img, -size, -size, size * 2, size * 2);
  ctx.imageSmoothingEnabled = smooth;
}

// ------------------------------------------------------------ aides

/** Forme pleine avec contour sombre. */
export function inked(ctx: CanvasRenderingContext2D, fill: string, path: () => void, width = 2): void {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  if (width > 0) {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/**
 * Ombre en aplat (croissant net) et reflet sur un disque. La lumière vient toujours du
 * haut-gauche de l'écran : `rot` (rotation du repère courant) la compense.
 */
export function shade(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, alpha = 0.22): void {
  const lx = Math.cos(-rot + Math.PI * 0.25);
  const ly = Math.sin(-rot + Math.PI * 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = `rgba(30,15,50,${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, r + 1, 0, TAU);
  ctx.arc(x - lx * r * 0.22, y - ly * r * 0.22, r * 1.02, 0, TAU, true);
  ctx.fill('evenodd');
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(x - lx * r * 0.45, y - ly * r * 0.45, r * 0.22, r * 0.12, Math.atan2(ly, lx) + Math.PI / 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Main ronde. `wrap` : bandages (deux traits clairs) ; `band` : bracelet sombre (côté poignet,
 * vers le corps). La main (et son ombre) est une image en cache, dessinée sans rotation pour
 * que la lumière reste fixe à l'écran.
 */
export function hand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  rot: number,
  opts: { wrap?: string; band?: string } = {},
): void {
  if (opts.band) {
    ctx.save();
    ctx.translate(x - r * 0.55, y);
    cached(ctx, `band|${r}|${opts.band}`, r * 0.8, (c) => inked(c, opts.band!, () => c.arc(0, 0, r * 0.62, 0, TAU), Math.max(1.2, r * 0.22)));
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-rot);
  cached(ctx, `hand|${r}|${color}|${opts.wrap ?? ''}`, r * 1.25, (c) => {
    inked(c, color, () => c.arc(0, 0, r, 0, TAU), Math.max(1.5, r * 0.3));
    if (opts.wrap) {
      c.save();
      c.beginPath();
      c.arc(0, 0, r * 0.92, 0, TAU);
      c.clip();
      c.strokeStyle = opts.wrap;
      c.lineWidth = r * 0.22;
      for (const d of [-0.35, 0.2]) {
        c.beginPath();
        c.moveTo(d * r - r, -r);
        c.lineTo(d * r + r * 0.4, r);
        c.stroke();
      }
      c.restore();
    }
    shade(c, 0, 0, r, 0, 0.25);
  });
  ctx.restore();
}

/** La tête (boule de peau) avec son contour. */
export function head(ctx: CanvasRenderingContext2D, R: number, skin: string): void {
  inked(ctx, skin, () => ctx.arc(0, 0, R, 0, TAU), 2.4);
}

/** Pseudo-hasard déterministe (boucles, autocollants : toujours au même endroit). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// ------------------------------------------------------------ cheveux et couvre-chefs (regard vers +x)

/**
 * Cheveux « classiques » : ils couvrent le dessus et l'arrière de la tête, le front reste
 * visible devant (bord en légère vague), quelques mèches vers la nuque.
 */
export function classicHair(ctx: CanvasRenderingContext2D, R: number, color: string, dark: string, front = 0.42): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-R * 0.3, 0, R * 1.05, Math.PI * 0.5, Math.PI * 1.5);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const y = -R * 1.05 + (2.1 * R * i) / n;
    const x = R * front * Math.sqrt(Math.max(0, 1 - (y / (R * 1.05)) ** 2)) + (i % 2 ? -R * 0.04 : R * 0.02);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.lineWidth = R * 0.06;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.7;
  for (const s of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(R * 0.1, s * R * 0.6);
    ctx.quadraticCurveTo(-R * 0.35, s * R * 0.85, -R * 0.85, s * R * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Thor : longs cheveux bleus rejetés en arrière (ils débordent derrière la tête en une
 * masse effilée), et sa grosse barbe tressée qui dépasse devant le menton.
 * À dessiner en deux temps : `thorHairBack` avant la tête, `thorHairTop` après.
 */
export function thorHairBack(ctx: CanvasRenderingContext2D, R: number): void {
  // Barbe (devant) et masse de cheveux (derrière), sous la tête
  inked(ctx, '#2f7cf0', () => {
    ctx.moveTo(R * 0.55, -R * 0.55);
    ctx.quadraticCurveTo(R * 1.25, -R * 0.35, R * 1.38, 0);
    ctx.quadraticCurveTo(R * 1.25, R * 0.35, R * 0.55, R * 0.55);
    ctx.closePath();
  }, 2);
  // Tresse de la barbe
  ctx.strokeStyle = '#1f55b0';
  ctx.lineWidth = R * 0.07;
  for (const x of [0.95, 1.13]) {
    ctx.beginPath();
    ctx.moveTo(R * x, -R * 0.12);
    ctx.quadraticCurveTo(R * (x + 0.08), 0, R * x, R * 0.12);
    ctx.stroke();
  }
  inked(ctx, '#3a8dff', () => {
    ctx.moveTo(-R * 0.3, -R * 0.85);
    ctx.quadraticCurveTo(-R * 1.05, -R * 0.75, -R * 1.38, -R * 0.12);
    ctx.lineTo(-R * 1.26, 0);
    ctx.lineTo(-R * 1.4, R * 0.14);
    ctx.quadraticCurveTo(-R * 1.05, R * 0.75, -R * 0.3, R * 0.85);
    ctx.closePath();
  }, 2);
  ctx.strokeStyle = '#2a64c0';
  ctx.lineWidth = R * 0.06;
  for (const s of [-0.45, 0, 0.45]) {
    ctx.beginPath();
    ctx.moveTo(-R * 0.9, s * R * 0.8);
    ctx.quadraticCurveTo(-R * 1.1, s * R * 0.6, -R * 1.3, s * R * 0.2);
    ctx.stroke();
  }
}
export function thorHairTop(ctx: CanvasRenderingContext2D, R: number): void {
  classicHair(ctx, R, '#3a8dff', '#2a64c0', 0.5);
  // Reflet électrique dans les cheveux
  ctx.strokeStyle = 'rgba(160,230,255,0.7)';
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.moveTo(-R * 0.1, -R * 0.45);
  ctx.quadraticCurveTo(-R * 0.45, -R * 0.55, -R * 0.75, -R * 0.4);
  ctx.stroke();
}

/** Cheveux en pointes rejetées en arrière (éventail) + lunettes relevées sur le front (Flux). */
export function fluxHair(ctx: CanvasRenderingContext2D, R: number): void {
  const color = '#c4672a';
  for (const a of [Math.PI - 1.0, Math.PI - 0.5, Math.PI, Math.PI + 0.5, Math.PI + 1.0]) {
    const w = 0.32;
    const tip = R * (Math.abs(a - Math.PI) < 0.1 ? 1.5 : 1.38);
    inked(ctx, color, () => {
      ctx.moveTo(Math.cos(a - w) * R * 0.8, Math.sin(a - w) * R * 0.8);
      ctx.lineTo(Math.cos(a) * tip, Math.sin(a) * tip);
      ctx.lineTo(Math.cos(a + w) * R * 0.8, Math.sin(a + w) * R * 0.8);
      ctx.closePath();
    }, 1.8);
  }
  classicHair(ctx, R, color, '#8a4517');
  ctx.strokeStyle = LINE;
  ctx.lineWidth = R * 0.09;
  ctx.beginPath();
  ctx.moveTo(R * 0.35, -R * 0.98);
  ctx.quadraticCurveTo(R * 0.62, 0, R * 0.35, R * 0.98);
  ctx.stroke();
  for (const s of [-1, 1]) {
    inked(ctx, '#ffcf5a', () => ctx.ellipse(R * 0.56, s * R * 0.34, R * 0.2, R * 0.25, 0, 0, TAU), 1.8);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(R * 0.5, s * R * 0.34 - R * 0.07, R * 0.06, 0, TAU);
    ctx.fill();
  }
}

/** Cheveux courts + casque audio sur la tête : arceau d'une oreille à l'autre, coques aux couleurs de l'aura (Tempo). */
export function tempoHair(ctx: CanvasRenderingContext2D, R: number, aura: string): void {
  classicHair(ctx, R, '#4a4f6a', '#2d3045', 0.5);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = R * 0.24;
  ctx.beginPath();
  ctx.moveTo(-R * 0.05, -R * 0.95);
  ctx.lineTo(-R * 0.05, R * 0.95);
  ctx.stroke();
  ctx.strokeStyle = aura;
  ctx.lineWidth = R * 0.12;
  ctx.stroke();
  for (const s of [-1, 1]) inked(ctx, aura, () => ctx.ellipse(-R * 0.05, s * R * 1.0, R * 0.3, R * 0.2, 0, 0, TAU), 2);
}

/** Casque d'acier de chevalier : dôme gris, crête de l'avant à l'arrière, rivets, visière (Rempart). */
export function knightHelmet(ctx: CanvasRenderingContext2D, R: number): void {
  inked(ctx, '#a9b8c9', () => ctx.arc(0, 0, R * 1.04, 0, TAU), 2.2);
  ctx.strokeStyle = '#7f8ea3';
  ctx.lineWidth = R * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.78, 0, TAU);
  ctx.stroke();
  inked(ctx, '#c9d4e2', () => ctx.roundRect(-R * 0.9, -R * 0.09, R * 1.65, R * 0.18, R * 0.09), 1.6);
  ctx.fillStyle = '#5d6b80';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, R * 0.05, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = R * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.92, -0.5, 0.5);
  ctx.stroke();
}

/**
 * Turty : grosse chevelure afro aux boucles serrées, presque noire avec des reflets cuivrés,
 * qui déborde largement de la tête ; bandana orange noué sur le côté, juste au-dessus du front.
 * Silhouette faite de boucles rondes (contour d'un seul tenant), puis petites boucles en
 * spirale à l'intérieur.
 */
export function turtyHair(ctx: CanvasRenderingContext2D, R: number): void {
  const cx = -R * 0.3;
  const rnd = seeded(7);
  const blobs: [number, number, number][] = [[cx, 0, R * 0.95]];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.1;
    // Devant, la chevelure s'arrête au bandana : boucles plus petites et plus en retrait.
    const front = Math.max(0, Math.cos(a));
    const dist = R * (1.05 - front * 0.5) + rnd() * R * 0.06;
    const r = R * (0.38 - front * 0.18) + rnd() * R * 0.05;
    blobs.push([cx + Math.cos(a) * dist, Math.sin(a) * dist * 1.04, r]);
  }
  // Contour d'un seul tenant : traits épais d'abord, puis tout le remplissage par-dessus.
  ctx.fillStyle = '#2b1a14';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 4.4;
  for (const [x, y, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
  }
  for (const [x, y, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  // Volume : chaque boucle du bord a un reflet cuivré sur son côté éclairé.
  ctx.fillStyle = '#4a2c1f';
  for (const [x, y, r] of blobs.slice(1)) {
    ctx.beginPath();
    ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.62, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#3a2219';
  ctx.beginPath();
  ctx.arc(cx, 0, R * 0.86, 0, TAU);
  ctx.fill();
  // Touffes bouclées qui se chevauchent (effet nuage) : pas de contour complet, juste une
  // ombre sous chaque touffe et un reflet cuivré dessus. De l'arrière vers l'avant.
  const puffs: [number, number, number][] = [[cx - R * 0.05, 0, R * 0.3]];
  for (const [ring, count, size] of [[0.36, 6, 0.27], [0.7, 11, 0.25]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + ring * 3 + (rnd() - 0.5) * 0.25;
      const d = R * ring + (rnd() - 0.5) * R * 0.06;
      const x = cx + Math.cos(a) * d;
      if (x > R * 0.15) continue; // devant : le bandana
      puffs.push([x, Math.sin(a) * d, R * (size + rnd() * 0.04)]);
    }
  }
  puffs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  for (const [x, y, r] of puffs) {
    ctx.fillStyle = '#432a1d';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#21130c';
    ctx.lineWidth = R * 0.04;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.05, Math.PI * 0.85);
    ctx.stroke();
    ctx.strokeStyle = '#7d5236';
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
  }
  // Bandana orange : bande en arc au-dessus du front, nœud sur le côté gauche.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = R * 0.3;
  ctx.beginPath();
  ctx.arc(-R * 0.35, 0, R * 0.88, -1.1, 1.1);
  ctx.stroke();
  ctx.strokeStyle = '#f07a28';
  ctx.lineWidth = R * 0.2;
  ctx.stroke();
  ctx.strokeStyle = '#ffb36b';
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.arc(-R * 0.35, 0, R * 0.83, -0.95, 0.95);
  ctx.stroke();
  const kx = -R * 0.05;
  const ky = -R * 0.8;
  for (const [ex, ey, rot] of [[-R * 0.32, -R * 0.2, -0.7], [R * 0.05, -R * 0.38, 0.4]] as const) {
    inked(ctx, '#f07a28', () => ctx.ellipse(kx + ex, ky + ey, R * 0.2, R * 0.12, rot, 0, TAU), 1.6);
  }
  inked(ctx, '#d9641c', () => ctx.arc(kx, ky, R * 0.09, 0, TAU), 1.4);
}

/** Skater : casque audio autour du cou (sous la tête : seules les coques dépassent sur les côtés). */
export function skaterHeadphones(ctx: CanvasRenderingContext2D, R: number): void {
  for (const s of [-1, 1]) {
    inked(ctx, '#3a3a42', () => ctx.ellipse(-R * 0.1, s * R * 1.02, R * 0.32, R * 0.24, 0, 0, TAU), 1.8);
    ctx.fillStyle = '#5c5c66';
    ctx.beginPath();
    ctx.ellipse(-R * 0.1, s * R * 1.02, R * 0.16, R * 0.11, 0, 0, TAU);
    ctx.fill();
  }
}

/**
 * Skater : bonnet violet en maille qui cache toute la chevelure, vu de dessus : côtes de
 * maille qui partent du sommet, revers côtelé tout autour, petite étiquette blanche devant
 * (on voit où il regarde) et pompon sur le dessus.
 */
export function skaterBeanie(ctx: CanvasRenderingContext2D, R: number): void {
  const crown = -R * 0.08;
  inked(ctx, '#7b4fd6', () => ctx.arc(0, 0, R * 1.04, 0, TAU), 2.2);
  // Côtes de la maille : du sommet vers le revers
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.8, 0, TAU);
  ctx.clip();
  ctx.strokeStyle = '#6438c0';
  ctx.lineWidth = R * 0.07;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ctx.beginPath();
    ctx.moveTo(crown + Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22);
    ctx.lineTo(crown + Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
    ctx.stroke();
  }
  ctx.restore();
  // Revers côtelé (bande plus sombre sur le bord)
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.8, 0, TAU);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.03, 0, TAU);
  ctx.arc(0, 0, R * 0.8, 0, TAU, true);
  ctx.fillStyle = '#5a30b0';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#7f56da';
  ctx.lineWidth = R * 0.06;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.83, Math.sin(a) * R * 0.83);
    ctx.lineTo(Math.cos(a) * R * 1.0, Math.sin(a) * R * 1.0);
    ctx.stroke();
  }
  ctx.restore();
  // Étiquette blanche sur le revers, devant
  inked(ctx, '#f2f2f2', () => ctx.roundRect(R * 0.8, -R * 0.2, R * 0.22, R * 0.4, R * 0.05), 1.4);
  ctx.fillStyle = '#e8893a';
  ctx.beginPath();
  ctx.arc(R * 0.91, 0, R * 0.07, 0, TAU);
  ctx.fill();
  // Pompon sur le dessus : boule duveteuse
  const pr = R * 0.3;
  ctx.fillStyle = '#c7a3ff';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * TAU;
    const r = pr * (i % 2 ? 0.86 : 1);
    const x = crown + Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(crown - pr * 0.3, -pr * 0.3, pr * 0.32, 0, TAU);
  ctx.fill();
}

// ------------------------------------------------------------ armes (repère local : vers +x)

/** Blaster de Flux. */
export function blaster(ctx: CanvasRenderingContext2D, L: number): void {
  inked(ctx, '#3a4058', () => ctx.roundRect(-L * 0.15, -L * 0.2, L, L * 0.4, L * 0.14), 1.6);
  ctx.fillStyle = '#ff9a3c';
  ctx.fillRect(L * 0.15, -L * 0.06, L * 0.5, L * 0.12);
}

/** Canon sonique de Tempo : corps + pavillon qui pulse. */
export function sonicCannon(ctx: CanvasRenderingContext2D, L: number, aura: string, pulse = 0): void {
  inked(ctx, '#3a4160', () => ctx.roundRect(-L * 0.2, -L * 0.16, L * 0.85, L * 0.32, L * 0.1), 1.8);
  ctx.fillStyle = aura;
  ctx.fillRect(0, -L * 0.05, L * 0.5, L * 0.1);
  const s = 1 + pulse * 0.25;
  inked(ctx, '#565e7a', () => {
    ctx.moveTo(L * 0.6, -L * 0.13);
    ctx.lineTo(L * 0.95, -L * 0.27 * s);
    ctx.lineTo(L * 0.95, L * 0.27 * s);
    ctx.lineTo(L * 0.6, L * 0.13);
    ctx.closePath();
  }, 1.8);
  inked(ctx, aura, () => ctx.ellipse(L * 0.96, 0, L * 0.06, L * 0.24 * s, 0, 0, TAU), 1.4);
}

/**
 * Pistolet à eau de Turty : corps gris, bouteille d'eau transparente en guise de réservoir,
 * embout et bagues orange.
 */
export function waterGun(ctx: CanvasRenderingContext2D, L: number): void {
  inked(ctx, '#aab4c2', () => ctx.roundRect(-L * 0.15, -L * 0.13, L * 0.95, L * 0.26, L * 0.1), 1.8);
  inked(ctx, 'rgba(150,225,240,0.85)', () => ctx.roundRect(L * 0.02, -L * 0.2, L * 0.5, L * 0.4, L * 0.16), 1.6);
  ctx.fillStyle = 'rgba(80,190,220,0.8)';
  ctx.fillRect(L * 0.06, -L * 0.04, L * 0.42, L * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(L * 0.1, -L * 0.15, L * 0.3, L * 0.05);
  inked(ctx, '#f07a28', () => ctx.roundRect(L * 0.5, -L * 0.15, L * 0.08, L * 0.3, L * 0.03), 1.2);
  inked(ctx, '#f07a28', () => ctx.roundRect(L * 0.76, -L * 0.08, L * 0.28, L * 0.16, L * 0.05), 1.4);
}

/** Marteau de Rempart : manche en bois, grosse tête d'acier. */
export function rempartHammer(ctx: CanvasRenderingContext2D, L: number, head: number): void {
  inked(ctx, '#6b4a32', () => ctx.roundRect(-head * 0.1, -head * 0.12, L, head * 0.24, head * 0.1), 1.6);
  inked(ctx, '#c3cfdd', () => ctx.roundRect(L - head * 0.35, -head * 0.55, head * 0.7, head * 1.1, head * 0.15), 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(L - head * 0.25, -head * 0.45, head * 0.13, head * 0.9);
}

/**
 * Marteau de Thor (d'après son croquis) : long manche d'acier avec une poignée bordeaux et un
 * pommeau, grosse tête en bloc aux angles coupés, runes bleues lumineuses.
 */
export function thorHammer(ctx: CanvasRenderingContext2D, L: number, head: number, glow = '#7fe0ff'): void {
  inked(ctx, '#8a95a3', () => ctx.roundRect(-head * 0.05, -head * 0.1, L, head * 0.2, head * 0.08), 1.6);
  inked(ctx, '#7a2e2e', () => ctx.roundRect(head * 0.1, -head * 0.13, L * 0.45, head * 0.26, head * 0.1), 1.4);
  inked(ctx, '#9aa6b4', () => ctx.arc(-head * 0.08, 0, head * 0.16, 0, TAU), 1.4);
  const w = head * 0.72;
  const h = head * 1.15;
  const c = head * 0.16;
  const x0 = L - w * 0.45;
  inked(ctx, '#9fb3c8', () => {
    ctx.moveTo(x0 + c, -h / 2);
    ctx.lineTo(x0 + w - c, -h / 2);
    ctx.lineTo(x0 + w, -h / 2 + c);
    ctx.lineTo(x0 + w, h / 2 - c);
    ctx.lineTo(x0 + w - c, h / 2);
    ctx.lineTo(x0 + c, h / 2);
    ctx.lineTo(x0, h / 2 - c);
    ctx.lineTo(x0, -h / 2 + c);
    ctx.closePath();
  }, 2);
  ctx.fillStyle = '#6f849c';
  ctx.fillRect(x0 + w * 0.2, -h * 0.4, w * 0.6, h * 0.8);
  // Runes lumineuses
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = head * 0.5;
  ctx.strokeStyle = glow;
  ctx.lineWidth = Math.max(1.2, head * 0.07);
  ctx.lineJoin = 'miter';
  const mx = x0 + w / 2;
  ctx.beginPath();
  ctx.moveTo(mx - w * 0.15, -h * 0.3);
  ctx.lineTo(mx + w * 0.12, -h * 0.08);
  ctx.lineTo(mx - w * 0.12, h * 0.08);
  ctx.lineTo(mx + w * 0.15, h * 0.3);
  ctx.moveTo(mx - w * 0.18, -h * 0.05);
  ctx.lineTo(mx + w * 0.18, -h * 0.05);
  ctx.stroke();
  ctx.restore();
}

/**
 * Planche du Skater vue de dessus, centrée, axe x = longueur. Dessus : grip noir et bord en
 * bois, roues orange qui dépassent ; dessous (quand il frappe avec) : bois peint (graffiti).
 */
export function deck(ctx: CanvasRenderingContext2D, L: number, W: number, side: 'top' | 'bottom' = 'top'): void {
  for (const x of [-L * 0.3, L * 0.3]) for (const y of [-W * 0.6, W * 0.6]) inked(ctx, '#e8893a', () => ctx.ellipse(x, y, W * 0.22, W * 0.15, 0, 0, TAU), 1.2);
  inked(ctx, '#c08a55', () => ctx.roundRect(-L / 2, -W / 2, L, W, W / 2), 2);
  if (side === 'top') {
    ctx.fillStyle = '#26262b';
    ctx.beginPath();
    ctx.roundRect(-L / 2 + W * 0.12, -W / 2 + W * 0.12, L - W * 0.24, W * 0.76, W * 0.38);
    ctx.fill();
    ctx.fillStyle = '#3a3a42';
    for (const x of [-L * 0.3, L * 0.3]) {
      ctx.beginPath();
      ctx.arc(x, -W * 0.18, W * 0.05, 0, TAU);
      ctx.arc(x, W * 0.18, W * 0.05, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, W / 2);
    ctx.clip();
    for (const [x, color] of [[-0.35, '#d94a4a'], [-0.1, '#3a6fd9'], [0.12, '#f2c94c'], [0.32, '#7a4bd1']] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(L * x, -W / 2, L * 0.14, W);
    }
    ctx.restore();
  }
}

/**
 * Carapace ronde de Turty : écailles sombres couvertes d'autocollants et de tags, bordure
 * orange. `spin` fait tourner le motif (carapace qui tourne sur elle-même).
 */
export function turtyShell(ctx: CanvasRenderingContext2D, R: number, spin = 0): void {
  inked(ctx, '#d0742d', () => ctx.arc(0, 0, R, 0, TAU), 2.2);
  ctx.save();
  ctx.rotate(spin);
  inked(ctx, '#2f5f63', () => ctx.arc(0, 0, R * 0.84, 0, TAU), 1.6);
  ctx.strokeStyle = '#1f4245';
  ctx.lineWidth = R * 0.07;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const x = Math.cos(a) * R * 0.38;
    const y = Math.sin(a) * R * 0.38;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.38, Math.sin(a) * R * 0.38);
    ctx.lineTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82);
    ctx.stroke();
  }
  // Autocollants et tags
  const stickers: [number, number, number, string, number][] = [
    [0.55, 0.5, 0.2, '#ff5fa2', 0.3],
    [-0.5, 0.45, 0.17, '#f07a28', -0.4],
    [0.1, -0.6, 0.18, '#a66bff', 0.8],
    [-0.6, -0.35, 0.14, '#ffd34d', 0.1],
    [0.0, 0.05, 0.16, '#5fd6ea', -0.2],
  ];
  for (const [x, y, s, color, rot] of stickers) {
    ctx.save();
    ctx.translate(x * R, y * R);
    ctx.rotate(rot);
    inked(ctx, color, () => ctx.roundRect(-s * R, -s * R * 0.62, s * R * 2, s * R * 1.24, s * R * 0.4), 1.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = R * 0.035;
    ctx.beginPath();
    ctx.moveTo(-s * R * 0.6, s * R * 0.1);
    ctx.quadraticCurveTo(-s * R * 0.2, -s * R * 0.4, 0, s * R * 0.1);
    ctx.quadraticCurveTo(s * R * 0.2, s * R * 0.4, s * R * 0.6, -s * R * 0.1);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Ombre au sol (décalée, lumière fixe) et liseré aux couleurs de l'équipe autour de la tête. */
export function drawTeamMarker(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, team: string, lift = 0): void {
  const k = Math.max(0.5, 1 - lift / 80);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.arc(x + 2 + lift * 0.25, y + 3 + lift * 0.35, (R + 1) * k, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = team;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, R + 3.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Pièces d'équipement lancées par le Skater, vues de dessus (rayon `r`) : 0 casque violet,
 * 1 genouillère, 2 coudière, 3 protège-poignet ; liseré aux couleurs de l'équipe.
 */
export function skaterGear(ctx: CanvasRenderingContext2D, index: number, r: number, team: string): void {
  ctx.strokeStyle = team;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.25, 0, TAU);
  ctx.stroke();
  if (index === 0) {
    // Casque : dôme violet, bandes blanches, aérations
    inked(ctx, '#7b4fd6', () => ctx.arc(0, 0, r, 0, TAU), 2);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.2);
    ctx.lineTo(r * 0.8, -r * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#2a1a5c';
    for (const x of [-0.45, 0, 0.45]) {
      ctx.beginPath();
      ctx.ellipse(x * r, r * 0.35, r * 0.12, r * 0.2, 0, 0, TAU);
      ctx.fill();
    }
  } else if (index === 3) {
    // Protège-poignet : anneau noir avec sangle grise
    inked(ctx, '#2a2a30', () => {
      ctx.arc(0, 0, r * 0.95, 0, TAU);
      ctx.arc(0, 0, r * 0.5, 0, TAU, true);
    }, 2);
    inked(ctx, '#9aa6b4', () => ctx.roundRect(-r * 0.2, -r * 1.0, r * 0.4, r * 0.5, r * 0.1), 1.4);
  } else {
    // Genouillère (grande) / coudière (petite) : coque grise sur un rembourrage noir
    const k = index === 1 ? 1 : 0.8;
    inked(ctx, '#2a2a30', () => ctx.ellipse(0, 0, r * k, r * 0.85 * k, 0, 0, TAU), 2);
    inked(ctx, '#aab4c2', () => ctx.ellipse(0, 0, r * 0.6 * k, r * 0.5 * k, 0, 0, TAU), 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.15 * k, -r * 0.15 * k, r * 0.2 * k, r * 0.12 * k, -0.5, 0, TAU);
    ctx.fill();
  }
}

// ------------------------------------------------------------ Camellia (archange) et petits anges

/** Palette de Camellia (d'après son concept) : cheveux rose crevette, or, plumes blanches. */
export const CAMELLIA = {
  skin: '#efcfaa',
  hair: '#f2606e',
  hairDark: '#c23a50',
  hairLight: '#ff9aa4',
  gold: '#f2c14e',
  goldDark: '#b9862a',
  halo: '#ffe066',
  feather: '#fbfaff',
  featherShade: '#d6d9ee',
  wrap: '#f4ecdc',
} as const;

/**
 * Une aile vue de dessus (côté +y ; `side` = -1 pour l'autre). Elle part de l'épaule, s'étend
 * sur le côté et vers l'arrière : rémiges longues en éventail, puis le bras de l'aile couvert de
 * petites plumes en écailles. `open` : 1 = déployée, 0 = repliée le long du dos.
 */
export function angelWing(ctx: CanvasRenderingContext2D, R: number, side: number, open = 1): void {
  ctx.save();
  ctx.scale(1, side);
  // Repliée : l'aile pivote autour de l'épaule et se range vers l'arrière.
  ctx.translate(-R * 0.15, R * 0.7);
  ctx.rotate((1 - open) * 0.95);
  ctx.translate(R * 0.15, -R * 0.7);
  // Rémiges : du corps (vers l'arrière) jusqu'au bout de l'aile (vers l'extérieur).
  const n = 7;
  for (let i = n - 1; i >= 0; i--) {
    const u = i / (n - 1);
    const bx = -R * (0.3 + u * 0.25);
    const by = R * (0.95 + u * 1.75);
    const a = Math.PI - u * 0.85;
    const len = R * (1.05 + u * 0.55);
    const cx = bx + Math.cos(a) * len * 0.5;
    const cy = by + Math.sin(a) * len * 0.5;
    inked(ctx, i % 2 ? CAMELLIA.feather : '#f1f2fb', () => ctx.ellipse(cx, cy, len * 0.55, R * 0.24, a, 0, TAU), 1.6);
    ctx.strokeStyle = CAMELLIA.featherShade;
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(cx + Math.cos(a) * len * 0.4, cy + Math.sin(a) * len * 0.4);
    ctx.stroke();
  }
  // Bras de l'aile (couvertures) : bord d'attaque arrondi, de l'épaule jusqu'au bout.
  inked(ctx, CAMELLIA.feather, () => {
    ctx.moveTo(-R * 0.35, R * 0.55);
    ctx.quadraticCurveTo(R * 0.35, R * 1.2, R * 0.05, R * 2.3);
    ctx.quadraticCurveTo(-R * 0.15, R * 2.95, -R * 0.65, R * 2.95);
    ctx.quadraticCurveTo(-R * 0.85, R * 2.2, -R * 0.75, R * 1.5);
    ctx.quadraticCurveTo(-R * 0.7, R * 0.9, -R * 0.35, R * 0.55);
    ctx.closePath();
  }, 1.8);
  // Petites plumes en écailles
  ctx.strokeStyle = CAMELLIA.featherShade;
  ctx.lineWidth = R * 0.06;
  for (const [x, y] of [[-0.2, 1.05], [-0.15, 1.55], [-0.2, 2.05], [-0.38, 2.5], [-0.5, 1.3], [-0.5, 1.85]] as const) {
    ctx.beginPath();
    ctx.arc(x * R, y * R, R * 0.2, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Longs cheveux lisses rose crevette, dessous (avant la tête) : la masse qui tombe dans le dos,
 * entre les ailes, en mèches droites effilées.
 */
export function camelliaHairBack(ctx: CanvasRenderingContext2D, R: number): void {
  // Une seule nappe lisse qui s'affine vers le bas du dos et finit en pointe douce.
  inked(ctx, CAMELLIA.hair, () => {
    ctx.moveTo(-R * 0.2, -R * 0.97);
    ctx.bezierCurveTo(-R * 1.0, -R * 0.98, -R * 1.6, -R * 0.62, -R * 2.2, -R * 0.3);
    ctx.quadraticCurveTo(-R * 2.55, -R * 0.05, -R * 2.6, R * 0.05);
    ctx.quadraticCurveTo(-R * 2.45, R * 0.12, -R * 2.2, R * 0.3);
    ctx.bezierCurveTo(-R * 1.6, R * 0.62, -R * 1.0, R * 0.98, -R * 0.2, R * 0.97);
    ctx.closePath();
  }, 2);
  // Mèches droites qui convergent vers la pointe, un reflet clair au milieu.
  ctx.strokeStyle = CAMELLIA.hairDark;
  ctx.lineWidth = R * 0.055;
  for (const s of [-0.55, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(-R * 1.0, s * R);
    ctx.quadraticCurveTo(-R * 1.7, s * R * 0.62, -R * 2.3, s * R * 0.12);
    ctx.stroke();
  }
  ctx.strokeStyle = CAMELLIA.hairLight;
  ctx.lineWidth = R * 0.09;
  ctx.beginPath();
  ctx.moveTo(-R * 1.05, -R * 0.12);
  ctx.quadraticCurveTo(-R * 1.6, -R * 0.1, -R * 2.05, -R * 0.02);
  ctx.stroke();
}

/** Dessus des cheveux, mèche qui retombe devant un œil. */
export function camelliaHairTop(ctx: CanvasRenderingContext2D, R: number): void {
  classicHair(ctx, R, CAMELLIA.hair, CAMELLIA.hairDark, 0.48);
  // Mèche devant (sur le côté du visage, comme sur le concept)
  inked(ctx, CAMELLIA.hair, () => {
    ctx.moveTo(R * 0.15, -R * 0.75);
    ctx.quadraticCurveTo(R * 0.75, -R * 0.55, R * 0.92, -R * 0.05);
    ctx.quadraticCurveTo(R * 0.55, -R * 0.3, R * 0.2, -R * 0.35);
    ctx.closePath();
  }, 1.6);
  ctx.strokeStyle = CAMELLIA.hairLight;
  ctx.lineWidth = R * 0.06;
  ctx.beginPath();
  ctx.moveTo(-R * 0.05, R * 0.4);
  ctx.quadraticCurveTo(-R * 0.4, R * 0.55, -R * 0.75, R * 0.45);
  ctx.stroke();
}

/** Épaulières dorées (sous la tête : elles dépassent sur les côtés). */
export function goldPauldrons(ctx: CanvasRenderingContext2D, R: number): void {
  for (const s of [-1, 1]) {
    inked(ctx, CAMELLIA.gold, () => ctx.ellipse(-R * 0.15, s * R * 0.92, R * 0.42, R * 0.3, 0, 0, TAU), 1.8);
    ctx.strokeStyle = CAMELLIA.goldDark;
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.ellipse(-R * 0.15, s * R * 0.92, R * 0.25, R * 0.16, 0, 0, TAU);
    ctx.stroke();
  }
}

/** Auréole dorée flottant au-dessus de la tête (anneau lumineux, lueur douce). */
export function halo(ctx: CanvasRenderingContext2D, r: number, width: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,230,120,0.3)';
  ctx.lineWidth = width * 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = CAMELLIA.goldDark;
  ctx.lineWidth = width + 1.6;
  ctx.stroke();
  ctx.strokeStyle = CAMELLIA.halo;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = width * 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
}

/** Plume (projectile, plumes qui tombent) : pointe vers +x, longueur `L`. */
export function feather(ctx: CanvasRenderingContext2D, L: number, tip: string = CAMELLIA.gold): void {
  inked(ctx, CAMELLIA.feather, () => {
    ctx.moveTo(L * 0.5, 0);
    ctx.quadraticCurveTo(L * 0.1, -L * 0.24, -L * 0.45, -L * 0.1);
    ctx.lineTo(-L * 0.38, 0);
    ctx.lineTo(-L * 0.45, L * 0.1);
    ctx.quadraticCurveTo(L * 0.1, L * 0.24, L * 0.5, 0);
    ctx.closePath();
  }, Math.max(1, L * 0.08));
  ctx.strokeStyle = tip;
  ctx.lineWidth = Math.max(1, L * 0.08);
  ctx.beginPath();
  ctx.moveTo(-L * 0.55, 0);
  ctx.lineTo(L * 0.42, 0);
  ctx.stroke();
}

/**
 * Petit ange de Camellia, vu de dessus (regard vers +x) : boule aux couleurs de l'équipe vue par
 * le joueur (`team` : bleu pour une Camellia alliée, rouge pour une adverse), petites ailes
 * blanches qui battent (`flap` : -1..1), mini-auréole dorée.
 */
export function littleAngel(ctx: CanvasRenderingContext2D, r: number, flap: number, team: string): void {
  // Ailes (dessinées à chaque fois : elles battent)
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(-r * 0.15, s * r * 0.75);
    ctx.rotate(s * (0.3 + flap * 0.4));
    ctx.scale(1.35, 1.35);
    inked(ctx, CAMELLIA.feather, () => {
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 0.55, s * r * 1.15, -r * 0.1, s * r * 1.75);
      ctx.quadraticCurveTo(-r * 0.4, s * r * 1.45, -r * 0.65, s * r * 1.55);
      ctx.quadraticCurveTo(-r * 0.8, s * r * 1.2, -r * 1.0, s * r * 1.2);
      ctx.quadraticCurveTo(-r * 0.8, s * r * 0.6, 0, 0);
      ctx.closePath();
    }, 1.1);
    ctx.restore();
  }
  cached(ctx, `angel.body|${r}|${team}`, r * 1.9, (c) => {
    // Lueur douce, puis la boule aux couleurs de l'équipe
    c.globalAlpha = 0.3;
    c.fillStyle = team;
    c.beginPath();
    c.arc(0, 0, r * 1.3, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    inked(c, team, () => c.arc(0, 0, r, 0, TAU), 1.8);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath();
    c.arc(r * 0.2, 0, r * 0.62, 0, TAU);
    c.fill();
    shade(c, 0, 0, r, 0, 0.18);
    // Petite auréole qui flotte au-dessus de la nuque (elle dépasse derrière la tête) : anneau
    // blanc cerné d'or, bien distinct de la tête jaune.
    for (const [color, w] of [[LINE, 0.34], [CAMELLIA.halo, 0.22], ['#ffffff', 0.08]] as const) {
      c.strokeStyle = color;
      c.lineWidth = r * w;
      c.beginPath();
      c.ellipse(-r * 0.75, 0, r * 0.32, r * 0.5, 0, 0, TAU);
      c.stroke();
    }
  });
}
