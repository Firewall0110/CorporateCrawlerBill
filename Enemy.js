const Unit = require('./Unit');

/**
 * Enemy Class - Extends Unit with enemy-specific logic
 * Enemies have AI behavior and can be spawned in waves
 */

// Stun-lock escape tuning. If a basic mob is comboed (hit again and again before
// it can act) for STUN_LOCK_ESCAPE_MS straight, it panics: leaps away from its
// attacker, gets a brief movement-speed boost, then sprints back to re-engage
// the nearest player. The boss does NOT use this (separate class).
const STUN_LOCK_ESCAPE_MS = 2000; // continuous stun-lock before bailing out
// Two hits count as the same combo if they land within this gap. Comfortably
// longer than the ~500ms hit-stun window so a steady combo chains, but short
// enough that occasional stray hits don't accumulate into a false escape.
const STUN_CHAIN_WINDOW_MS = 900;
const ESCAPE_JUMP_VELOCITY = 13;  // upward leap impulse
const ESCAPE_LEAP_SPEED = 9;      // horizontal leap speed away from attacker
const ESCAPE_MIN_AIR_MS = 450;    // minimum time spent fleeing before re-engaging
const ESCAPE_BOOST_MS = 2500;     // how long the post-escape speed boost lasts
const ESCAPE_BOOST_MULT = 1.8;    // movement-speed multiplier during re-engage

class Enemy extends Unit {
  constructor(id, enemyType = 'basic', baseStats = {}, position = { x: 0, y: 350 }) {
    // Default base stats for enemies
    const defaultStats = {
      maxHealth: 50,
      attack: 8,
      attackSpeed: 1.0,
      armor: 0,
      attackRange: 60,
      movementSpeed: 1.0
    };

    super(id, `${enemyType}-${id}`, { ...defaultStats, ...baseStats }, position);

    this.team = 'enemies';
    this.enemyType = enemyType;

    // AI state
    this.aiState = 'idle'; // idle, moving, attacking, patrolling, escaping
    this.target = null; // Target player (nearest or first)
    this.patrolLeft = position.x - 100;
    this.patrolRight = position.x + 100;
    this.lastAttackTime = 0;

    // Stun-lock escape state
    this.stunLockStart = 0;   // when the current continuous stun-lock began (0 = none)
    this.lastStunHit = 0;     // timestamp of the most recent hit (for chain detection)
    this.escapeUntil = 0;     // minimum time to keep fleeing (airborne leap)
    this.speedBoostUntil = 0; // post-escape movement-speed boost expiry

    // Movement behavior
    this.stoppingDistance = 80; // How close to get to target before attacking
    this.speed = 3;
    this.detectionRange = 300; // How far to "see" the player
  }

  /**
   * Track stun-lock duration. A hit that lands while we're still inside the
   * combo window extends the current stun-lock; a hit after a lull starts a
   * fresh one. updateAI reads stunLockStart to decide when to bail out.
   */
  takeDamage(damage) {
    const now = Date.now();
    if (!this.stunLockStart || now - this.lastStunHit > STUN_CHAIN_WINDOW_MS) {
      this.stunLockStart = now; // fresh combo
    }
    this.lastStunHit = now;
    return super.takeDamage(damage);
  }

  /**
   * 2D Chase AI: Track player on both X and Y axes (depth plane)
   * Like classic beat 'em ups - enemies follow you across the play area
   */
  updateAI(players, deltaTime) {
    if (this.isKnockedOut || players.length === 0) {
      this.velocityX *= 0.85; // Idle friction
      return;
    }

    const now = Date.now();

    // If we've been stun-locked (steadily comboed) for too long, panic-leap away.
    const stunLocked = this.stunLockStart &&
      now - this.lastStunHit <= STUN_CHAIN_WINDOW_MS &&
      now - this.stunLockStart >= STUN_LOCK_ESCAPE_MS;
    if (this.aiState !== 'escaping' && stunLocked) {
      this.startEscape(players, now);
    }

    // While escaping, override normal chase until we've landed clear.
    if (this.aiState === 'escaping') {
      this.updateEscape(now);
      return;
    }

    // Find nearest player (2D distance, but X-weighted for forward-facing AI)
    let nearestPlayer = null;
    let minDistance = this.detectionRange;

    players.forEach(player => {
      if (player.isKnockedOut) return;
      // Weighted 2D distance: X counts more than Y so enemies engage on X axis first
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy * 0.5);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPlayer = player;
      }
    });

    this.target = nearestPlayer;

    if (!this.target) {
      this.aiState = 'patrolling';
      this.patrol();
      return;
    }

    // Temporary speed boost granted right after a stun-lock escape, so the mob
    // sprints back into the fight instead of limping in at base speed.
    const boost = now < this.speedBoostUntil ? ESCAPE_BOOST_MULT : 1;

    // 2D chase: track player on both X (horizontal) and Y (depth plane)
    const xDistance = Math.abs(this.target.x - this.x);
    const yDistance = Math.abs(this.target.y - this.y);

    // Move along Y axis (depth) toward player - simple "tracking" behavior
    const yAlignThreshold = 30; // Stop matching Y when this close
    if (yDistance > yAlignThreshold) {
      const yDir = this.target.y > this.y ? 1 : -1;
      const ySpeed = this.speed * this.effectiveStats.movementSpeed * 0.5 * boost; // Slower Y movement
      this.groundY = (this.groundY || this.y) + yDir * ySpeed;
      this.y = this.groundY; // Follow on ground plane (no jumping for enemies)
    }

    // Check attack range (both X and Y must be close)
    if (xDistance < this.stoppingDistance && yDistance < 50) {
      // Attack!
      this.aiState = 'attacking';
      this.velocityX = 0;
      if (!this.isAttacking && this.attackCooldown <= 0) {
        this.performAttack('punch');
      }
    } else {
      // Chase on X axis
      this.aiState = 'moving';
      const direction = this.target.x > this.x ? 1 : -1;
      this.velocityX = direction * this.speed * this.effectiveStats.movementSpeed * boost;
      this.direction = direction;
    }
  }

  /**
   * Begin a stun-lock escape: leap up and away from the nearest player and arm
   * a short re-engage speed boost. Clears the stun-lock timer so it can't
   * immediately re-trigger.
   */
  startEscape(players, now) {
    // Flee away from the nearest (living) player. Fall back to current facing.
    let nearest = null;
    let minDist = Infinity;
    players.forEach(player => {
      if (player.isKnockedOut) return;
      const d = Math.abs(player.x - this.x);
      if (d < minDist) {
        minDist = d;
        nearest = player;
      }
    });

    const fleeDir = nearest
      ? (nearest.x > this.x ? -1 : 1)  // jump opposite the player
      : (this.direction || 1);

    this.aiState = 'escaping';
    this.isAttacking = false; // cancel any wind-up
    this.isJumping = true;
    this.velocityY = -ESCAPE_JUMP_VELOCITY;
    this.velocityX = fleeDir * ESCAPE_LEAP_SPEED;
    this.direction = fleeDir;
    this.escapeUntil = now + ESCAPE_MIN_AIR_MS;
    this.speedBoostUntil = now + ESCAPE_BOOST_MS;

    // Reset stun-lock tracking so the escape isn't re-triggered next tick.
    this.stunLockStart = 0;
    this.lastStunHit = 0;
  }

  /**
   * Sustain the leap while airborne; exit back to normal chase once we've spent
   * the minimum air time and landed. The re-engage itself runs through the
   * normal chase path (with the speed boost still active).
   */
  updateEscape(now) {
    // Keep driving away horizontally while in the air so friction doesn't stall
    // the leap mid-arc.
    if (this.isJumping) {
      this.velocityX = this.direction * ESCAPE_LEAP_SPEED;
    }

    const landed = !this.isJumping;
    if (now >= this.escapeUntil && landed) {
      // Done fleeing - hand back to normal chase (boost still applies).
      this.aiState = 'moving';
    }
  }


  /**
   * Patrol behavior when no target
   */
  patrol() {
    // Simple left-right patrol
    if (this.x <= this.patrolLeft) {
      this.velocityX = this.speed * this.effectiveStats.movementSpeed;
      this.direction = 1;
    } else if (this.x >= this.patrolRight) {
      this.velocityX = -this.speed * this.effectiveStats.movementSpeed;
      this.direction = -1;
    }
  }

  /**
   * Get enemy state for broadcasting
   */
  getState() {
    const baseState = super.getState();
    return {
      ...baseState,
      enemyType: this.enemyType,
      aiState: this.aiState,
      targetId: this.target ? this.target.id : null
    };
  }
}

module.exports = Enemy;
