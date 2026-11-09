import { PLAYER_SPAWN, WORLD } from '../config';
import type { Vec2 } from '../core/math';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import type { TKey } from '../i18n';
import type { Rect, Segment, WallRect, Zone } from './Arena';

/** Zone de spawn protégée : invincibilité + soin pour son équipe, interdite à l'adversaire. */
export interface SafeZone {
  team: Team;
  rect: Rect;
  /** Portes de sortie (traits jaunes au sol). */
  doors: Segment[];
}

/** Salle de spawn : zone protégée, portes et points d'apparition. */
export interface SpawnRoom {
  rect: Rect;
  doors: Segment[];
  points: Vec2[];
}

/** Escorte : parcours du convoi et salles de spawn qui changent avec la progression. */
export interface EscortDef {
  /** Points de passage du convoi, du départ (A) à l'arrivée (B). */
  path: Vec2[];
  /** Indice du point de passage qui sert de checkpoint. */
  checkpoint: number;
  rooms: {
    /** Départ (attaque, phase 1). */
    start: SpawnRoom;
    /** Milieu (défense en phase 1, attaque en phase 2). */
    mid: SpawnRoom;
    /** Arrivée (défense, phase 2). */
    end: SpawnRoom;
  };
}

/** Point de contrôle (cercle). */
export interface ControlPointDef {
  x: number;
  y: number;
  r: number;
}

/**
 * Forme arrondie dessinée telle quelle par le thème (ses collisions sont générées à part) :
 * - pit : fosse de lave = rectangles `outer` moins le disque de centre (x, y) et de rayon r ;
 * - arc : mur en arc de cercle (couronne entre rIn et rOut, de l'angle a0 à a1) ;
 * - plates : sol de tôle (camp).
 */
export type MapShape =
  | { kind: 'pit'; outer: Rect[]; x: number; y: number; r: number }
  | { kind: 'arc'; x: number; y: number; rIn: number; rOut: number; a0: number; a1: number }
  | { kind: 'plates'; rect: Rect };

/** Élément de décor dessiné par le thème de la carte (cuves, héliports...). */
export interface Decor {
  kind: 'tank' | 'helipad';
  x: number;
  y: number;
  r: number;
}

export interface MapDef {
  id: string;
  nameKey: TKey;
  /** Mode de jeu de la carte et courte description (sélection de carte). */
  modeKey: TKey;
  descKey: TKey;
  width: number;
  height: number;
  walls: WallRect[];
  /** Eau : infranchissable, mais on voit et on tire par-dessus. */
  water?: Rect[];
  /** Lave : infranchissable en marchant, mortelle si un recul y projette un héros. */
  lava?: Rect[];
  /** Habillage propre à la carte (src/world/themes). Sans thème : rendu par défaut. */
  theme?: 'volcano';
  decor?: Decor[];
  /** Formes arrondies du décor (fosses, arcs...), dessinées par le thème. */
  shapes?: MapShape[];
  zones: Zone[];
  safeZones: SafeZone[];
  /** Points d'apparition par équipe. */
  spawns: Record<Team, Vec2[]>;
  control?: ControlPointDef;
  escort?: EscortDef;
  /** Packs de soin (+200 PV). */
  healthPacks: Vec2[];
  /** Points de passage pour l'IA (couloirs, portes...). Les liaisons sont calculées automatiquement. */
  nav: Vec2[];
  /** Marqueur de spawn peint au sol (champ de tir). */
  spawnMarker?: Vec2;
}

// ------------------------------------------------------------------ champ de tir

export const PRACTICE_MAP: MapDef = {
  id: 'practice',
  nameKey: 'menu.practice',
  modeKey: 'menu.practice',
  descKey: 'menu.practice.desc',
  width: WORLD.width,
  height: WORLD.height,
  walls: [
    { x: 560, y: 200, w: 50, h: 360 }, // A : couvert gauche haut
    { x: 560, y: 760, w: 50, h: 340 }, // B : couvert gauche bas (passage y 560-760 entre A et B)
    { x: 880, y: 400, w: 280, h: 50 }, // C : salle centrale, mur haut
    { x: 880, y: 850, w: 280, h: 50 }, // D : salle centrale, mur bas
    { x: 1110, y: 450, w: 50, h: 140 }, // E : salle centrale, droite (haut)
    { x: 1110, y: 710, w: 50, h: 140 }, // F : salle centrale, droite (bas) → porte y 590-710
    { x: 1450, y: 170, w: 320, h: 50 }, // G : barre haute droite
    { x: 1450, y: 1080, w: 320, h: 50 }, // H : barre basse droite
    { x: 1760, y: 480, w: 50, h: 340 }, // I : mur du fond (idéal pour épingler à la Charge)
  ],
  zones: [
    { kind: 'hazard', x: 110, y: 110, w: 220, h: 170 },
    { kind: 'heal', x: 110, y: 1020, w: 220, h: 170 },
  ],
  safeZones: [],
  spawns: { [ALLY]: [PLAYER_SPAWN] },
  healthPacks: [],
  nav: [],
  spawnMarker: PLAYER_SPAWN,
};

// ------------------------------------------------------------------ Sanctuaire

/**
 * SANCTUAIRE (Control) — carte originale, symétrique par rotation de 180° autour
 * du point central : chaque équipe a exactement le même terrain.
 *
 * - Chaque spawn (bords gauche et droit) s'ouvre par deux portes protégées par un couvert.
 * - Trois voies mènent à la salle centrale : couloir nord, hall central, couloir sud.
 * - La salle centrale abrite le point (cercle) avec deux piliers et deux packs de soin ;
 *   elle a six portes (deux par côté, une au nord, une au sud).
 * - Packs de soin aussi dans les recoins en L près des spawns.
 *
 * On décrit la moitié gauche (+ le haut de la salle centrale) ; l'autre moitié
 * est générée par symétrie.
 */
const SW = 2800;
const SH = 1600;
const mirrorRect = (r: Rect): Rect => ({ x: SW - r.x - r.w, y: SH - r.y - r.h, w: r.w, h: r.h });
const mirrorPt = (p: Vec2): Vec2 => ({ x: SW - p.x, y: SH - p.y });
const withMirror = <T>(items: T[], mirror: (t: T) => T): T[] => [...items, ...items.map(mirror)];

const HALF_WALLS: Rect[] = [
  // Salle de spawn bleue (bord gauche) : deux portes de 110 px côté droit
  { x: 0, y: 560, w: 320, h: 40 },
  { x: 0, y: 1000, w: 320, h: 40 },
  { x: 280, y: 600, w: 40, h: 40 },
  { x: 280, y: 750, w: 40, h: 100 },
  { x: 280, y: 960, w: 40, h: 40 },
  // Couvert devant les portes du spawn
  { x: 540, y: 720, w: 50, h: 160 },
  // Recoins en L (packs de soin)
  { x: 380, y: 300, w: 340, h: 40 },
  { x: 680, y: 140, w: 40, h: 160 },
  { x: 380, y: 1260, w: 340, h: 40 },
  { x: 680, y: 1300, w: 40, h: 160 },
  // Tour nord-ouest (accolée à la salle centrale)
  { x: 900, y: 200, w: 150, h: 40 },
  { x: 1010, y: 240, w: 40, h: 210 },
  // Couvert sud-ouest
  { x: 880, y: 1200, w: 140, h: 40 },
  // Salle centrale : mur ouest (portes y 560-680 et 920-1040)
  { x: 1050, y: 450, w: 40, h: 110 },
  { x: 1050, y: 680, w: 40, h: 240 },
  { x: 1050, y: 1040, w: 40, h: 110 },
  // Salle centrale : mur nord (porte x 1250-1370) — le mur sud est son symétrique
  { x: 1090, y: 450, w: 160, h: 40 },
  { x: 1370, y: 450, w: 340, h: 40 },
  // Pilier à côté du point
  { x: 1180, y: 760, w: 40, h: 80 },
  // Bloc dans le couloir nord
  { x: 1300, y: 180, w: 100, h: 60 },
];

const HALF_NAV: Vec2[] = [
  { x: 150, y: 695 }, // spawn, face à chaque porte
  { x: 150, y: 905 },
  { x: 380, y: 695 }, // sorties du spawn
  { x: 380, y: 905 },
  { x: 460, y: 450 },
  { x: 460, y: 1150 },
  { x: 700, y: 620 },
  { x: 700, y: 980 },
  { x: 980, y: 620 }, // devant les portes ouest de la salle centrale
  { x: 980, y: 980 },
  { x: 1140, y: 620 }, // juste derrière ces portes
  { x: 1140, y: 980 },
  { x: 860, y: 400 },
  { x: 800, y: 100 },
  { x: 1150, y: 110 },
  { x: 1310, y: 350 }, // devant la porte nord
  { x: 1310, y: 560 }, // derrière la porte nord
  { x: 560, y: 220 }, // recoins (soin) et leurs accès
  { x: 300, y: 220 },
  { x: 300, y: 420 },
  { x: 560, y: 70 },
  { x: 560, y: 1380 },
  { x: 300, y: 1380 },
  { x: 300, y: 1180 },
  { x: 560, y: 1530 },
  { x: 860, y: 1320 },
  { x: 1150, y: 1300 },
];

const blueSpawns: Vec2[] = [
  { x: 110, y: 700 },
  { x: 110, y: 900 },
  { x: 200, y: 800 },
];
const blueSafe: SafeZone = {
  team: ALLY,
  rect: { x: 0, y: 600, w: 280, h: 400 },
  doors: [
    { ax: 300, ay: 640, bx: 300, by: 750 },
    { ax: 300, ay: 850, bx: 300, by: 960 },
  ],
};
const mirrorSeg = (s: Segment): Segment => {
  const a = mirrorPt({ x: s.ax, y: s.ay });
  const b = mirrorPt({ x: s.bx, y: s.by });
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
};

export const SANCTUARY_MAP: MapDef = {
  id: 'sanctuary',
  nameKey: 'map.sanctuary',
  modeKey: 'mode.control',
  descKey: 'map.sanctuary.desc',
  width: SW,
  height: SH,
  walls: withMirror(HALF_WALLS, mirrorRect),
  zones: [],
  safeZones: [
    blueSafe,
    { team: ENEMY, rect: mirrorRect(blueSafe.rect), doors: blueSafe.doors.map(mirrorSeg) },
  ],
  spawns: { [ALLY]: blueSpawns, [ENEMY]: blueSpawns.map(mirrorPt) },
  control: { x: SW / 2, y: SH / 2, r: 170 },
  healthPacks: withMirror(
    [
      { x: 560, y: 220 },
      { x: 560, y: 1380 },
      { x: 1130, y: 800 },
    ],
    mirrorPt,
  ),
  nav: [...withMirror(HALF_NAV, mirrorPt), { x: SW / 2, y: SH / 2 }],
};

// ------------------------------------------------------------------ Route 66

/**
 * ROUTE 66 (Escorte) — carte originale.
 * - Le convoi part du sud-ouest (A), longe une place, traverse le canal par le pont
 *   (passage obligé), passe le checkpoint, tourne dans les rues et finit au nord-est (B).
 * - Contournements : passerelle à l'ouest du pont, rue et passage étroit à l'est.
 * - Le spawn du milieu est caché derrière le virage : ses portes donnent au nord,
 *   à l'opposé du pont par lequel arrivent les attaquants.
 * - L'eau bloque les déplacements mais pas la vue ni les tirs : on se couvre d'une rive à l'autre.
 */
const R66_ROOMS: EscortDef['rooms'] = {
  start: {
    rect: { x: 0, y: 1950, w: 300, h: 400 },
    doors: [
      { ax: 320, ay: 2000, bx: 320, by: 2120 },
      { ax: 320, ay: 2190, bx: 320, by: 2310 },
    ],
    points: [
      { x: 140, y: 2060 },
      { x: 140, y: 2250 },
      { x: 220, y: 2150 },
    ],
  },
  mid: {
    rect: { x: 900, y: 560, w: 340, h: 300 },
    doors: [
      { ax: 940, ay: 540, bx: 1050, by: 540 },
      { ax: 1090, ay: 540, bx: 1200, by: 540 },
    ],
    points: [
      { x: 980, y: 700 },
      { x: 1160, y: 700 },
      { x: 1070, y: 800 },
    ],
  },
  end: {
    rect: { x: 2990, y: 200, w: 210, h: 400 },
    doors: [
      { ax: 2970, ay: 230, bx: 2970, by: 340 },
      { ax: 2970, ay: 400, bx: 2970, by: 510 },
    ],
    points: [
      { x: 3090, y: 285 },
      { x: 3090, y: 455 },
      { x: 3140, y: 370 },
    ],
  },
};

export const ROUTE66_MAP: MapDef = {
  id: 'route66',
  nameKey: 'map.route66',
  modeKey: 'mode.escort',
  descKey: 'map.route66.desc',
  width: 3200,
  height: 2400,
  walls: [
    // Spawn A (départ) : sud-ouest, deux portes vers le convoi
    { x: 0, y: 1910, w: 340, h: 40 },
    { x: 0, y: 2350, w: 340, h: 50 },
    { x: 300, y: 1950, w: 40, h: 50 },
    { x: 300, y: 2120, w: 40, h: 70 },
    { x: 300, y: 2310, w: 40, h: 40 },
    // Blocs du sud
    { x: 0, y: 1300, w: 340, h: 610 },
    { x: 640, y: 1900, w: 420, h: 500 },
    { x: 1060, y: 1600, w: 2140, h: 800 },
    // Couverts : place sud, rue est
    { x: 520, y: 1400, w: 80, h: 80 },
    { x: 2000, y: 1320, w: 120, h: 60 },
    { x: 2400, y: 1500, w: 60, h: 100 },
    // Passage est (étroit, au bout du canal)
    { x: 2900, y: 1050, w: 300, h: 250 },
    // Blocs du nord
    { x: 0, y: 0, w: 1960, h: 300 },
    { x: 0, y: 300, w: 500, h: 100 },
    { x: 1970, y: 0, w: 1230, h: 200 },
    // Place nord-ouest
    { x: 200, y: 600, w: 300, h: 200 },
    { x: 650, y: 700, w: 80, h: 80 },
    // Spawn du milieu : murs pleins côté pont, portes au nord
    { x: 860, y: 520, w: 40, h: 380 },
    { x: 860, y: 860, w: 420, h: 40 },
    { x: 1240, y: 520, w: 40, h: 340 },
    { x: 900, y: 520, w: 40, h: 40 },
    { x: 1050, y: 520, w: 40, h: 40 },
    { x: 1200, y: 520, w: 40, h: 40 },
    // Bâtiments le long du parcours nord
    { x: 1660, y: 820, w: 560, h: 230 },
    { x: 1640, y: 300, w: 330, h: 220 },
    // Place finale : couvert
    { x: 2300, y: 560, w: 200, h: 160 },
    // Spawn B (arrivée) : deux portes vers le point final
    { x: 2950, y: 600, w: 250, h: 40 },
    { x: 2950, y: 200, w: 40, h: 30 },
    { x: 2950, y: 340, w: 40, h: 60 },
    { x: 2950, y: 510, w: 40, h: 90 },
  ],
  water: [
    { x: 0, y: 1050, w: 500, h: 250 },
    { x: 650, y: 1050, w: 730, h: 250 }, // passerelle ouest : x 500-650
    { x: 1620, y: 1050, w: 1080, h: 250 }, // pont : x 1380-1620
  ],
  zones: [],
  safeZones: [],
  spawns: {},
  escort: {
    path: [
      { x: 480, y: 2150 }, // A
      { x: 480, y: 1750 },
      { x: 900, y: 1750 },
      { x: 900, y: 1450 },
      { x: 1500, y: 1450 },
      { x: 1500, y: 850 }, // checkpoint, juste après le pont
      { x: 1500, y: 650 },
      { x: 2100, y: 650 },
      { x: 2100, y: 350 },
      { x: 2850, y: 350 }, // B
    ],
    checkpoint: 5,
    rooms: R66_ROOMS,
  },
  healthPacks: [
    { x: 420, y: 1380 },
    { x: 980, y: 980 },
    { x: 2300, y: 1450 },
    { x: 720, y: 480 },
    { x: 2450, y: 950 },
    { x: 2800, y: 700 },
  ],
  nav: [
    // spawn A
    { x: 150, y: 2060 },
    { x: 150, y: 2250 },
    { x: 400, y: 2060 },
    { x: 400, y: 2250 },
    // parcours
    { x: 480, y: 1980 },
    { x: 480, y: 1750 },
    { x: 700, y: 1750 },
    { x: 900, y: 1750 },
    { x: 900, y: 1450 },
    { x: 1200, y: 1450 },
    { x: 1500, y: 1450 },
    { x: 1500, y: 1180 },
    { x: 1500, y: 950 },
    { x: 1500, y: 700 },
    { x: 1500, y: 420 },
    { x: 1800, y: 650 },
    { x: 2100, y: 650 },
    { x: 2100, y: 350 },
    { x: 2450, y: 350 },
    { x: 2850, y: 350 },
    // place sud, passerelle ouest, place nord-ouest
    { x: 430, y: 1520 },
    { x: 700, y: 1400 },
    { x: 575, y: 1180 },
    { x: 575, y: 950 },
    { x: 430, y: 900 },
    { x: 700, y: 600 },
    { x: 720, y: 450 },
    // autour du spawn du milieu
    { x: 995, y: 420 },
    { x: 1145, y: 420 },
    { x: 1320, y: 420 },
    { x: 995, y: 620 },
    { x: 1145, y: 620 },
    { x: 1070, y: 780 },
    { x: 1100, y: 975 },
    { x: 800, y: 975 },
    { x: 1330, y: 700 },
    // spawn B et place finale
    { x: 2900, y: 285 },
    { x: 2900, y: 455 },
    { x: 3090, y: 285 },
    { x: 3090, y: 455 },
    { x: 2600, y: 700 },
    { x: 2900, y: 800 },
    // contournement est
    { x: 2450, y: 900 },
    { x: 2800, y: 950 },
    { x: 2800, y: 1180 },
    { x: 2800, y: 1450 },
    { x: 2300, y: 1450 },
    { x: 1900, y: 1450 },
    { x: 1700, y: 1450 },
  ],
};

// ------------------------------------------------------------------ Volcan

/**
 * VOLCAN (Contrôle) — carte dessinée par le joueur (croquis « Map Control Volcan ») : un camp
 * scientifique installé dans un volcan. Symétrique par rotation de 180° autour du point (même
 * terrain pour chaque équipe). On décrit la moitié nord (spawn rouge) ; le sud est généré.
 *
 * - Le spawn (laboratoire) s'ouvre par deux portes sur une cour (héliport).
 * - Couloir ouest, long et étroit, qui longe les bâtiments jusqu'à l'entrée nord du point.
 * - Côté est : un passage étroit, puis une petite salle intermédiaire (un mur au milieu, un pack
 *   de soin), puis le couloir qui descend vers la grande salle est.
 * - Le point est une plateforme au-dessus du cratère, entourée de quatre fosses de lave au bord
 *   arrondi tourné vers lui : un recul bien placé y précipite l'adversaire. Deux murs en arc de
 *   cercle couvrent ses extrémités nord et sud.
 * - Dans chaque grande salle latérale, une cuve ronde fait couvert du côté de l'équipe qui y
 *   arrive (et non du côté de ceux qui la prennent à revers).
 *
 * Les formes arrondies (fosses, arcs, cuves) sont décrites telles qu'on les voit (`shapes`) ;
 * leurs collisions sont des bandes horizontales générées à partir de ces formes.
 */
const VW = 2120;
const VH = 4200;
const VC = { x: VW / 2, y: VH / 2 };
const vRect = <T extends Rect>(r: T): T => ({ ...r, x: VW - r.x - r.w, y: VH - r.y - r.h });
const vPt = (p: Vec2): Vec2 => ({ x: VW - p.x, y: VH - p.y });
const vSeg = (s: Segment): Segment => ({ ax: VW - s.ax, ay: VH - s.ay, bx: VW - s.bx, by: VH - s.by });
const vShape = (s: MapShape): MapShape => {
  switch (s.kind) {
    case 'pit':
      return { ...s, outer: s.outer.map(vRect), ...vPt(s) };
    case 'arc':
      return { ...s, ...vPt(s), a0: s.a0 + Math.PI, a1: s.a1 + Math.PI };
    case 'plates':
      return { ...s, rect: vRect(s.rect) };
  }
};

/**
 * Bandes horizontales (hauteur `cell`) qui couvrent une forme : collisions des formes arrondies.
 * Chaque cellule est testée en son centre ; les cellules voisines d'une rangée sont fusionnées,
 * puis les rangées identiques empilées.
 */
function rasterize<T extends Rect>(inside: (x: number, y: number) => boolean, box: Rect, cell: number, extra: Omit<T, keyof Rect>): T[] {
  const out: T[] = [];
  let prev: T[] = [];
  for (let y = box.y; y < box.y + box.h; y += cell) {
    const row: T[] = [];
    let start = -1;
    for (let x = box.x; x <= box.x + box.w; x += cell) {
      const inn = x < box.x + box.w && inside(x + cell / 2, y + cell / 2);
      if (inn && start < 0) start = x;
      if (!inn && start >= 0) {
        row.push({ ...extra, x: start, y, w: x - start, h: cell } as T);
        start = -1;
      }
    }
    // Rangée identique à la précédente : on allonge les bandes du dessus.
    if (row.length && row.length === prev.length && row.every((r, i) => r.x === prev[i].x && r.w === prev[i].w)) {
      for (const r of prev) r.h += cell;
      continue;
    }
    out.push(...row);
    prev = row;
  }
  return out;
}

const inRects = (rs: Rect[], x: number, y: number) => rs.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
const bounds = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

/** Collisions d'une forme arrondie (voir MapShape). */
function shapeRects(s: MapShape): WallRect[] {
  if (s.kind === 'pit') {
    return rasterize<WallRect>((x, y) => inRects(s.outer, x, y) && Math.hypot(x - s.x, y - s.y) >= s.r, bounds(s.outer), 12, {});
  }
  if (s.kind === 'arc') {
    const inside = (x: number, y: number) => {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.rIn || d > s.rOut) return false;
      let a = Math.atan2(y - s.y, x - s.x) - s.a0;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return a <= s.a1 - s.a0;
    };
    const box = { x: s.x - s.rOut, y: s.y - s.rOut, w: s.rOut * 2, h: s.rOut * 2 };
    return rasterize<WallRect>(inside, box, 12, { style: 'arc' });
  }
  return [];
}

/** Cuve ronde : obstacle circulaire (collision en bandes). */
function tankRects(d: Decor): WallRect[] {
  const box = { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 };
  return rasterize<WallRect>((x, y) => Math.hypot(x - d.x, y - d.y) <= d.r, box, 12, { style: 'tank' });
}

/** Allongement des couloirs entre la cour du spawn et le centre (par rapport à la 1re version). */
const STRETCH = 520;
/** Fosses de lave : bord arrondi, à cette distance du centre du point. */
const PIT_R = 340;

const VOLCANO_HALF_SHAPES: MapShape[] = [
  // Fosses nord-ouest et nord-est
  { kind: 'pit', outer: [{ x: 744, y: 1612, w: 192, h: 48 }, { x: 672, y: 1660, w: 264, h: 300 }], ...VC, r: PIT_R },
  { kind: 'pit', outer: [{ x: 1128, y: 1600, w: 336, h: 324 }], ...VC, r: PIT_R },
  // Mur en arc au nord du point (le sud est généré par symétrie)
  { kind: 'arc', ...VC, rIn: 232, rOut: 262, a0: -Math.PI / 2 - 0.63, a1: -Math.PI / 2 + 0.63 },
  // Sols de tôle : laboratoire du spawn et cour
  { kind: 'plates', rect: { x: 1392, y: 24, w: 672, h: 256 } },
  { kind: 'plates', rect: { x: 1368, y: 320, w: 696, h: 480 } },
];

const VOLCANO_HALF_DECOR: Decor[] = [
  { kind: 'helipad', x: 1716, y: 560, r: 112 },
  // Cuve de la grande salle est, côté nord (là où arrive l'équipe rouge)
  { kind: 'tank', x: 1732, y: 1983, r: 80 },
];

const S = STRETCH;
const VOLCANO_HALF_WALLS: WallRect[] = [
  // Roche : tout ce qui est hors du camp (haut de la carte)
  { x: 0, y: 0, w: 1392, h: 372, style: 'rock' },
  { x: 1392, y: 0, w: 672, h: 24, style: 'rock' },
  { x: 2064, y: 0, w: 56, h: 800, style: 'rock' },
  // Laboratoire (spawn) : façade à deux portes, paillasses et console au fond
  { x: 1392, y: 280, w: 144, h: 40, style: 'lab' },
  { x: 1716, y: 280, w: 96, h: 40, style: 'lab' },
  { x: 1968, y: 280, w: 96, h: 40, style: 'lab' },
  { x: 1440, y: 24, w: 176, h: 52, style: 'lab' },
  { x: 1680, y: 24, w: 100, h: 64, style: 'lab' },
  { x: 1840, y: 24, w: 176, h: 52, style: 'lab' },
  // Couloir ouest (long et étroit) : roche à gauche, bâtiment puis roche à droite
  { x: 0, y: 372, w: 948, h: 300 + S, style: 'rock' },
  { x: 1104, y: 492, w: 264, h: 180, style: 'building' },
  { x: 1104, y: 672, w: 264, h: S, style: 'rock' },
  // Sortie de la cour vers l'est : passage étroit, puis la salle intermédiaire
  { x: 1368, y: 800, w: 268, h: 80, style: 'rock' },
  { x: 1880, y: 800, w: 64, h: 80, style: 'rock' },
  { x: 1944, y: 800, w: 176, h: 524, style: 'rock' },
  { x: 1368, y: 880, w: 152, h: 444, style: 'rock' },
  { x: 1724, y: 960, w: 88, h: 240, style: 'building' }, // mur au milieu de la salle intermédiaire
  // Au-delà : le centre de la carte (première version décalée de STRETCH vers le sud)
  { x: 0, y: 672 + S, w: 720, h: 128, style: 'rock' },
  { x: 0, y: 800 + S, w: 264, h: 316, style: 'rock' },
  { x: 0, y: 1116 + S, w: 72, h: 464, style: 'rock' },
  { x: 1848, y: 804 + S, w: 272, h: 300, style: 'rock' },
  { x: 2040, y: 1104 + S, w: 80, h: 476, style: 'rock' },
  { x: 1200, y: 672 + S, w: 168, h: 132, style: 'building' },
  { x: 1200, y: 804 + S, w: 384, h: 276, style: 'building' },
  { x: 528, y: 952 + S, w: 216, h: 80, style: 'building' },
  { x: 432, y: 1032 + S, w: 312, h: 108, style: 'building' },
  // Garde-corps des fosses (côtés fermés)
  { x: 744, y: 1068 + S, w: 216, h: 24, style: 'barrier' },
  { x: 936, y: 1092 + S, w: 24, h: 180, style: 'barrier' },
  { x: 648, y: 1140 + S, w: 24, h: 300, style: 'barrier' },
  { x: 1104, y: 1068 + S, w: 24, h: 156, style: 'barrier' },
  { x: 1128, y: 1068 + S, w: 72, h: 24, style: 'barrier' },
  { x: 1464, y: 1080 + S, w: 24, h: 324, style: 'barrier' },
  // Murs arrondis : arc du point et cuve
  ...VOLCANO_HALF_SHAPES.filter((s) => s.kind === 'arc').flatMap(shapeRects),
  ...VOLCANO_HALF_DECOR.filter((d) => d.kind === 'tank').flatMap(tankRects),
];

const VOLCANO_HALF_LAVA: Rect[] = VOLCANO_HALF_SHAPES.filter((s) => s.kind === 'pit').flatMap(shapeRects);

const VOLCANO_HALF_NAV: Vec2[] = [
  { x: 1626, y: 170 }, // labo, face aux portes
  { x: 1890, y: 170 },
  { x: 1626, y: 400 }, // cour
  { x: 1890, y: 400 },
  { x: 1716, y: 640 },
  { x: 1460, y: 432 }, // couloir ouest
  { x: 1200, y: 432 },
  { x: 1026, y: 432 },
  { x: 1026, y: 700 },
  { x: 1026, y: 1000 },
  { x: 1026, y: 760 + S },
  { x: 1760, y: 840 }, // passage est puis salle intermédiaire (autour du mur)
  { x: 1600, y: 960 },
  { x: 1880, y: 1080 },
  { x: 1600, y: 1240 },
  { x: 1880, y: 1250 },
  { x: 1716, y: 950 + S }, // couloir est
  { x: 860, y: 880 + S },
  { x: 1152, y: 940 + S },
  { x: 600, y: 880 + S },
  { x: 348, y: 900 + S },
  { x: 348, y: 1080 + S }, // passage vers la grande salle ouest
  { x: 500, y: 1250 + S },
  { x: 180, y: 1300 + S },
  { x: 180, y: 1460 + S },
  { x: 556, y: 1460 + S },
  { x: 1032, y: 1180 + S }, // entrée nord, puis autour de l'arc
  { x: 880, y: 1880 },
  { x: 1240, y: 1880 },
  { x: 1060, y: 1960 },
  { x: 840, y: 1500 + S },
  { x: 1290, y: 1460 + S },
  { x: 740, y: 1560 + S }, // entrée ouest
  { x: 1650, y: 1180 + S }, // grande salle est (autour de la cuve)
  { x: 1950, y: 1300 + S },
  { x: 1560, y: 2000 },
  { x: 1920, y: 2040 },
];

const volcanoRedSpawns: Vec2[] = [
  { x: 1550, y: 170 },
  { x: 1890, y: 170 },
  { x: 1720, y: 210 },
];
const volcanoRedSafe: SafeZone = {
  team: ENEMY,
  rect: { x: 1392, y: 24, w: 672, h: 256 },
  doors: [
    { ax: 1536, ay: 300, bx: 1716, by: 300 },
    { ax: 1812, ay: 300, bx: 1968, by: 300 },
  ],
};

export const VOLCANO_MAP: MapDef = {
  id: 'volcano',
  nameKey: 'map.volcano',
  modeKey: 'mode.control',
  descKey: 'map.volcano.desc',
  width: VW,
  height: VH,
  walls: withMirror(VOLCANO_HALF_WALLS, vRect),
  lava: withMirror(VOLCANO_HALF_LAVA, vRect),
  theme: 'volcano',
  decor: withMirror<Decor>(VOLCANO_HALF_DECOR, (d) => ({ ...d, ...vPt(d) })),
  shapes: withMirror(VOLCANO_HALF_SHAPES, vShape),
  zones: [],
  safeZones: [
    volcanoRedSafe,
    { team: ALLY, rect: vRect(volcanoRedSafe.rect), doors: volcanoRedSafe.doors.map(vSeg) },
  ],
  spawns: { [ENEMY]: volcanoRedSpawns, [ALLY]: volcanoRedSpawns.map(vPt) },
  control: { x: VC.x, y: VC.y, r: 190 },
  healthPacks: withMirror(
    [
      { x: 336, y: 896 + S },
      { x: 840, y: 1000 + S },
      { x: 1980, y: 1192 + S },
      { x: 1880, y: 930 }, // salle intermédiaire
    ],
    vPt,
  ),
  nav: [...withMirror(VOLCANO_HALF_NAV, vPt), { ...VC }],
};

/** Cartes jouables en Partie rapide (la carte détermine le mode). */
export const QUICKPLAY_MAPS: MapDef[] = [SANCTUARY_MAP, ROUTE66_MAP, VOLCANO_MAP];
