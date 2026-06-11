/**
 * AnimClock - per-unit, CLIENT-LOCAL animation clocks.
 *
 * Why this exists:
 *   Time-anchored animations (attack swings, knockdown) need to know how long
 *   they've been playing. The server can't tell us directly: its attackStartTime
 *   is a Date.now() on a DIFFERENT machine, so `clientNow - serverStartTime` is
 *   corrupted by clock skew (fine on localhost, broken across a network). And we
 *   can't stash the start time on the unit object either - the client replaces
 *   every unit object on each gameState broadcast (~30Hz), wiping any field we
 *   set (this is exactly why the old `unit._koStartTime` approach was stuck on
 *   frame 0).
 *
 * The fix: a module-level registry keyed by stable unit id that SURVIVES
 * broadcasts. The server sends only an opaque `attackSeq` change-token; when it
 * changes we stamp a fresh start time from the CLIENT'S own clock and measure
 * elapsed locally. Sprite frames and attack FX both pull from here, so they stay
 * in lockstep.
 *
 * The on-screen swing for a player can INTENTIONALLY outlast the server's hit
 * window (see ATTACK_FRAME_MS): the server keeps isAttacking true for only
 * ~150ms (punch), but we play a 250ms held animation. Because this is timed on
 * the client clock and re-armed by attackSeq, attack-speed buffs are unaffected
 * - a faster next swing simply interrupts (restarts) the current one, so the
 * visual auto-compresses to match the real cadence.
 */

// Player-only per-frame HOLD tables (ms per sprite frame, indices 0..6). The
// sum is the on-screen swing length. Front frames flick by; the max-extension
// frame (#3, with #4 as the punch's contact follow-through) hangs ~3x longer
// for a weighty "lands and holds" read. These are pure feel knobs - tune freely.
export const ATTACK_FRAME_MS = {
  punch: [18, 18, 22, 70, 55, 35, 32], // sum 250 - hold #3 (extension) + #4 (contact)
  kick:  [35, 35, 45, 150, 95, 75, 65], // sum 500 - hold #3 (leg fully out)
};

function sum(arr) { let s = 0; for (const v of arr) s += v; return s; }

// How long the on-screen swing lasts (ms). Players with a hold table use its
// total (which outlasts the server window); everyone else - enemies, special,
// any unit without a table - uses the server's own attackDuration, so their
// timing is exactly as before.
function visualTotalFor(unit) {
  if (unit.team === 'players' && ATTACK_FRAME_MS[unit.attackType]) {
    return sum(ATTACK_FRAME_MS[unit.attackType]);
  }
  return unit.attackDuration || 300;
}

// unitId -> { token, attackLocalStart, attackActive, koLocalStart, lastSeen }
const _clocks = new Map();

function clockFor(id, now) {
  let clk = _clocks.get(id);
  if (!clk) {
    clk = { token: null, attackLocalStart: 0, attackActive: false, koLocalStart: 0, lastSeen: now };
    _clocks.set(id, clk);
  }
  clk.lastSeen = now;
  return clk;
}

/**
 * Returns { elapsed, duration, progress } for a unit's current attack, timed on
 * the client clock, or null if no swing is currently playing. `progress` is
 * 0..1 over the VISUAL duration (which may be longer than the server's hit
 * window). `unit.attackSeq` is used ONLY for equality (new-attack detection).
 */
export function getAttackAnim(unit, now) {
  if (!unit) return null;
  const total = visualTotalFor(unit);

  // No stable id: can't persist across broadcasts. Free-run a cycle while the
  // server says we're attacking so it still animates (in practice unreachable).
  if (unit.id == null) {
    if (!unit.isAttacking) return null;
    const e = now % total;
    return { elapsed: e, duration: total, progress: e / total };
  }

  const clk = clockFor(unit.id, now);

  // A downed unit isn't swinging - the KO animation owns it.
  if (unit.isKnockedOut) { clk.attackActive = false; return null; }

  // Rising edge of a NEW attack (token = attackSeq): stamp a client-local start
  // and arm the swing. We ONLY arm on observing isAttacking===true, so a unit
  // first seen with a stale attackSeq (e.g. joining mid-game) never replays.
  if (unit.isAttacking && clk.token !== unit.attackSeq) {
    clk.token = unit.attackSeq;
    clk.attackLocalStart = now;
    clk.attackActive = true;
  }

  if (!clk.attackActive) return null;

  const elapsed = now - clk.attackLocalStart;
  if (elapsed >= total) {        // swing finished on the client clock (this may
    clk.attackActive = false;    // be a beat AFTER the server cleared isAttacking)
    return null;
  }
  return { elapsed, duration: total, progress: Math.min(1, elapsed / total) };
}

/**
 * Frame index from a per-frame ms hold table, given client-local elapsed ms.
 * Past the end of the table -> holds the final frame.
 */
export function frameFromTable(table, elapsed) {
  let acc = 0;
  for (let i = 0; i < table.length; i++) {
    acc += table[i];
    if (elapsed < acc) return i;
  }
  return table.length - 1;
}

/**
 * Client-local elapsed (ms) since this unit was first rendered knocked out.
 * Resets whenever the unit is rendered alive again, so a die->respawn->die
 * cycle replays the knockdown from the top. Returns 0 when not knocked out.
 */
export function getKoElapsed(unit, now) {
  if (!unit || unit.id == null) return 0;
  const clk = clockFor(unit.id, now);
  if (unit.isKnockedOut) {
    if (!clk.koLocalStart) clk.koLocalStart = now;
    return now - clk.koLocalStart;
  }
  clk.koLocalStart = 0;
  return 0;
}

/**
 * Drop clock entries for units that no longer exist, so a long session full of
 * spawned-and-killed enemies doesn't leak entries forever. Call periodically
 * (throttled) from the render loop with the set of currently-live unit ids.
 */
export function pruneAnimClocks(liveIds) {
  for (const id of _clocks.keys()) {
    if (!liveIds.has(id)) _clocks.delete(id);
  }
}

/** Wipe everything - call when leaving the game screen / unmounting. */
export function resetAnimClocks() {
  _clocks.clear();
}
