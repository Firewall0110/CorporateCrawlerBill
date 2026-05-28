/**
 * Leaderboard - persistent player stats for Corporate Crawler Bill.
 *
 * Why JSON-file persistence (and not SQLite / Postgres)?
 *   - Zero native deps -> no surprise builds breaking on Railway.
 *   - Scale here is tiny (<10k unique names ever realistic).
 *   - Atomic write via tmp-rename gives basic crash safety.
 *   - Easy to inspect, backup, and reset by hand.
 *
 * Persistence on Railway:
 *   - Default file path is ./data/leaderboard.json (works locally).
 *   - For deploys, point LEADERBOARD_PATH at a mounted Volume so the file
 *     survives redeploys: e.g. LEADERBOARD_PATH=/data/leaderboard.json
 *     with a Railway Volume mounted at /data.
 *
 * 2-query contract (per user spec):
 *   - getOrCreatePlayer(name)   - call ONCE when player joins a room. Returns
 *     the row (creates a new zeroed row if name is unseen). The caller
 *     computes luck from the returned ticketsKilled and stashes it on the
 *     Player object - we don't re-query mid-game.
 *   - submitSession(name, deltas) - call ONCE when player leaves / boss
 *     defeated / disconnect. Adds session deltas to lifetime totals and
 *     returns the updated row plus the top-N leaderboard for the UI.
 *
 * Case insensitivity:
 *   - "Bryan", "bryan", "BRYAN" all key the same row (name_lower = lowercase).
 *   - display_name stores the most-recently-used capitalization so the
 *     leaderboard shows whatever flavor the player typed last.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.LEADERBOARD_PATH ||
  path.join(__dirname, '..', 'data', 'leaderboard.json');

// .backup file lives next to the main DB - written AFTER every successful
// save so it's always one-write-behind. Recovery: if the main file is lost
// or corrupt, point LEADERBOARD_PATH at the .backup or copy it manually.
const BACKUP_PATH = DB_PATH + '.backup';

// Schema version - bump when we change the cache shape. migrate() handles
// upgrades on load. Starting at v1 (initial published structure).
const SCHEMA_VERSION = 1;

// ===== Seeds (idempotent - only insert if name doesn't already exist) =====
// Numbers per user spec.
const SEEDS = [
  { name: 'Bryan B',  tickets: 500 },
  { name: 'Bill',     tickets: 500 },
  { name: 'Billy',    tickets: 500 },
  { name: 'Bill B',   tickets: 500 },
  { name: 'Billy B',  tickets: 500 },
  { name: 'Kyle Q',   tickets: 300 },
  { name: 'Adam W',   tickets: 300 },
  { name: 'Ethan M',  tickets: 100 }
];

// ===== In-memory cache + persistence =====
// cache.players is keyed by lowercased name (the case-insensitive lookup key).
let cache = { schema: SCHEMA_VERSION, players: {} };
let saveTimer = null;
let initialized = false;

/**
 * Migrate a loaded cache up to SCHEMA_VERSION. Called once on startup.
 * Each version bump adds a new `if (version < N)` block below; current
 * structure is v1 so this is a no-op for now.
 */
function migrate(parsed) {
  const incoming = parsed.schema || 0;
  if (incoming < 1) {
    // v0 -> v1: ensure top-level `players` exists. Nothing else changed.
    if (!parsed.players) parsed.players = {};
  }
  // Future migrations go here, e.g.:
  // if (incoming < 2) { /* rename field, backfill default, etc. */ }
  parsed.schema = SCHEMA_VERSION;
  return parsed;
}

function ensureDirSync() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function loadFromDisk() {
  // Loud, deploy-visible logging: this is where you verify the volume
  // mount worked after a Railway redeploy.
  console.log(`[Leaderboard] Storage path: ${DB_PATH}`);
  console.log(`[Leaderboard] Backup path:  ${BACKUP_PATH}`);

  const tryParse = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[Leaderboard] Could not parse ${filePath}:`, err.message);
      return null;
    }
  };

  try {
    ensureDirSync();
    // Try main first. If main is missing/corrupt, fall back to backup
    // before giving up and seeding fresh - this is the recovery path.
    let parsed = tryParse(DB_PATH);
    let source = DB_PATH;
    if (!parsed) {
      const fallback = tryParse(BACKUP_PATH);
      if (fallback) {
        console.warn(`[Leaderboard] Main file unreadable, recovered from backup`);
        parsed = fallback;
        source = BACKUP_PATH;
      }
    }
    if (parsed) {
      cache = migrate(parsed);
      console.log(`[Leaderboard] Loaded ${Object.keys(cache.players).length} players (schema v${cache.schema}) from ${source}`);
    } else {
      console.log(`[Leaderboard] No existing file - will seed and create fresh at ${DB_PATH}`);
    }
  } catch (err) {
    console.error('[Leaderboard] Failed to load, starting fresh:', err.message);
    cache = { schema: SCHEMA_VERSION, players: {} };
  }
}

/**
 * Atomic write with rolling backup:
 *   1. Write the new state to a .tmp file.
 *   2. Copy the current main file (if any) to .backup - so the backup is
 *      always one-write-behind, never half-written.
 *   3. Rename .tmp to main - atomic on POSIX filesystems.
 *
 * If the process dies anywhere in this sequence, recovery on next startup
 * is: try main (valid because rename is atomic), else try .backup (valid
 * because it was the previously-saved main).
 */
function saveImmediate() {
  try {
    ensureDirSync();
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    if (fs.existsSync(DB_PATH)) {
      try {
        fs.copyFileSync(DB_PATH, BACKUP_PATH);
      } catch (backupErr) {
        // Backup failure shouldn't block the main save - log and continue.
        console.warn('[Leaderboard] Backup copy failed (continuing):', backupErr.message);
      }
    }
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.error('[Leaderboard] Save failed:', err.message);
  }
}

/**
 * Debounced save - batch multiple rapid updates (e.g. seed + several joins
 * at server startup) into one write. 500ms window is invisible to humans
 * but avoids hammering the disk on bursts.
 */
function saveDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveImmediate();
  }, 500);
}

function seedIfNeeded() {
  const now = new Date().toISOString();
  let added = 0;
  SEEDS.forEach(s => {
    const key = s.name.toLowerCase();
    if (!cache.players[key]) {
      cache.players[key] = {
        displayName: s.name,
        ticketsKilled: s.tickets || 0,
        bossesDefeated: s.bosses || 0,
        crawlsCompleted: s.crawls || 0,
        firstPlayed: now,
        lastPlayed: now,
        seeded: true
      };
      added++;
    }
  });
  if (added > 0) {
    console.log(`[Leaderboard] Seeded ${added} new player(s)`);
    saveDebounced();
  }
}

function init() {
  if (initialized) return;
  initialized = true;
  loadFromDisk();
  seedIfNeeded();
}

// ===== Public API =====

/**
 * Query #1 (per session). Look up player by case-insensitive name. If row
 * doesn't exist, create it with zero stats. Returns the row.
 *
 * Returned shape:
 *   { nameLower, displayName, ticketsKilled, bossesDefeated, crawlsCompleted,
 *     firstPlayed, lastPlayed, isNew }
 */
function getOrCreatePlayer(rawName) {
  init();
  const name = String(rawName || '').trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const now = new Date().toISOString();

  let isNew = false;
  if (!cache.players[key]) {
    cache.players[key] = {
      displayName: name,
      ticketsKilled: 0,
      bossesDefeated: 0,
      crawlsCompleted: 0,
      firstPlayed: now,
      lastPlayed: now
    };
    isNew = true;
    saveDebounced();
  } else {
    // Update display_name to latest capitalization (e.g. "Bryan" -> "BRYAN")
    if (cache.players[key].displayName !== name) {
      cache.players[key].displayName = name;
      saveDebounced();
    }
  }

  return {
    nameLower: key,
    ...cache.players[key],
    isNew
  };
}

/**
 * Query #2 (per session). Add session deltas to the player's lifetime
 * totals and return the updated row + top leaderboard for the UI.
 *
 *   deltas = { ticketsKilled?, bossesDefeated?, crawlsCompleted? }
 *
 * Returned shape:
 *   { player: {...updatedRow}, leaderboard: [...topN] }
 */
function submitSession(rawName, deltas) {
  init();
  const name = String(rawName || '').trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const now = new Date().toISOString();

  if (!cache.players[key]) {
    // Defensive - shouldn't happen since getOrCreatePlayer was called first,
    // but handle gracefully if something weird happened (e.g. the row was
    // wiped between join and end-of-game).
    cache.players[key] = {
      displayName: name,
      ticketsKilled: 0,
      bossesDefeated: 0,
      crawlsCompleted: 0,
      firstPlayed: now,
      lastPlayed: now
    };
  }

  const p = cache.players[key];
  // Capture pre-session totals so the leaderboard screen can show delta:
  const previousTickets = p.ticketsKilled;
  const previousBosses = p.bossesDefeated;
  const previousCrawls = p.crawlsCompleted;

  p.displayName = name;
  p.ticketsKilled += Math.max(0, deltas.ticketsKilled || 0);
  p.bossesDefeated += Math.max(0, deltas.bossesDefeated || 0);
  p.crawlsCompleted += Math.max(0, deltas.crawlsCompleted || 0);
  p.lastPlayed = now;
  saveDebounced();

  return {
    player: { nameLower: key, ...p },
    previousTotals: { previousTickets, previousBosses, previousCrawls },
    leaderboard: getLeaderboard(), // FULL list - the screen scrolls
    globalStats: getGlobalStats()
  };
}

/**
 * Return every player in the leaderboard, sorted by lifetime tickets
 * descending. Pass `limit` if you want a top-N slice; omit (or pass falsy)
 * to get the full roster. Scale is small enough that we don't bother
 * paginating - the entire list is fine to ship over the websocket.
 */
function getLeaderboard(limit) {
  init();
  const all = Object.entries(cache.players)
    .map(([key, p]) => ({
      nameLower: key,
      displayName: p.displayName,
      ticketsKilled: p.ticketsKilled,
      bossesDefeated: p.bossesDefeated,
      crawlsCompleted: p.crawlsCompleted
    }))
    .sort((a, b) => b.ticketsKilled - a.ticketsKilled);
  return limit && limit > 0 ? all.slice(0, limit) : all;
}

/**
 * Aggregate "how many people completed the crawl" / "how many tickets ever
 * defeated" / "how many boss defeats" - used in the leaderboard screen.
 */
function getGlobalStats() {
  init();
  let totalTickets = 0, totalBosses = 0, totalCrawls = 0, playersCompleted = 0;
  Object.values(cache.players).forEach(p => {
    totalTickets += p.ticketsKilled;
    totalBosses += p.bossesDefeated;
    totalCrawls += p.crawlsCompleted;
    if (p.crawlsCompleted > 0) playersCompleted++;
  });
  return { totalTickets, totalBosses, totalCrawls, playersCompleted };
}

/**
 * Convert a player's lifetime tickets into a luck score that's subtracted
 * from each 1-100 attribute-tier roll. See CharacterAttributes.rollTier()
 * for how the roll maps to tiers.
 *
 * Curve: 1 luck per 10 tickets killed, capped at 99. At 990 tickets,
 * EVERY roll resolves to celestial because (max roll 100) - 99 = 1.
 *
 * Why cap at 99 not 100: with luck=99, even a max roll of 100 yields
 * adjusted_roll = 1 = celestial. luck=100 would be redundant.
 */
function computeLuck(ticketsKilled) {
  return Math.min(99, Math.max(0, Math.floor(ticketsKilled / 10)));
}

// EAGER INIT at module load. Previously init() was lazy (deferred to the
// first user action) so the [Leaderboard] startup logs only printed when
// somebody actually created/joined a room. That made it hard to verify a
// Railway Volume mount worked - if no player happened to click "create
// room" before the container got rolling-deployed away, no logs appeared.
// Running init() here means the storage-path + load-source logs print
// IMMEDIATELY at server start, every deploy. Visible in the Railway deploy
// log so you can tell at a glance whether the volume is wired up right.
init();

module.exports = {
  getOrCreatePlayer,
  submitSession,
  getLeaderboard,
  getGlobalStats,
  computeLuck
};
