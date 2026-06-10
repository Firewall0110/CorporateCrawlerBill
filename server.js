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
// DoS guards: cap total concurrent rooms and how many a single socket can
// spin up (each room runs its own 60Hz simulation + broadcast loop).
const MAX_ROOMS = 100;
const MAX_ROOMS_PER_SOCKET = 4;
const MAX_NAME_LEN = 24;

// Self-contained admin page (served at GET /admin). Plain HTML+JS, no build
// step. All mutations POST to /api/admin/player with the admin token, which
// is verified server-side; the page is useless without the token.
const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CCB Leaderboard Admin</title>
<style>
  body { background:#0a0018; color:#e8e8f0; font-family:ui-monospace,Menlo,Consolas,monospace; max-width:760px; margin:0 auto; padding:24px; }
  h1 { color:#ffee33; text-shadow:0 0 12px #ff8800; }
  p.sub { color:#88a; font-size:13px; margin-top:-8px; }
  label { display:block; margin:12px 0 4px; font-size:13px; color:#9cf; }
  input, select { width:100%; padding:9px; background:#1a1030; color:#fff; border:1px solid #4455cc; border-radius:5px; box-sizing:border-box; font-family:inherit; font-size:14px; }
  .row { display:flex; gap:12px; }
  .row > div { flex:1; }
  .btns { margin-top:18px; display:flex; gap:12px; }
  button { padding:12px 20px; border:none; border-radius:5px; font-weight:bold; cursor:pointer; font-family:inherit; font-size:14px; }
  button.apply { background:#33ff66; color:#001; }
  button.lookup { background:#3399ff; color:#012; }
  button.danger { background:#ff4455; color:#fff; }
  #msg { margin-top:16px; padding:10px 12px; border-radius:5px; min-height:18px; font-size:13px; }
  #msg.ok { background:rgba(51,255,102,0.15); color:#9f9; }
  #msg.err { background:rgba(255,80,80,0.18); color:#f99; }
  table { width:100%; margin-top:28px; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid #2a2a44; }
  th { color:#ffee33; }
  td.num { text-align:right; }
</style>
</head>
<body>
  <h1>&#9733; CCB Leaderboard Admin</h1>
  <p class="sub">Adjust a player's lifetime stats. Case-insensitive name. Changes persist instantly (cache + disk).</p>

  <label>Admin token</label>
  <input id="token" type="password" placeholder="ADMIN_TOKEN value" autocomplete="off">

  <label>Player name</label>
  <input id="name" type="text" placeholder="e.g. Bryan B" autocomplete="off">

  <label>Mode</label>
  <select id="mode">
    <option value="set">Set &mdash; absolute value</option>
    <option value="add">Add &mdash; delta (can be negative)</option>
  </select>

  <div class="row">
    <div><label>Tickets</label><input id="tickets" type="number" placeholder="blank = no change"></div>
    <div><label>Bosses</label><input id="bosses" type="number" placeholder="blank"></div>
    <div><label>Crawls</label><input id="crawls" type="number" placeholder="blank"></div>
  </div>

  <div class="btns">
    <button class="lookup" onclick="lookup()">Look up current</button>
    <button class="apply" onclick="apply()">Apply changes</button>
    <button class="danger" onclick="del()">Delete player</button>
  </div>
  <div id="msg"></div>

  <table id="board">
    <thead><tr><th>#</th><th>Name</th><th class="num">Tickets</th><th class="num">Bosses</th><th class="num">Crawls</th></tr></thead>
    <tbody></tbody>
  </table>

<script>
  function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  function setMsg(t, cls){ var m=document.getElementById('msg'); m.textContent=t; m.className=cls||''; }
  function $(id){ return document.getElementById(id); }

  async function refresh() {
    try {
      const r = await fetch('/api/leaderboard');
      const data = await r.json();
      const tb = document.querySelector('#board tbody');
      tb.innerHTML = '';
      (data.leaderboard||[]).forEach(function(p,i){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>'+(i+1)+'</td><td>'+esc(p.displayName)+'</td>'+
          '<td class="num">'+p.ticketsKilled+'</td>'+
          '<td class="num">'+p.bossesDefeated+'</td>'+
          '<td class="num">'+p.crawlsCompleted+'</td>';
        tb.appendChild(tr);
      });
    } catch(e){ setMsg('Could not load leaderboard: '+e.message, 'err'); }
  }

  async function lookup() {
    const name = $('name').value.trim().toLowerCase();
    if (!name) { setMsg('Enter a player name first.', 'err'); return; }
    const r = await fetch('/api/leaderboard');
    const data = await r.json();
    const p = (data.leaderboard||[]).find(function(x){
      return x.nameLower===name || (x.displayName||'').toLowerCase()===name;
    });
    if (p) {
      $('tickets').value = p.ticketsKilled;
      $('bosses').value = p.bossesDefeated;
      $('crawls').value = p.crawlsCompleted;
      $('mode').value = 'set';
      setMsg('Loaded "'+p.displayName+'" in SET mode. Edit the values and Apply.', 'ok');
    } else {
      $('tickets').value = ''; $('bosses').value=''; $('crawls').value='';
      setMsg('No existing player "'+name+'". Applying will CREATE them.', 'err');
    }
  }

  async function apply() {
    const body = {
      token: $('token').value,
      name: $('name').value,
      mode: $('mode').value,
      ticketsKilled: $('tickets').value,
      bossesDefeated: $('bosses').value,
      crawlsCompleted: $('crawls').value
    };
    if (!body.token) { setMsg('Enter the admin token.', 'err'); return; }
    if (!body.name.trim()) { setMsg('Enter a player name.', 'err'); return; }
    try {
      const r = await fetch('/api/admin/player', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (r.ok) {
        const p = data.player;
        setMsg('Updated "'+p.displayName+'": tickets='+p.ticketsKilled+
               ' bosses='+p.bossesDefeated+' crawls='+p.crawlsCompleted, 'ok');
        refresh();
      } else {
        setMsg('Error '+r.status+': '+(data.error||'unknown'), 'err');
      }
    } catch(e){ setMsg('Request failed: '+e.message, 'err'); }
  }

  async function del() {
    const name = $('name').value.trim();
    if (!name) { setMsg('Enter a player name to delete.', 'err'); return; }
    if (!$('token').value) { setMsg('Enter the admin token.', 'err'); return; }
    if (!confirm('Permanently delete "'+name+'" from the leaderboard? This cannot be undone.')) return;
    try {
      const r = await fetch('/api/admin/delete', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: $('token').value, name: name })
      });
      const data = await r.json();
      if (r.ok) {
        setMsg('Deleted "'+data.deleted+'".', 'ok');
        $('tickets').value=''; $('bosses').value=''; $('crawls').value='';
        refresh();
      } else {
        setMsg('Error '+r.status+': '+(data.error||'unknown'), 'err');
      }
    } catch(e){ setMsg('Request failed: '+e.message, 'err'); }
  }

  refresh();
</script>
</body>
</html>`;

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

// ===== Leaderboard admin =====
// Token-gated. Set ADMIN_TOKEN as a Railway env var to enable. If it's
// unset, the admin endpoint and page are disabled (no default password).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// POST /api/admin/player - adjust a player's lifetime stats.
// Body: { token, name, mode:'set'|'add', ticketsKilled?, bossesDefeated?, crawlsCompleted? }
app.post('/api/admin/player', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Admin disabled. Set the ADMIN_TOKEN env var to enable.' });
  }
  const { token, name, mode, ticketsKilled, bossesDefeated, crawlsCompleted } = req.body || {};
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Bad admin token.' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Player name is required.' });
  }
  const fields = { ticketsKilled, bossesDefeated, crawlsCompleted };
  const updated = Leaderboard.adminAdjustPlayer(name, fields, mode === 'add' ? 'add' : 'set');
  res.json({ ok: true, player: updated, leaderboard: Leaderboard.getLeaderboard() });
});

// POST /api/admin/delete - permanently remove a player row.
// Body: { token, name }
app.post('/api/admin/delete', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Admin disabled. Set the ADMIN_TOKEN env var to enable.' });
  }
  const { token, name } = req.body || {};
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Bad admin token.' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Player name is required.' });
  }
  const result = Leaderboard.adminDeletePlayer(name);
  if (!result.deleted) {
    return res.status(404).json({ error: 'No player found named "' + name + '".' });
  }
  res.json({ ok: true, deleted: result.displayName, leaderboard: Leaderboard.getLeaderboard() });
});

// GET /admin - self-contained admin page (must be registered BEFORE the
// React catch-all below, or it'd serve the game's index.html instead).
// The page itself is harmless without the token; all mutations require it.
app.get('/admin', (req, res) => {
  res.type('html').send(ADMIN_PAGE_HTML);
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
  // Clamp the name once, here, so both the in-game Player and the persistent
  // leaderboard row use the same bounded string (prevents unbounded names from
  // becoming permanent leaderboard rows / oversized broadcasts).
  const name = (playerData && playerData.name)
    ? String(playerData.name).trim().slice(0, MAX_NAME_LEN)
    : '';
  if (!name) {
    return { ...playerData, name, luck: 0, lifetimeTickets: 0, isNewPlayer: true };
  }
  try {
    const row = Leaderboard.getOrCreatePlayer(name);
    const luck = Leaderboard.computeLuck(row.ticketsKilled);
    console.log(`[Leaderboard] ${name} (lifetime tickets=${row.ticketsKilled}, luck=${luck}${row.isNew ? ', NEW' : ''})`);
    return {
      ...playerData,
      name,
      luck,
      lifetimeTickets: row.ticketsKilled,
      isNewPlayer: !!row.isNew
    };
  } catch (err) {
    console.error('[Leaderboard] lookup failed for', name, '-', err.message);
    return { ...playerData, name, luck: 0, lifetimeTickets: 0, isNewPlayer: false };
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Wrap every handler: coerce a missing payload to {} (so destructuring can't
  // throw) and catch any exception. Socket.IO does NOT catch handler errors, so
  // without this a single malformed packet would crash the whole Node process
  // and take down every room.
  const on = (event, handler) => {
    socket.on(event, (payload) => {
      try {
        handler(payload && typeof payload === 'object' ? payload : {});
      } catch (err) {
        console.error(`[socket] handler '${event}' failed for ${socket.id}:`, err.message);
      }
    });
  };

  // Create a new game room
  on('createRoom', ({ roomName, playerData }) => {
    if (gameRooms.size >= MAX_ROOMS) {
      socket.emit('error', { message: 'Server is at capacity - try again shortly' });
      return;
    }
    if (roomsForSocket(socket.id) >= MAX_ROOMS_PER_SOCKET) {
      socket.emit('error', { message: 'Too many open rooms for this connection' });
      return;
    }

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
  on('joinRoom', ({ roomId, playerData }) => {
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
  on('playerInput', ({ roomId, input }) => {
    if (!input || typeof input !== 'object') return;
    const room = gameRooms.get(roomId);
    if (room) {
      room.handlePlayerInput(socket.id, input);
    }
  });

  // Handle player attack
  on('playerAttack', ({ roomId, attackType }) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.handlePlayerAttack(socket.id, attackType);
    }
  });

  // Handle player respawn (continue after game over)
  on('playerContinue', ({ roomId }) => {
    const room = gameRooms.get(roomId);
    if (room) {
      room.respawnPlayer(socket.id);
    }
  });

  // Player picked one of the three offered attribute choices
  on('selectAttribute', ({ roomId, key, tier }) => {
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
  // Loop until we get an id not already in use, so a collision can't hijack
  // or clobber an existing room.
  let id;
  do {
    id = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (gameRooms.has(id));
  return id;
}

// How many active rooms this socket is currently a member of (room-spam guard).
function roomsForSocket(socketId) {
  let n = 0;
  gameRooms.forEach((room) => { if (room.hasPlayer(socketId)) n++; });
  return n;
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
