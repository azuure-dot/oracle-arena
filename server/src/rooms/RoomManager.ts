import { randomInt } from 'node:crypto';
import { HEROES } from '../../../src/heroes/registry';
import { BOT_NAMES, shuffle } from '../../../src/modes/rules';
import { GameLoop } from '../game/GameLoop';
import {
  MATCH_MINUTES,
  MAX_PLAYERS,
  NAME_MAX,
  NET_MODES,
  ROOM_CODE_LENGTH,
  type ErrorCode,
  type GameOver,
  type GameStarted,
  type GameTick,
  type LobbyPlayer,
  type NetModeId,
  type Participant,
  type RoomSettings,
  type RoomState,
} from '../types/network';

/**
 * SALONS PRIVÉS, en mémoire (`Map<code, Room>`) : rien n'est enregistré sur disque, un salon
 * disparaît quand son dernier joueur part (ou au redémarrage du serveur).
 * - Code unique de 6 caractères (lettres et chiffres, sans 0/O ni 1/I, faciles à dicter).
 * - 6 joueurs au maximum.
 * - L'hôte choisit le mode, la carte, la durée et les bots ; s'il part, l'hôte passe au joueur
 *   arrivé le plus tôt ; le salon ferme quand il n'y a plus personne.
 */

/** Alphabet des codes : alphanumérique, sans caractères ambigus. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Room {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing';
  settings: RoomSettings;
  /** Dans l'ordre d'arrivée (migration de l'hôte). */
  players: LobbyPlayer[];
  game: GameLoop | null;
}

/** Ce que le gestionnaire de salons envoie aux joueurs (branché sur Socket.io par server.ts). */
export interface RoomEvents {
  roomUpdated(room: RoomState): void;
  roomClosed(code: string): void;
  gameStarted(code: string, info: GameStarted): void;
  gameTick(code: string, tick: GameTick): void;
  gameOver(code: string, result: GameOver): void;
}

export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

const DEFAULT_SETTINGS: RoomSettings = { mode: 'deathmatch', mapId: 'practice', fillBots: true, minutes: 3 };

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** Joueur → code du salon (un joueur n'est que dans un salon à la fois). */
  private readonly roomOf = new Map<string, string>();

  constructor(private readonly events: RoomEvents) {}

  get size(): number {
    return this.rooms.size;
  }

  // ------------------------------------------------------------ entrées / sorties

  create(playerId: string, name: string, heroId: string): Room {
    this.leave(playerId);
    const code = this.uniqueCode();
    const room: Room = {
      code,
      hostId: playerId,
      phase: 'lobby',
      settings: { ...DEFAULT_SETTINGS },
      players: [],
      game: null,
    };
    this.rooms.set(code, room);
    this.addPlayer(room, playerId, name, heroId);
    return room;
  }

  join(code: string, playerId: string, name: string, heroId: string): Room {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) throw new RoomError('not_found');
    if (room.players.some((p) => p.id === playerId)) return room;
    if (room.phase !== 'lobby') throw new RoomError('in_game');
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('full');
    this.leave(playerId);
    this.addPlayer(room, playerId, name, heroId);
    this.changed(room);
    return room;
  }

  /** Départ (bouton Quitter ou déconnexion) : migration de l'hôte ou fermeture du salon. */
  leave(playerId: string): void {
    const code = this.roomOf.get(playerId);
    if (!code) return;
    this.roomOf.delete(playerId);
    const room = this.rooms.get(code);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== playerId);
    room.game?.removePlayer(playerId);
    if (room.players.length === 0) {
      this.close(room);
      return;
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id; // migration de l'hôte
    this.changed(room);
  }

  roomOfPlayer(playerId: string): Room | undefined {
    const code = this.roomOf.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  // ------------------------------------------------------------ salon

  updateSettings(playerId: string, patch: Partial<RoomSettings>): void {
    const room = this.lobbyOf(playerId);
    if (room.hostId !== playerId) throw new RoomError('not_host');
    const s = { ...room.settings };
    if (patch.mode !== undefined) {
      if (!(patch.mode in NET_MODES)) throw new RoomError('bad_request');
      s.mode = patch.mode as NetModeId;
      if (!NET_MODES[s.mode].maps.includes(s.mapId)) s.mapId = NET_MODES[s.mode].maps[0];
    }
    if (patch.mapId !== undefined) {
      if (!NET_MODES[s.mode].maps.includes(patch.mapId)) throw new RoomError('bad_request');
      s.mapId = patch.mapId;
    }
    if (patch.fillBots !== undefined) s.fillBots = !!patch.fillBots;
    if (patch.minutes !== undefined) {
      if (!(MATCH_MINUTES as readonly number[]).includes(patch.minutes)) throw new RoomError('bad_request');
      s.minutes = patch.minutes;
    }
    room.settings = s;
    this.changed(room);
  }

  selectHero(playerId: string, heroId: string): void {
    const room = this.lobbyOf(playerId);
    const p = room.players.find((q) => q.id === playerId)!;
    p.heroId = validHero(heroId);
    this.changed(room);
  }

  setReady(playerId: string, ready: boolean): void {
    const room = this.lobbyOf(playerId);
    room.players.find((q) => q.id === playerId)!.ready = !!ready;
    this.changed(room);
  }

  /** « Lancer la partie » : réservé à l'hôte, quand tous les joueurs sont prêts. */
  start(playerId: string): void {
    const room = this.lobbyOf(playerId);
    if (room.hostId !== playerId) throw new RoomError('not_host');
    if (!NET_MODES[room.settings.mode].online) throw new RoomError('mode_unavailable');
    if (!room.players.every((p) => p.ready)) throw new RoomError('not_ready');

    const participants: Participant[] = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      heroId: p.heroId,
      team: p.id, // Deathmatch : chacun pour soi
      isBot: false,
    }));
    if (room.settings.fillBots) {
      const names = shuffle(BOT_NAMES);
      for (let i = 0; participants.length < MAX_PLAYERS; i++) {
        const id = `bot${i + 1}`;
        participants.push({
          id,
          name: names[i % names.length],
          heroId: HEROES[randomInt(HEROES.length)].id,
          team: id,
          isBot: true,
        });
      }
    }
    if (participants.length < 2) throw new RoomError('too_few');

    room.phase = 'playing';
    const code = room.code;
    room.game = new GameLoop(
      participants,
      room.settings,
      (tick) => this.events.gameTick(code, tick),
      (result) => this.endGame(room, result),
    );
    this.changed(room);
    this.events.gameStarted(code, {
      mode: room.settings.mode,
      mapId: room.settings.mapId,
      participants,
      tickRate: 30,
    });
    room.game.start();
  }

  /** Fin du chrono : classement envoyé, retour au salon (chacun doit se remettre prêt). */
  private endGame(room: Room, result: GameOver): void {
    room.game = null;
    room.phase = 'lobby';
    for (const p of room.players) p.ready = false;
    this.events.gameOver(room.code, result);
    this.changed(room);
  }

  /** Commandes d'un joueur en partie (ignorées hors partie). */
  input(playerId: string, input: Parameters<GameLoop['input']>[1]): void {
    this.roomOfPlayer(playerId)?.game?.input(playerId, input);
  }

  /** Arrêt du serveur : on prévient tout le monde. */
  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.close(room);
  }

  // ------------------------------------------------------------ interne

  private addPlayer(room: Room, id: string, name: string, heroId: string): void {
    room.players.push({ id, name: cleanName(name, room), heroId: validHero(heroId), ready: false, isHost: false });
    this.roomOf.set(id, room.code);
  }

  private lobbyOf(playerId: string): Room {
    const room = this.roomOfPlayer(playerId);
    if (!room) throw new RoomError('not_found');
    if (room.phase !== 'lobby') throw new RoomError('in_game');
    return room;
  }

  private close(room: Room): void {
    room.game?.stop();
    this.rooms.delete(room.code);
    for (const p of room.players) this.roomOf.delete(p.id);
    this.events.roomClosed(room.code);
  }

  private changed(room: Room): void {
    this.events.roomUpdated(toState(room));
  }

  private uniqueCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

/** État public d'un salon (envoyé aux joueurs). */
export function toState(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map((p) => ({ ...p, isHost: p.id === room.hostId })),
  };
}

/** Saisie tolérante : minuscules et espaces / tirets acceptés. */
export function normalizeCode(code: string): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

function validHero(id: string): string {
  return HEROES.some((h) => h.id === id) ? id : HEROES[0].id;
}

/** Pseudo nettoyé (caractères de contrôle retirés, 16 max), unique dans le salon. */
function cleanName(raw: string, room: Room): string {
  // eslint-disable-next-line no-control-regex
  let name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);
  if (!name) name = `Joueur ${room.players.length + 1}`;
  const base = name;
  for (let i = 2; room.players.some((p) => p.name === name); i++) name = `${base.slice(0, NAME_MAX - 3)} ${i}`;
  return name;
}
