const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const GameRoom = require('./GameRoom');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*", // In production, specify your client domain
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store active game rooms
const gameRooms = new Map();
const MAX_PLAYERS_PER_ROOM = 8;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: gameRooms.size,
    timestamp: Date.now()
  });
});

// Get list of available rooms
app.get('/rooms', (req, res) => {
  const roomList = Array.from(gameRooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    playerCount: room.getPlayerCount(),
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    status: room.status
  }));
  res.json({ rooms: roomList });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create a new game room
  socket.on('createRoom', ({ roomName, playerData }) => {
    const roomId = generateRoomId();
    const room = new GameRoom(roomId, roomName, io);
    gameRooms.set(roomId, room);
    
    socket.join(roomId);
    room.addPlayer(socket.id, playerData);
    
    socket.emit('roomCreated', { 
      roomId, 
      playerId: socket.id,
      gameState: room.getState()
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
    
    socket.join(roomId);
    room.addPlayer(socket.id, playerData);
    
    socket.emit('roomJoined', { 
      roomId, 
      playerId: socket.id,
      gameState: room.getState()
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
