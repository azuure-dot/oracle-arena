import type { Socket } from 'socket.io-client';
import {
  EVENTS,
  type Ack,
  type ErrorCode,
  type GameOver,
  type GameStarted,
  type GameTick,
  type JoinedRoom,
  type PlayerInput,
  type RoomSettings,
  type RoomState,
} from '../../server/src/types/network';

/**
 * CONNEXION AU SERVEUR DE JEU (Socket.io) : un seul objet pour tout le client.
 *
 * - Adresse : variable `VITE_SERVER_URL` (fichier .env, voir .env.example), sinon
 *   http://localhost:3001. Elle est fixée AU MOMENT DU BUILD par Vite.
 * - La bibliothèque Socket.io n'est chargée (import dynamique) qu'à la première ouverture des
 *   parties privées : le jeu solo ne télécharge rien de plus et ne se connecte jamais.
 * - Les demandes (créer, rejoindre, prêt...) renvoient une promesse : réponse du serveur ou code
 *   d'erreur (voir ErrorCode dans server/src/types/network.ts).
 */

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';

/** Erreur renvoyée par le serveur, ou 'offline' si on n'a pas pu le joindre. */
export class NetError extends Error {
  constructor(readonly code: ErrorCode | 'offline' | 'timeout') {
    super(code);
  }
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(value: T): void {
    this.listeners.forEach((cb) => cb(value));
  }
}

export class NetworkManager {
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  status: ConnectionStatus = 'idle';
  /** Mon identifiant de joueur dans le salon (donné par le serveur). */
  you: string | null = null;
  /** Dernier état connu du salon (null : dans aucun salon). */
  room: RoomState | null = null;

  readonly statusChanged = new Emitter<ConnectionStatus>();
  readonly roomUpdated = new Emitter<RoomState>();
  readonly roomClosed = new Emitter<void>();
  readonly gameStarted = new Emitter<GameStarted>();
  readonly gameTick = new Emitter<GameTick>();
  readonly gameOver = new Emitter<GameOver>();

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.you;
  }

  /** Connexion (une seule fois ; les appels suivants réutilisent la même). */
  connect(): Promise<Socket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.setStatus('connecting');
    this.connecting = import('socket.io-client').then(
      ({ io }) =>
        new Promise<Socket>((resolve, reject) => {
          const socket =
            this.socket ??
            io(SERVER_URL, {
              transports: ['websocket'], // pas de « long polling » : latence minimale
              reconnectionAttempts: 5,
              timeout: 6000,
            });
          if (!this.socket) this.listen(socket);
          this.socket = socket;
          const fail = () => {
            this.connecting = null;
            this.setStatus('offline');
            reject(new NetError('offline'));
          };
          if (socket.connected) resolve(socket);
          socket.once('connect', () => resolve(socket));
          socket.once('connect_error', fail);
          if (socket.disconnected) socket.connect();
        }),
    );
    this.connecting.catch(() => {}).finally(() => (this.connecting = null));
    return this.connecting;
  }

  private listen(socket: Socket): void {
    socket.on('connect', () => this.setStatus('online'));
    socket.on('disconnect', () => {
      this.setStatus('offline');
      // Le serveur nous a oubliés : le salon est perdu (pas de reprise dans cette version).
      if (this.room) {
        this.room = null;
        this.roomClosed.emit();
      }
    });
    socket.on(EVENTS.ROOM_UPDATED, (room: RoomState) => {
      this.room = room;
      this.roomUpdated.emit(room);
    });
    socket.on(EVENTS.ROOM_CLOSED, () => {
      this.room = null;
      this.roomClosed.emit();
    });
    socket.on(EVENTS.GAME_STARTED, (g: GameStarted) => this.gameStarted.emit(g));
    socket.on(EVENTS.GAME_TICK, (t: GameTick) => this.gameTick.emit(t));
    socket.on(EVENTS.GAME_OVER, (r: GameOver) => this.gameOver.emit(r));
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusChanged.emit(s);
  }

  /** Demande avec accusé de réception (délai max 8 s). */
  private async request<T>(event: string, ...args: unknown[]): Promise<T> {
    const socket = await this.connect();
    const res = await new Promise<Ack<T>>((resolve, reject) => {
      socket.timeout(8000).emit(event, ...args, (err: Error | null, ack: Ack<T>) => {
        if (err) reject(new NetError('timeout'));
        else resolve(ack);
      });
    });
    if (!res.ok) throw new NetError(res.error);
    return res.data;
  }

  // ------------------------------------------------------------ salon

  async createRoom(name: string, heroId: string): Promise<RoomState> {
    return this.enter(await this.request<JoinedRoom>(EVENTS.CREATE_ROOM, { name, heroId }));
  }

  async joinRoom(code: string, name: string, heroId: string): Promise<RoomState> {
    return this.enter(await this.request<JoinedRoom>(EVENTS.JOIN_ROOM, { code, name, heroId }));
  }

  private enter(j: JoinedRoom): RoomState {
    this.you = j.you;
    this.room = j.room;
    this.roomUpdated.emit(j.room);
    return j.room;
  }

  async leaveRoom(): Promise<void> {
    if (!this.room) return;
    this.room = null;
    if (this.socket?.connected) await this.request(EVENTS.LEAVE_ROOM).catch(() => {});
  }

  updateSettings(patch: Partial<RoomSettings>): Promise<void> {
    return this.request(EVENTS.UPDATE_SETTINGS, patch);
  }
  selectHero(heroId: string): Promise<void> {
    return this.request(EVENTS.SELECT_HERO, heroId);
  }
  setReady(ready: boolean): Promise<void> {
    return this.request(EVENTS.SET_READY, ready);
  }
  startGame(): Promise<void> {
    return this.request(EVENTS.START_GAME);
  }

  // ------------------------------------------------------------ partie

  /** Commandes d'une image (sans accusé : envoyées en continu). */
  sendInput(input: PlayerInput): void {
    if (this.socket?.connected) this.socket.emit(EVENTS.PLAYER_INPUT, input);
  }
}

/** Le gestionnaire unique du client. */
export const net = new NetworkManager();
