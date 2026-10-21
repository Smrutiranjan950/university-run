
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u;

const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
  connectTimeout: 20000
});

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, game: 'Sambalpur Campus Run 3D' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

function cleanName(value) {
  if (typeof value !== 'string') return 'Runner';
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 18 || !NAME_PATTERN.test(name)) {
    return null;
  }
  return name;
}

function cleanCharacter(value) {
  return value === 'Swastik' ? 'Swastik' : 'Smruti';
}

function validCode(value) {
  return typeof value === 'string' &&
    /^[A-HJ-NP-Z2-9]{5}$/.test(value);
}

function createCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function getRoomState(code) {
  const room = rooms.get(code);
  if (!room) return null;

  return {
    roomCode: code,
    hostId: room.host,
    started: room.started,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      lane: p.lane,
      distance: p.distance,
      coins: p.coins
    }))
  };
}

function emitRoom(code) {
  const state = getRoomState(code);
  if (state) io.to(code).emit('room:state', state);
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;

  if (!room) return;

  room.players.delete(socket.id);
  if (room.host === socket.id && room.players.size) {
    room.host = room.players.keys().next().value;
  }

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (room.started) room.started = false;
  io.to(code).emit('room:player-left', { id: socket.id });
  emitRoom(code);
}

function sendError(socket, message) {
  socket.emit('room:error', { message });
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.lastUpdate = 0;

  socket.on('room:create', (data = {}) => {
    const name = cleanName(data.name);
    if (!name) return sendError(socket, 'Enter a valid player name.');

    leaveRoom(socket);

    const roomCode = createCode();
    const room = {
      host: socket.id,
      started: false,
      players: new Map()
    };

    room.players.set(socket.id, {
      id: socket.id,
      name,
      character: cleanCharacter(data.character),
      lane: 1,
      distance: 0,
      coins: 0
    });

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    socket.emit('room:created', { roomCode });
    emitRoom(roomCode);
  });

  socket.on('room:join', (data = {}) => {
    const roomCode = typeof data.roomCode === 'string'
      ? data.roomCode.trim().toUpperCase() : '';
    const name = cleanName(data.name);

    if (!validCode(roomCode)) {
      return sendError(socket, 'Enter a valid five-character room code.');
    }
    if (!name) return sendError(socket, 'Enter a valid player name.');

    const room = rooms.get(roomCode);
    if (!room) return sendError(socket, 'Room not found. Check the code.');
    if (room.started) return sendError(socket, 'This race has already started.');
    if (room.players.size >= 2) {
      return sendError(socket, 'This room already has two players.');
    }

    leaveRoom(socket);

    room.players.set(socket.id, {
      id: socket.id,
      name,
      character: cleanCharacter(data.character),
      lane: 1,
      distance: 0,
      coins: 0
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    socket.emit('room:joined', { roomCode });
    emitRoom(roomCode);
  });

  socket.on('race:start', (data = {}) => {
    const code = data.roomCode;
    const room = rooms.get(code);

    if (!room || socket.data.roomCode !== code) return;
    if (room.host !== socket.id) {
      return sendError(socket, 'Only the room host can start the race.');
    }
    if (room.players.size !== 2) {
      return sendError(socket, 'Two players are required to start.');
    }
    if (room.started) return;

    const player = room.players.get(socket.id);
    if (player) player.character = cleanCharacter(data.character);

    room.started = true;
    for (const p of room.players.values()) {
      p.distance = 0;
      p.coins = 0;
      p.lane = 1;
    }

    io.to(code).emit('race:started', { roomCode: code });
    emitRoom(code);
  });

  socket.on('player:update', (data = {}) => {
    const code = data.roomCode;
    const room = rooms.get(code);

    if (!room || socket.data.roomCode !== code || !room.started) return;

    const now = Date.now();
    if (now - socket.data.lastUpdate < 80) return;
    socket.data.lastUpdate = now;

    const p = room.players.get(socket.id);
    if (!p) return;

    const lane = Number(data.lane);
    const distance = Number(data.distance);
    const coins = Number(data.coins);

    if (!Number.isInteger(lane) || lane < 0 || lane > 2) return;
    if (!Number.isFinite(distance) || distance < 0 || distance > 100000) return;
    if (!Number.isInteger(coins) || coins < 0 || coins > 10000) return;

    p.character = cleanCharacter(data.character);
    p.lane = lane;
    p.distance = Math.floor(distance);
    p.coins = coins;

    socket.to(code).emit('race:state', {
      players: [...room.players.values()].map((x) => ({
        id: x.id,
        name: x.name,
        character: x.character,
        lane: x.lane,
        distance: x.distance,
        coins: x.coins
      }))
    });
  });

  socket.on('race:finished', (data = {}) => {
    const code = data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.data.roomCode !== code || !room.started) return;

    const p = room.players.get(socket.id);
    if (!p) return;

    const distance = Number(data.distance);
    const coins = Number(data.coins);

    if (!Number.isFinite(distance) || !Number.isInteger(coins)) return;

    p.distance = Math.max(0, Math.min(100000, Math.floor(distance)));
    p.coins = Math.max(0, Math.min(10000, coins));

    socket.to(code).emit('race:state', {
      players: [...room.players.values()].map((x) => ({
        id: x.id,
        name: x.name,
        character: x.character,
        lane: x.lane,
        distance: x.distance,
        coins: x.coins
      }))
    });
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Campus Run server listening on port ${PORT}`);
});
