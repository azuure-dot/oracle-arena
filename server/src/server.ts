import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { sanitizeInput } from './game/NetControls';
import { RoomError, RoomManager, toState } from './rooms/RoomManager';
import {
  EVENTS,
  type Ack,
  type CreateRoomRequest,
  type JoinedRoom,
  type JoinRoomRequest,
  type RoomSettings,
} from './types/network';

/**
 * SERVEUR DE JEU : Express (page de santé) + Socket.io (salons et parties en temps réel).
 *
 *   PORT        port d'écoute (3001 par défaut)
 *   CLIENT_URL  origine(s) autorisée(s) du client, séparées par des virgules (CORS)
 *
 * Il doit tourner EN PERMANENCE (WebSocket ouvert pendant toute la partie) : un hébergeur de
 * processus (Railway, Render, Fly.io...), pas des fonctions « serverless ». Voir docs/multijoueur.md.
 */

const PORT = Number(process.env.PORT ?? 3001);
const ORIGINS = (process.env.CLIENT_URL ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const app = express();
app.use(cors({ origin: ORIGINS }));
app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

const http = createServer(app);
const io = new Server(http, {
  cors: { origin: ORIGINS },
  // Les instantanés (JSON) se compressent très bien ; les petits messages restent bruts.
  perMessageDeflate: { threshold: 1024 },
});

const room = (code: string) => `room:${code}`;

const rooms = new RoomManager({
  roomUpdated: (state) => io.to(room(state.code)).emit(EVENTS.ROOM_UPDATED, state),
  roomClosed: (code) => {
    io.to(room(code)).emit(EVENTS.ROOM_CLOSED, code);
    io.in(room(code)).socketsLeave(room(code));
  },
  gameStarted: (code, info) => io.to(room(code)).emit(EVENTS.GAME_STARTED, info),
  gameTick: (code, tick) => io.to(room(code)).emit(EVENTS.GAME_TICK, tick),
  gameOver: (code, result) => io.to(room(code)).emit(EVENTS.GAME_OVER, result),
});

/** Identifiants courts (ils reviennent dans chaque instantané) : p1, p2... */
let nextPlayer = 1;

/** Limiteur simple : au plus `max` appels par fenêtre de `windowMs`. */
function limiter(max: number, windowMs: number): () => boolean {
  let count = 0;
  let since = Date.now();
  return () => {
    const now = Date.now();
    if (now - since > windowMs) {
      since = now;
      count = 0;
    }
    return ++count <= max;
  };
}

io.on('connection', (socket: Socket) => {
  const playerId = `p${nextPlayer++}`;
  const canJoin = limiter(20, 60_000); // contre les essais de codes au hasard
  const canInput = limiter(150, 1000); // ~60 commandes/s attendues

  /** Exécute une demande et répond par l'accusé de réception (erreurs de salon comprises). */
  const handle = <T>(ack: unknown, fn: () => T): void => {
    const reply = typeof ack === 'function' ? (ack as (a: Ack<T>) => void) : () => {};
    try {
      reply({ ok: true, data: fn() });
    } catch (e) {
      if (e instanceof RoomError) reply({ ok: false, error: e.code });
      else {
        console.error(e);
        reply({ ok: false, error: 'bad_request' });
      }
    }
  };

  const enter = (code: string): JoinedRoom => {
    for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
    socket.join(room(code));
    return { you: playerId, room: toState(rooms.roomOfPlayer(playerId)!) };
  };

  socket.on(EVENTS.CREATE_ROOM, (req: CreateRoomRequest, ack: unknown) =>
    handle(ack, () => {
      if (!canJoin()) throw new RoomError('rate_limited');
      const r = rooms.create(playerId, req?.name, req?.heroId);
      return enter(r.code);
    }),
  );

  socket.on(EVENTS.JOIN_ROOM, (req: JoinRoomRequest, ack: unknown) =>
    handle(ack, () => {
      if (!canJoin()) throw new RoomError('rate_limited');
      const r = rooms.join(String(req?.code ?? ''), playerId, req?.name, req?.heroId);
      return enter(r.code);
    }),
  );

  socket.on(EVENTS.LEAVE_ROOM, (ack: unknown) =>
    handle(ack, () => {
      const r = rooms.roomOfPlayer(playerId);
      rooms.leave(playerId);
      if (r) socket.leave(room(r.code));
      return undefined;
    }),
  );

  socket.on(EVENTS.UPDATE_SETTINGS, (patch: Partial<RoomSettings>, ack: unknown) =>
    handle(ack, () => rooms.updateSettings(playerId, patch ?? {})),
  );
  socket.on(EVENTS.SELECT_HERO, (heroId: string, ack: unknown) => handle(ack, () => rooms.selectHero(playerId, heroId)));
  socket.on(EVENTS.SET_READY, (ready: boolean, ack: unknown) => handle(ack, () => rooms.setReady(playerId, ready)));
  socket.on(EVENTS.START_GAME, (ack: unknown) => handle(ack, () => rooms.start(playerId)));

  socket.on(EVENTS.PING, (last: unknown, ack: unknown) => {
    if (typeof last === 'number' && Number.isFinite(last)) rooms.setPing(playerId, Math.min(9999, Math.max(0, Math.round(last))));
    if (typeof ack === 'function') ack();
  });

  socket.on(EVENTS.PLAYER_INPUT, (raw: unknown) => {
    if (!canInput()) return;
    const input = sanitizeInput(raw);
    if (input) rooms.input(playerId, input);
  });

  socket.on('disconnect', () => rooms.leave(playerId));
});

http.listen(PORT, () => {
  console.log(`Serveur de jeu sur http://localhost:${PORT} · clients autorisés : ${ORIGINS.join(', ')}`);
});

function shutdown(): void {
  rooms.closeAll();
  io.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
