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
 */

// unitId -> { token, attackLocalStart, koLocalStart, lastSeen }
const _clocks = new Map();

function clockFor(id, now) {
  let clk = _clocks.get(id);
  if (!clk) {
    clk = { token: null, attackLocalStart: 0, koLocalStart: 0, lastSeen: now };
    _clocks.set(id, clk);
  }
  clk.lastSeen = now;
  return clk;
}

/**
 * Returns { elapsed, duration, progress } for a unit's current attack, timed on
 * the client clock, or null if the unit isn't attacking. `progress` is 0..1.
 * `unit.attackSeq` is used ONLY for equality (new-attack detection) - never math.
 */
export function getAttackAnim(unit, now) {
  if (!unit || !unit.isAttacking) return null;
  const duration = unit.attackDuration || 300;

  // Defensive: a unit with no stable id can't be tracked across broadcasts.
  // Fall back to a free-running cycle so the attack still visibly animates
  // rather than freezing on frame 0. (In practice every unit has an id.)
  if (unit.id == null) {
    const e = now % duration;
    return { elapsed: e, duration, progress: e / duration };
  }

  const clk = clockFor(unit.id, now);
  // New attack instance (including a repeat of the same type) -> restart clock.
  if (clk.token !== unit.attackSeq) {
    clk.token = unit.attackSeq;
    clk.attackLocalStart = now;
  }
  const elapsed = now - clk.attackLocalStart;
  return { elapsed, duration, progress: Math.min(1, elapsed / duration) };
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
