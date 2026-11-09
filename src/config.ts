// Valeurs globales d'équilibrage. Les stats propres à chaque héros sont dans src/heroes/.
// Unité de distance : le pixel monde. Unité de temps : la seconde.

export const WORLD = {
  width: 2000,
  height: 1300,
  gridSize: 50,
} as const;

export const PLAYER_SPAWN = { x: 260, y: 650 } as const;

export const BOT = {
  /** Rayon des boules (= hitbox) : robot d'entraînement, tourelle. */
  robotRadius: 17,
  turretRadius: 18,
  enemyHp: 200,
  allyHp: 200,
  respawnTime: 3,
  patrolSpeed: 140,
  /** Les alliés "blessés" perdent des PV jusqu'à ce seuil (ratio des PV max). */
  woundedFloor: 0.3,
  woundedDrain: 8,
  /** Amortissement du recul (plus haut = s'arrête plus vite). */
  knockbackDamping: 5,
} as const;

export const TURRET = {
  range: 850,
  fireInterval: 0.7,
  damage: 12,
  bulletSpeed: 560,
  turnRate: 4, // rad/s
} as const;

export const ZONES = {
  hazardDps: 50,
  healHps: 60,
} as const;


/**
 * Cadre de la caméra : rectangle 16:9 de monde affiché à l'écran (le même pour tous les écrans),
 * soit ×1,3 puis ×1,5 de rapprochement par rapport à 1920 × 1080.
 */
export const CAMERA_ZOOM = 1.3 * 1.5;

/**
 * Zone de vision : cercle centré sur chaque héros (en unités monde), le même rayon pour tous —
 * joueur et bots. Chacun voit depuis sa propre position (son point de vue) : ce cercle, moins ce
 * que les murs lui cachent.
 * - La caméra montre un cadre 16:9 fixe (`width` × `height`), le même pour tous les écrans.
 * - Le cercle va d'un bord à l'autre de l'écran en largeur ; en hauteur, il dépasse un peu
 *   l'écran, et la vue s'arrête au haut et au bas du cadre (personne, bot compris, ne voit un
 *   ennemi resté hors de l'écran de l'autre).
 * - Au-delà du cercle, la carte reste devinable (assombrie) mais aucun ennemi n'y est visible,
 *   même sans mur entre les deux.
 */
export const VISION = {
  /** Cadre de la caméra (unités monde). */
  width: Math.round(1920 / CAMERA_ZOOM), // 985
  height: Math.round(1080 / CAMERA_ZOOM), // 554
  /** Rayon du cercle de vision : la moitié de la largeur de l'écran. */
  radius: Math.round(1920 / CAMERA_ZOOM / 2), // 492
  /** Assombrissement hors du cercle (la carte reste devinable, pas les ennemis). */
  outsideOpacity: 0.6,
  /** Dégradé d'ombre (unités monde) sur le bord intérieur du cercle. */
  edgeFade: 56,
} as const;

export const FOG = {
  opacity: 0.86,
  /**
   * Le calque d'ombre est calculé en quart de résolution puis agrandi avec lissage :
   * les bords sont doux sans filtre de flou (le flou recalculé à chaque image coûtait
   * ~3 ms et provoquait des pics de 15 ms+ sur une carte graphique intégrée).
   */
  resolution: 0.25,
} as const;

export const COLORS = {
  floor: '#151b23',
  gridMinor: 'rgba(255,255,255,0.035)',
  gridMajor: 'rgba(255,255,255,0.08)',
  wall: '#2b3442',
  wallTop: '#3a4658',
  wallEdge: '#536079',
  enemy: '#ff4d5e',
  ally: '#4da3ff',
  hpPlayer: '#f2f2f2',
  hpLow: '#ff8a5c',
  hpEnemy: '#ff4d5e',
  hpAlly: '#4da3ff',
  bullet: '#ffe39a',
  enemyBullet: '#ff6b6b',
  recall: '#7fd8ff',
  shield: '#7fd8ff',
  fire: '#ff8a3d',
  sonic: '#5be37d',
  /** Aura de Tempo : jaune = Soin, vert = Vitesse. */
  auraHeal: '#ffd84d',
  auraSpeed: '#5be37d',
  /** Corps neutre des bots : c'est le contour qui porte la couleur d'équipe. */
  botBody: '#d3d9e1',
  hud: '#e9eef5',
  hudDim: 'rgba(233,238,245,0.45)',
  accent: '#ffb347',
} as const;

/** Contour d'équipe : bleu pour les alliés (et le joueur), rouge pour les ennemis. */
export const teamColor = (team: string): string => (team === 'ally' ? COLORS.ally : COLORS.enemy);
