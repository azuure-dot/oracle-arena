import { PLAYER_SPAWN, WORLD } from '../config';
import type { Vec2 } from '../core/math';
import { ALLY, ENEMY, type Team } from '../entities/Team';
import type { TKey } from '../i18n';
import type { Rect, Segment, Zone } from './Arena';

/** Zone de spawn protégée : invincibilité + soin pour son équipe, interdite à l'adversaire. */
export interface SafeZone {
  team: Team;
  rect: Rect;
  /** Portes de sortie (traits jaunes au sol). */
  doors: Segment[];
}

/** Point de contrôle (cercle). */
export interface ControlPointDef {
  x: number;
  y: number;
  r: number;
}

export interface MapDef {
  id: string;
  nameKey: TKey;
  width: number;
  height: number;
  walls: Rect[];
  zones: Zone[];
  safeZones: SafeZone[];
  /** Points d'apparition par équipe. */
  spawns: Record<Team, Vec2[]>;
  control?: ControlPointDef;
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

/** Cartes jouables en Partie rapide. */
export const QUICKPLAY_MAPS: MapDef[] = [SANCTUARY_MAP];
