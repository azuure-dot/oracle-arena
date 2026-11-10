/**
 * PROTOCOLE RÉSEAU — événements et messages échangés entre le client (navigateur) et le serveur.
 * Fichier PUR (aucun import) : le serveur l'utilise directement, le client l'importe par
 * `server/src/types/network.ts` (voir src/network/NetworkManager.ts). Toute modification se
 * fait ici, une seule fois, pour les deux côtés.
 */

import type { NetFields } from '../../../src/network/netState';

// ------------------------------------------------------------------ événements

export const EVENTS = {
  // client → serveur (avec accusé de réception : callback(réponse))
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  UPDATE_SETTINGS: 'update_settings',
  SELECT_HERO: 'select_hero',
  SET_READY: 'set_ready',
  START_GAME: 'start_game',
  /** Commandes du joueur, envoyées à chaque image pendant la partie. */
  PLAYER_INPUT: 'player_input',

  // serveur → client
  /** État complet du salon (joueurs, réglages, hôte) à chaque changement. */
  ROOM_UPDATED: 'room_updated',
  /** Le salon a été fermé (plus aucun joueur, ou serveur arrêté). */
  ROOM_CLOSED: 'room_closed',
  /** La partie commence : liste des participants et carte. */
  GAME_STARTED: 'game_started',
  /** Instantané de la simulation (30 par seconde). */
  GAME_TICK: 'game_tick',
  /** Fin de partie : classement final, retour au salon. */
  GAME_OVER: 'game_over',
} as const;

// ------------------------------------------------------------------ salon

export const ROOM_CODE_LENGTH = 6;
export const MAX_PLAYERS = 6;
export const NAME_MAX = 16;

/** Modes proposés dans un salon privé. `online` : jouable en ligne dans cette version. */
export type NetModeId = 'practice' | 'deathmatch' | 'control' | 'escort';
export const NET_MODES: Record<NetModeId, { maps: string[]; online: boolean }> = {
  practice: { maps: ['practice'], online: false },
  deathmatch: { maps: ['practice'], online: true },
  control: { maps: ['sanctuary', 'volcano'], online: false },
  escort: { maps: ['route66'], online: false },
};
export const NET_MODE_ORDER: NetModeId[] = ['practice', 'deathmatch', 'control', 'escort'];
export const MATCH_MINUTES = [1, 3, 5] as const;

export interface RoomSettings {
  mode: NetModeId;
  mapId: string;
  /** Compléter les places libres (jusqu'à 6) avec des bots héros. */
  fillBots: boolean;
  minutes: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  heroId: string;
  ready: boolean;
  isHost: boolean;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing';
  settings: RoomSettings;
  players: LobbyPlayer[];
}

/** Réponse aux demandes avec accusé de réception. */
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: ErrorCode };

export type ErrorCode =
  | 'not_found' // code inconnu
  | 'full' // 6 joueurs
  | 'in_game' // partie en cours
  | 'not_host'
  | 'not_ready' // un joueur n'est pas prêt
  | 'mode_unavailable' // mode pas encore jouable en ligne
  | 'too_few' // moins de 2 participants
  | 'bad_request'
  | 'rate_limited';

export interface CreateRoomRequest {
  name: string;
  heroId: string;
}
export interface JoinRoomRequest extends CreateRoomRequest {
  code: string;
}
/** Réponse à CREATE_ROOM / JOIN_ROOM : son identifiant de joueur et le salon. */
export interface JoinedRoom {
  you: string;
  room: RoomState;
}

// ------------------------------------------------------------------ partie

export interface Participant {
  id: string;
  name: string;
  heroId: string;
  /** Équipe (Deathmatch : une par participant). */
  team: string;
  isBot: boolean;
}

export interface GameStarted {
  mode: NetModeId;
  mapId: string;
  participants: Participant[];
  /** Fréquence des instantanés (Hz). */
  tickRate: number;
}

/** Actions des héros, dans l'ordre des bits des masques `held` / `pressed`. */
export const ACTION_BITS = ['primary', 'secondary', 'ability1', 'ability2', 'melee', 'reload'] as const;

/** Commandes d'une image côté client. */
export interface PlayerInput {
  /** Numéro croissant : le serveur renvoie le dernier traité (`acks`), pour la réconciliation. */
  seq: number;
  /** Durée de l'image (s) : rejouée telle quelle par la prédiction du client. */
  dt: number;
  /** Direction de déplacement (normalisée). */
  mx: number;
  my: number;
  /** Point visé (coordonnées monde). */
  ax: number;
  ay: number;
  /** Actions maintenues / déclenchées cette image (masques de bits, voir ACTION_BITS). */
  held: number;
  pressed: number;
}

/** Un héros dans un instantané. */
export interface HeroTick {
  /** [x, y, visée, vx, vy, kvx, kvy] à chaque instantané : interpolation et réconciliation. */
  p: [number, number, number, number, number, number, number];
  /** Champs modifiés depuis l'instantané précédent (absent : rien n'a changé). */
  s?: NetFields;
}

/** Un objet du monde (projectile, marteau, leurre...) dans un instantané. */
export interface ObjectTick {
  id: number;
  /** Type (voir NET_KINDS) : seulement au premier envoi. */
  k?: string;
  p: [number, number];
  s?: NetFields;
}

/** Appel d'effet visuel enregistré sur le serveur : [méthode, ...arguments]. */
export type FxCall = [string, ...(number | string | boolean)[]];

/** Dégât : [cible, source, dégâts, tué (0/1), cause]. Cible : id de héros ou { o: id } d'objet. */
export type HitEvent = [string | number, string | null, number, 0 | 1, string | null];

export interface GameTick {
  /** Horloge du serveur (s depuis le début de la partie, compte à rebours compris) : interpolation. */
  t: number;
  /** Temps de jeu du monde (s, figé pendant le compte à rebours) : animations, séchage des flaques. */
  wt: number;
  /** Dernière commande traitée, par joueur. */
  acks: Record<string, number>;
  heroes: Record<string, HeroTick>;
  objects: ObjectTick[];
  fx: FxCall[];
  /** Sol mouillé : arguments de `WetGround.splash` (x, y, rayon, instant, équipe). */
  wet: [number, number, number, number, string][];
  shakes: [number, number, number][];
  hits: HitEvent[];
  match: {
    countdown: number;
    remaining: number;
    /** [éliminations, morts] par participant. */
    scores: Record<string, [number, number]>;
  };
}

export interface GameOver {
  scores: Record<string, [number, number]>;
}
