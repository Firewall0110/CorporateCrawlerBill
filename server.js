const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const GameRoom = require('./GameRoom');
const Leaderboard = require('./db/Leaderboard');

const app = express();
const server = http.createServer(app);

// Configure Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

// Serve static files from React build directory
const buildPath = path.join(__dirname, 'build');
app.use(express.static(buildPath));

// Store active game rooms
const gameRooms = new Map();
const MAX_PLAYERS_PER_ROOM = 8;

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: gameRooms.size,
    timestamp: Date.now()
  });
});

// Read-only leaderboard endpoint. Useful for verifying persistence after
// a Railway redeploy: hit this URL, compare counts to what you saw before
// the push. Also handy for any future external dashboard. Query ?limit=N
// to trim the list.
app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 0;
  res.json({
    leaderboard: Leaderboard.getLeaderboard(limit),
    globalStats: Leaderboard.getGlobalStats()
  });
});

app.get('/api/rooms', (req, res) => {
  // Hide rooms that have already cleared the boss ('finished' status) so
  // new joiners can't crash a victory screen / leaderboard. The room
  // object stays in memory until its last player disconnects (so the
  // existing players keep getting socket events), but it's no longer
  // advertised as joinable.
  const roomList = Array.from(gameRooms.values())
    .filter(room => room.status !== 'finished')
    .map(room => ({
      id: room.id,
      name: room.name,
      playerCount: room.getPlayerCount(),
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      status: room.status
    }));
  res.json({ rooms: roomList });
});

// Serve React app for all non-API routes (client-side routing)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

/**
 * Persistent-leaderboard Query #1 (per session):
 * Look up the player by case-insensitive name (creating a zeroed row if
 * unseen) and compute their starting luck. The result is merged into
 * playerData before calling room.addPlayer so the Player object gets its
 * luck and starts ticking session stats from zero. This is the ONLY DB
 * read we do per session - we don't refresh mid-game.
 */
function resolvePlayerLuck(playerData) {
  const name = (playerData && playerData.name) ? String(playerData.name).trim() : '';
  if (!name) {
    return { ...playerData, luck: 0, lifetimeTickets: 0, isNewPlayer: true };
  }
  try {
    const row = Leaderboard.getOrCreatePlayer(name);
    const luck = Leaderboard.computeLuck(row.ticketsKilled);
    console.log(`[Leaderboard] ${name} (lifetime tickets=${row.ticketsKilled}, luck=${luck}${row.isNew ? ', NEW' : ''})`);
    return {
      ...playerData,
      luck,
      lifetimeTickets: row.ticketsKilled,
      isNewPlayer: !!row.isNew
    };
  } catch (err) {
    console.error('[Leaderboard] lookup failed for', name, '-', err.message);
    return { ...playerData, luck: 0, lifetimeTickets: 0, isNewPlayer: false };
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create a new game room
  socket.on('createRoom', ({ roomName, playerData }) => {
    const roomId = generateRoomId();
    const room = new GameRoom(roomId, roomName, io);
    gameRooms.set(roomId, room);

    socket.join(roomId);
    const enriched = resolvePlayerLuck(playerData);
    room.addPlayer(socket.id, enriched);

    socket.emit('roomCreated', {
      roomId,
      playerId: socket.id,
      gameState: room.getState(),
      lifetimeTickets: enriched.lifetimeTickets,
      luck: enriched.luck
    });

    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  // Join an existing room
  socket.on('joinRoom', ({ roomId, playerData }) => {
    const room = gameRooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.getPlayerCount() >= MAX_PLAYERS_PER_ROOM) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    // Guard against stale room IDs / direct-link joins after the boss has
    // been defeated. The /api/rooms listing already filters these out, but
    // a client with a cached id could still try.
    if (room.status === 'finished') {
      socket.emit('error', { message: 'Room already finished - start a new run' });
      return;
    }

    socket.join(roomId);
    const enriched = resolvePlayerLuck(playerData);
    room.addPlayer(socket.id, enriched);

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id,
      gameState: room.getState(),
      lifetimeTickets: enriched.lifetimeTickets,
      luck: enriched.luck
    });

    console.log(`Player ${socket.id} joined room ${roomId}`);
  });

  // Handle player input
  socket.on('playerInput', ({ roomId, input }) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.handlePlayerInput(socket.id, input);
    }
  });

  // Handle player attack
  socket.on('playerAttack', ({ roomId, attackType }) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.handlePlayerAttack(socket.id, attackType);
    }
  });

  // Handle player respawn (continue after game over)
  socket.on('playerContinue', ({ roomId }) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.respawnPlayer(socket.id);
    }
  });

  // Player picked one of the three offered attribute choices
  socket.on('selectAttribute', ({ roomId, key, tier }) => {
    const room = gameRooms.get(roomId);
    if (room && typeof key === 'string' && typeof tier === 'string') {
      room.applyAttributeSelection(socket.id, key, tier);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Remove player from all rooms
    gameRooms.forEach((room, roomId) => {
      if (room.hasPlayer(socket.id)) {
        room.removePlayer(socket.id);
        
        // Delete room if empty
        if (room.getPlayerCount() === 0) {
          room.stop();
          gameRooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

// Cleanup empty rooms periodically
setInterval(() => {
  gameRooms.forEach((room, roomId) => {
    if (room.getPlayerCount() === 0 && room.isStale()) {
      room.stop();
      gameRooms.delete(roomId);
      console.log(`Room ${roomId} cleaned up (stale)`);
    }
  });
}, 60000); // Every minute

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
