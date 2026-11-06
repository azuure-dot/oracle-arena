import { grid, type Grid, type Palette } from './pixelArt';

/**
 * BIBLIOTHÈQUE DE SPRITES — c'est ici qu'on dessine les personnages.
 *
 * Chaque lettre est une couleur de la palette du personnage, '.' = transparent.
 * Le contour est ajouté automatiquement (couleur d'équipe : bleu allié / rouge ennemi).
 *
 * Un personnage = 3 vues du haut du corps (face, dos, profil droit) + un jeu de jambes.
 * Le profil gauche est le miroir du profil droit ; les jambes animent la marche.
 * Pour tester un design : modifier les lettres puis ouvrir /sprites.html (galerie).
 *
 * Lettres communes :
 *   s/S peau (clair/ombre)   h/H cheveux   c/C vêtement   a accent   k détails sombres
 *   p jambes   b chaussures   m/M métal (clair/sombre)   y or   g verre/visière
 *   w reflet blanc   t couleur d'équipe (bleu/rouge, remplie au rendu)
 */

export interface LegSet {
  /** Jambes vue de face/dos : position neutre + un pas (l'autre pas = miroir). */
  frontIdle: Grid;
  frontStep: Grid;
  /** Jambes de profil (vers la droite) : neutre, foulée, passage. */
  sideIdle: Grid;
  sideStride: Grid;
  sidePass: Grid;
}

export interface CharacterSprite {
  id: string;
  down: Grid;
  up: Grid;
  right: Grid;
  legs: LegSet;
  palette: Palette;
}

// ------------------------------------------------------------------ jambes

/** Jambes "humaines" (largeur 14). */
const HUMAN_LEGS: LegSet = {
  frontIdle: grid(`
    |....pppppp....|
    |....pp..pp....|
    |....pp..pp....|
    |...bbb..bbb...|
  `, 'legs.frontIdle'),
  frontStep: grid(`
    |....pppppp....|
    |....pp..pp....|
    |...bbb..pp....|
    |........bbb...|
  `, 'legs.frontStep'),
  sideIdle: grid(`
    |.....pppp.....|
    |.....pppp.....|
    |.....pp.pp....|
    |.....bb.bbb...|
  `, 'legs.sideIdle'),
  sideStride: grid(`
    |.....pppp.....|
    |....pp..pp....|
    |...pp....pp...|
    |..bbb....bbb..|
  `, 'legs.sideStride'),
  sidePass: grid(`
    |.....pppp.....|
    |.....pppp.....|
    |......ppb.....|
    |......bbb.....|
  `, 'legs.sidePass'),
};

/** Jambes en armure de Rempart (largeur 20). */
const KNIGHT_LEGS: LegSet = {
  frontIdle: grid(`
    |.....mmmmmmmmmm.....|
    |.....MMmm..mmMM.....|
    |.....mmmm..mmmm.....|
    |.....MMMM..MMMM.....|
    |....bbbbb..bbbbb....|
  `, 'knight.frontIdle'),
  frontStep: grid(`
    |.....mmmmmmmmmm.....|
    |.....MMmm..mmMM.....|
    |....bbbbb..mmmm.....|
    |...........MMMM.....|
    |..........bbbbb.....|
  `, 'knight.frontStep'),
  sideIdle: grid(`
    |.......mmmmmm.......|
    |.......mmmmmm.......|
    |.......MMm.mMM......|
    |.......mmm.mmm......|
    |.......bbb.bbbb.....|
  `, 'knight.sideIdle'),
  sideStride: grid(`
    |.......mmmmmm.......|
    |......mmm..mmm......|
    |.....MMm....mMM.....|
    |....mmm......mmm....|
    |...bbbb......bbbb...|
  `, 'knight.sideStride'),
  sidePass: grid(`
    |.......mmmmmm.......|
    |.......mmmmmm.......|
    |........MMmb........|
    |........mmb.........|
    |........bbb.........|
  `, 'knight.sidePass'),
};

// ------------------------------------------------------------------ Flux

/** Flux : cheveux argentés en pics, visière orange, veste orange, module cyan dans le dos. */
export const FLUX_SPRITE: CharacterSprite = {
  id: 'flux',
  down: grid(`
    |....hhhhhh....|
    |..hhhhhhhhhh..|
    |.hhhhhhhhhhhh.|
    |.hhHhhhhhhHhh.|
    |.hhsssssssshh.|
    |..gggggggggg..|
    |..gwggggggwg..|
    |..ssssssssss..|
    |...sssSSsss...|
    |....SSSSSS....|
    |..cccccccccc..|
    |.sccccaaccccs.|
    |.sCcccaacccCs.|
    |..CCCCCCCCCC..|
  `, 'flux.down'),
  up: grid(`
    |....hhhhhh....|
    |..hhhhhhhhhh..|
    |.hhhhhhhhhhhh.|
    |.hhHhhhhhhHhh.|
    |.hhhhhhhhhhhh.|
    |..kkkkkkkkkk..|
    |..hhhhhhhhhh..|
    |..hHhhhhhhHh..|
    |...hhhhhhhh...|
    |....SSSSSS....|
    |..cccccccccc..|
    |.sccccaaccccs.|
    |.sCcccaacccCs.|
    |..CCCCCCCCCC..|
  `, 'flux.up'),
  right: grid(`
    |.....hhhhh....|
    |...hhhhhhhh...|
    |..hhhhhhhhhh..|
    |.hhhHhhhhhhh..|
    |hhhhhhhssssh..|
    |..hhhggggggg..|
    |..hhhgwgggwg..|
    |...hhsssssss..|
    |....sssssss...|
    |.....SSSS.....|
    |....ccccccc...|
    |...aacccccc...|
    |...aCccccsc...|
    |....CCCCCCC...|
  `, 'flux.right'),
  legs: HUMAN_LEGS,
  palette: {
    h: '#e9ecf5',
    H: '#aab1c6',
    s: '#f3c9a3',
    S: '#d39a72',
    g: '#ff9a2e',
    w: '#fff6d6',
    c: '#ff9f43',
    C: '#c46a1d',
    a: '#7fd8ff',
    k: '#1d2029',
    p: '#3a3f52',
    b: '#1c1f28',
  },
};

// ------------------------------------------------------------------ Tempo

/** Tempo : casque audio (écouteurs à la couleur de l'aura), sweat vert. 'a' = couleur d'aura. */
export const TEMPO_SPRITE: CharacterSprite = {
  id: 'tempo',
  down: grid(`
    |....mmmmmm....|
    |...mhhhhhhm...|
    |..mhhhhhhhhm..|
    |..hhhhhhhhhh..|
    |.aahsssssshaa.|
    |.amskssssksma.|
    |.aassssssssaa.|
    |..ssssSSssss..|
    |...ssssssss...|
    |....SSSSSS....|
    |..cccccccccc..|
    |.scccCCCCcccs.|
    |.sCccccccccCs.|
    |..CCCCCCCCCC..|
  `, 'tempo.down'),
  up: grid(`
    |....mmmmmm....|
    |...mhhhhhhm...|
    |..mhhhhhhhhm..|
    |..hhhhhhhhhh..|
    |.aahhhhhhhhaa.|
    |.amhhhhhhhhma.|
    |.aahhhhhhhhaa.|
    |..hhhhhhhhhh..|
    |...hhhhhhhh...|
    |....SSSSSS....|
    |..cCCCCCCCCc..|
    |.sccccccccccs.|
    |.sCccccccccCs.|
    |..CCCCCCCCCC..|
  `, 'tempo.up'),
  right: grid(`
    |.....mmmm.....|
    |....mhhhhm....|
    |...hmhhhhhh...|
    |..hhmhhhhhhh..|
    |..haaahhssss..|
    |..hamahsskss..|
    |..haaassssss..|
    |...hsssssSSs..|
    |....sssssss...|
    |.....SSSS.....|
    |....ccccccc...|
    |...cccccccs...|
    |...CcccccCs...|
    |....CCCCCCC...|
  `, 'tempo.right'),
  legs: HUMAN_LEGS,
  palette: {
    h: '#2a2230',
    s: '#8d5a3b',
    S: '#6a4128',
    k: '#1d1418',
    m: '#2a2f38',
    a: '#ffd84d', // remplacé au rendu par la couleur de l'aura
    c: '#59d48a',
    C: '#2f8a55',
    p: '#33405c',
    b: '#f1f1f1',
  },
};

// ------------------------------------------------------------------ Rempart

/** Rempart : chevalier en armure, heaume à visière, cimier doré, cape bleu nuit. */
export const REMPART_SPRITE: CharacterSprite = {
  id: 'rempart',
  down: grid(`
    |.......yyyyyy.......|
    |.....mmmmmmmmmm.....|
    |....mmmmmmmmmmmm....|
    |....mMmmmmmmmmMm....|
    |....mMyyyyyyyyMm....|
    |....mMkkkkkkkkMm....|
    |....mMmmkmmkmmMm....|
    |.....MmmmmmmmmM.....|
    |.yyyy.MMMMMMMM.yyyy.|
    |ymmmmymmmmmmmmymmmmy|
    |mmmmMmmmyyyymmmMmmmm|
    |MmmMMmmmyyyymmmMMmmM|
    |.MM.mmmmmmmmmmmm.MM.|
    |.mm.MmmmmmmmmmmM.mm.|
    |.MM.yyyyyyyyyyyy.MM.|
    |.....MMMMMMMMMM.....|
  `, 'rempart.down'),
  up: grid(`
    |.......yyyyyy.......|
    |.....mmmmmmmmmm.....|
    |....mmmmmmmmmmmm....|
    |....mMmmmmmmmmMm....|
    |....mMmmmmmmmmMm....|
    |....mMmmmmmmmmMm....|
    |....mMmmmmmmmmMm....|
    |.....MmmmmmmmmM.....|
    |.yyyy.MMMMMMMM.yyyy.|
    |ymmmmyccccccccymmmmy|
    |mmmmMccccccccccMmmmm|
    |MmmMMccccccccccMMmmM|
    |.MM.cccccccccccc.MM.|
    |.mm.cCccccccccCc.mm.|
    |.MM.cccccccccccc.MM.|
    |.....CCCCCCCCCC.....|
  `, 'rempart.up'),
  right: grid(`
    |........yyyyy.......|
    |......mmmmmmmm......|
    |.....mmmmmmmmmm.....|
    |.....mMmmmmmmmmm....|
    |.....mMmmmmyyyyy....|
    |.....mMmmmmkkkkk....|
    |.....mMmmmmmkmkm....|
    |......MmmmmmmmM.....|
    |....ccyyyyyy........|
    |...ccymmmmmmy.......|
    |...ccmmmmMmmmmm.....|
    |...ccMmmmMmmmmMm....|
    |...ccmmmmmmmmMM.....|
    |...cCmmmmmmmmmm.....|
    |...CCyyyyyyyyyy.....|
    |....CCMMMMMMMM......|
  `, 'rempart.right'),
  legs: KNIGHT_LEGS,
  palette: {
    m: '#c9d3df',
    M: '#7d8a9b',
    y: '#e2b84c',
    k: '#1d2029',
    c: '#3d4f7a',
    C: '#2a3756',
    b: '#4d5868',
  },
};

// ------------------------------------------------------------------ Bots

/** Robot d'entraînement : visière, antenne et plastron à la couleur d'équipe ('t'). */
export const ROBOT_SPRITE: CharacterSprite = {
  id: 'robot',
  down: grid(`
    |......tt......|
    |......kk......|
    |...mmmmmmmm...|
    |..mmmmmmmmmm..|
    |..mMMMMMMMMm..|
    |..mMttttttMm..|
    |..mMMMMMMMMm..|
    |..mmmmmmmmmm..|
    |...MMMMMMMM...|
    |.....kkkk.....|
    |..mmmmmmmmmm..|
    |.MmmmttttmmmM.|
    |.MmmmmmmmmmmM.|
    |..MMMMMMMMMM..|
  `, 'robot.down'),
  up: grid(`
    |......tt......|
    |......kk......|
    |...mmmmmmmm...|
    |..mmmmmmmmmm..|
    |..mmmmmmmmmm..|
    |..mmMMMMMMmm..|
    |..mmkkkkkkmm..|
    |..mmmmmmmmmm..|
    |...MMMMMMMM...|
    |.....kkkk.....|
    |..mmmmmmmmmm..|
    |.MmmMMMMMMmmM.|
    |.MmmMkkkkMmmM.|
    |..MMMMMMMMMM..|
  `, 'robot.up'),
  right: grid(`
    |.......tt.....|
    |.......kk.....|
    |....mmmmmmm...|
    |...mmmmmmmmm..|
    |...mmmmmMMMM..|
    |...mmmmmMttt..|
    |...mmmmmMMMM..|
    |...mmmmmmmmm..|
    |....MMMMMMM...|
    |.....kkkk.....|
    |....mmmmmmm...|
    |....mmmmmtm...|
    |....MmmmmmM...|
    |....MMMMMMM...|
  `, 'robot.right'),
  legs: HUMAN_LEGS,
  palette: {
    m: '#d3d9e1',
    M: '#9aa3b2',
    k: '#2a2f38',
    t: '#ffffff', // remplacé au rendu par la couleur d'équipe
    p: '#8a93a3',
    b: '#4a5260',
  },
};

/** Socle de tourelle (vue de dessus, ne tourne pas). */
export const TURRET_BASE: Grid = grid(`
  |.....MMMMMM.....|
  |...MMmmmmmmMM...|
  |..MmmmmmmmmmmM..|
  |.MmmmttttttmmmM.|
  |.MmmttMMMMttmmM.|
  |MmmtMMkkkkMMtmmM|
  |MmmtMkkkkkkMtmmM|
  |MmmtMkkkkkkMtmmM|
  |MmmtMkkkkkkMtmmM|
  |MmmtMMkkkkMMtmmM|
  |.MmmttMMMMttmmM.|
  |.MmmmttttttmmmM.|
  |..MmmmmmmmmmmM..|
  |...MMmmmmmmMM...|
  |.....MMMMMM.....|
`, 'turret.base');

/** Canon de tourelle (pointe vers la droite, pivot à gauche). */
export const TURRET_BARREL: Grid = grid(`
  |MMMMMMMMMMkk|
  |mmmmmmmmmmkk|
  |mmmmmmmmmmkk|
  |MMMMMMMMMMkk|
`, 'turret.barrel');

export const TURRET_PALETTE: Palette = {
  m: '#c4cad3',
  M: '#7f8896',
  k: '#2a2f38',
  t: '#ffffff',
};

/** Marteau de Rempart (manche vers la gauche, tête à droite). */
export const HAMMER: Grid = grid(`
  |..........MMMM|
  |..........MmmM|
  |oooooooooommmy|
  |oooooooooommmy|
  |..........MmmM|
  |..........MMMM|
`, 'hammer');

export const HAMMER_PALETTE: Palette = {
  o: '#7a5230',
  m: '#9aa6b5',
  M: '#5d6878',
  y: '#e2b84c',
};

export const ALL_CHARACTERS: CharacterSprite[] = [REMPART_SPRITE, FLUX_SPRITE, TEMPO_SPRITE, ROBOT_SPRITE];

