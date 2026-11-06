// Valeurs globales d'équilibrage. Les stats propres à chaque héros sont dans src/heroes/.
// Unité de distance : le pixel monde. Unité de temps : la seconde.

export const WORLD = {
  width: 2000,
  height: 1300,
  gridSize: 50,
} as const;

export const PLAYER_SPAWN = { x: 260, y: 650 } as const;

export const BOT = {
  radius: 22,
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
 * Zone de vision : rectangle 16:9 centré sur le joueur (en unités monde).
 * - Le zoom de la caméra est calculé pour que cette zone remplisse l'écran :
 *   même surface visible sur un écran 13" ou 27".
 * - Au-delà (bandes sur les écrans ultra-larges ou 4:3), tout est dans l'ombre
 *   et aucun ennemi n'est visible, même sans mur entre les deux.
 */
export const VISION = {
  width: 1920,
  height: 1080,
  /** Assombrissement hors de la zone de vision. */
  outsideOpacity: 0.97,
  /** Dégradé d'ombre (unités monde) sur le bord intérieur de la zone. */
  edgeFade: 70,
} as const;

export const FOG = {
  opacity: 0.86,
  /** Le brouillard est calculé en demi-résolution : bords doux + moins cher. */
  resolution: 0.5,
  blurPx: 3,
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
export const teamColor = (team: 'ally' | 'enemy'): string => (team === 'ally' ? COLORS.ally : COLORS.enemy);
