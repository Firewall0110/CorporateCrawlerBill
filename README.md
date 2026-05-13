# Beat'em Up Game Server

Multiplayer game server for a side-scrolling beat'em up supporting up to 8 players per room.

## Features

- WebSocket-based real-time multiplayer (Socket.io)
- Authoritative server for game state
- Room/session management
- Support for up to 8 players per room
- Physics simulation (gravity, collisions)
- Combat system (punch, kick, special attacks)
- Health and knockback mechanics

## Local Development

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
npm install
```

### Run Locally

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on port 3001 by default (or PORT environment variable).

### API Endpoints

- `GET /health` - Server health check
- `GET /rooms` - List all active game rooms

## Deploying to Railway

### Method 1: GitHub Integration (Recommended)

1. **Create a GitHub repository**
   - Push all server files to a new GitHub repo
   - Include: `package.json`, `server.js`, `GameRoom.js`, `.gitignore`

2. **Deploy on Railway**
   - Go to [Railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Railway will auto-detect Node.js and deploy

3. **Configure Domain**
   - Railway provides a public URL automatically
   - Copy the URL (e.g., `https://your-app.up.railway.app`)
   - You'll need this for the game client

### Method 2: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize and deploy
railway init
railway up
```

### Environment Variables

Railway automatically sets `PORT`. No additional env vars needed for basic setup.

For production CORS, you may want to set:
- `ALLOWED_ORIGIN` - Your game client domain

## Testing the Server

Once deployed, test the endpoints:

```bash
# Health check
curl https://your-app.up.railway.app/health

# List rooms
curl https://your-app.up.railway.app/rooms
```

## Architecture

### Server Components

1. **server.js** - Express + Socket.io server, connection handling
2. **GameRoom.js** - Individual game room logic, physics, combat system

### Game Loop

- Runs at 60 FPS (16.67ms per tick)
- Updates player positions, applies physics
- Checks combat collisions
- Broadcasts state to all clients

### Socket Events

**Client → Server:**
- `createRoom` - Create a new game room
- `joinRoom` - Join existing room
- `playerInput` - Send movement input
- `playerAttack` - Trigger attack

**Server → Client:**
- `roomCreated` - Room created successfully
- `roomJoined` - Successfully joined room
- `gameState` - Game state update (60 FPS)
- `playerJoined` - New player joined
- `playerLeft` - Player disconnected
- `playerHit` - Attack landed
- `playerKnockedOut` - Player defeated
- `gameStarted` - Game begins (2+ players)

## Next Steps

1. Deploy server to Railway
2. Get the public URL
3. Build game client and configure it with server URL
4. Test with multiple browser windows

## Troubleshooting

**Server not starting:**
- Check Node.js version (18+)
- Verify all dependencies installed: `npm install`

**CORS errors:**
- Update CORS origin in `server.js` to match your client domain

**Connection issues:**
- Ensure Railway app is running (check logs)
- Verify WebSocket port is open (Railway handles this automatically)
