/**
 * Base Unit Class - Foundation for all game units (players, enemies, bosses)
 * Handles base stats, effective stats computation, and modifier management
 */

// BALANCE KNOBS: armor model (applies to EVERY unit - players, enemies, boss).
// Effective armor is clamped to a max of MAX_EFFECTIVE_ARMOR. The mitigation
// curve is LINEAR: armor 0 -> 0% reduction, armor MAX -> ARMOR_MAX_MITIGATION.
//   mitigation = min(armor, 120) / 120 * 0.85   (so 120 armor = 85% less damage)
// Special attacks IGNORE armor entirely (takeDamage(dmg, true)).
// NEGATIVE armor AMPLIFIES incoming damage by +100% per -10 armor:
//   x(1 + |armor|/10)  ->  -10 = x2, -20 = x3, -30 = x4, ...
// so enemy-armor-shred picks can snowball a fight. Dial here during playtest.
const MAX_EFFECTIVE_ARMOR = 120;
const ARMOR_MAX_MITIGATION = 0.85;

class Unit {
  constructor(id, name, baseStats, position = { x: 0, y: 0 }) {
    this.id = id;
    this.name = name;

    // Base stats (immutable defaults for this unit type)
    this.baseStats = {
      maxHealth: 100,
      attack: 10,
      attackSpeed: 1.0,
      armor: 0,
      attackRange: 60,
      movementSpeed: 1.0,
      ...baseStats // Allow overrides
    };

    // Effective stats (computed from base + modifiers)
    this.effectiveStats = { ...this.baseStats };

    // Position and physics
    // x: horizontal position in world
    // y: visual Y position (where unit is rendered, includes jump offset)
    // groundY: the "floor" Y position (depth plane), tracked separately for jumps
    this.x = position.x;
    this.y = position.y;
    this.groundY = position.y; // Current depth position on the play plane
    this.width = 40;
    this.height = 60;
    this.velocityX = 0;
    this.velocityY = 0;

    // Health state
    this.health = this.baseStats.maxHealth;
    this.maxHealth = this.baseStats.maxHealth;

    // Animation state
    this.isAttacking = false;
    this.attackStartTime = 0;
    this.attackDuration = 300;
    // Opaque per-unit attack-instance counter, bumped on every performAttack.
    // Broadcast to clients so they can detect when a NEW attack starts (even a
    // repeat of the same type) and (re)stamp a CLIENT-LOCAL animation clock.
    // We deliberately never broadcast attackStartTime: it's a server Date.now()
    // and the client's now is a different machine's Date.now(), so any
    // client-side `now - attackStartTime` is corrupted by clock skew. Animations
    // must be timed on the client's own clock; attackSeq is just the trigger.
    this.attackSeq = 0;
    // Punch and kick share this recovery timer. The special ability has its own
    // independent cooldown (specialCooldown) so its long 5s recharge does NOT
    // lock out basic punches/kicks - they're separate buttons with separate
    // cooldown sweeps on the client.
    this.attackCooldown = 0;
    this.specialCooldown = 0;
    this.hasHit = false;
    this.isKnockedOut = false;
    this.lastHitTime = 0; // Used for hit flash effect on client
    this.attackType = 'punch'; // Tracks last attack type for animations

    // Movement state
    this.isJumping = false;
    this.direction = 1; // 1 = right, -1 = left

    // Latest depth-movement intent from handleInput. Up/down is APPLIED in
    // update() (once per server tick) rather than per input packet, so a
    // client spamming playerInput can't move faster on the Y axis than the
    // tick rate allows. Horizontal already works this way via velocityX.
    this.currentInput = { up: false, down: false };

    // Visual
    this.color = '#ffffff';
    this.sprite = null;

    // Team identifier
    this.team = 'neutral'; // 'players' or 'enemies' or 'neutral'

    // Character attributes (modifiers from this unit, if player)
    this.attributes = []; // Array of { name, modifier: { target, value, appliesToTeam } }

    // Global modifiers applied to this unit (from other players' attributes)
    this.modifiers = []; // Array of { source: playerId, target, value }
  }

  /**
   * Recompute effective stats based on all active modifiers
   * Called when: level starts, player joins, player leaves
   * @param {Array} allActiveModifiers - Array of modifier objects (not attribute objects)
   */
  recomputeEffectiveStats(allActiveModifiers = []) {
    // Start with base stats
    this.effectiveStats = { ...this.baseStats };

    // Apply all modifiers from active player attributes
    allActiveModifiers.forEach(mod => {
      // Each mod is already a modifier object: { target, value, appliesToTeam }
      if (!mod || !mod.target) return;

      // Check if modifier applies to this unit.
      //   'all'                 -> every unit
      //   'players' / 'enemies' -> matches the unit's team
      //   'boss'                -> only the boss. A boss keeps team 'enemies'
      //                            so generic enemy debuffs still hit it, but
      //                            'boss'-targeted modifiers (e.g. Minimum
      //                            Viable Product) skip the regular mooks.
      const appliesTo = mod.appliesToTeam || 'all';
      if (appliesTo === 'boss') {
        if (!this.isBoss) return; // Only the boss; mooks/players are unaffected.
      } else if (appliesTo !== 'all' && appliesTo !== this.team) {
        return; // Skip if doesn't apply to this team
      }

      // Apply modifier based on type
      if (mod.target === 'attack') {
        this.effectiveStats.attack *= mod.value;
      } else if (mod.target === 'maxHealth') {
        this.effectiveStats.maxHealth *= mod.value;
      } else if (mod.target === 'armor') {
        this.effectiveStats.armor = (this.effectiveStats.armor || 0) + mod.value;
      } else if (mod.target === 'attackSpeed') {
        this.effectiveStats.attackSpeed *= mod.value;
      } else if (mod.target === 'movementSpeed') {
        this.effectiveStats.movementSpeed *= mod.value;
      } else if (mod.target === 'attackRange') {
        this.effectiveStats.attackRange *= mod.value;
      }
    });

    // Round the derived max so stacked percentage modifiers can't leave
    // float drift in the HUD (e.g. "220/220.00000000000003" on the overhead
    // HP bar). Base stats are untouched - only the effective value rounds.
    this.effectiveStats.maxHealth = Math.round(this.effectiveStats.maxHealth);

    // Clamp the UPPER bound of effective armor after all modifiers (cap at
    // MAX_EFFECTIVE_ARMOR = 85% mitigation). Negative armor is intentionally
    // NOT clamped - it amplifies incoming damage in takeDamage().
    this.effectiveStats.armor = Math.min(MAX_EFFECTIVE_ARMOR, this.effectiveStats.armor || 0);

    // Sync health to new maxHealth (cap if needed)
    this.maxHealth = this.effectiveStats.maxHealth;
    if (this.health > this.maxHealth) {
      this.health = this.maxHealth;
    }
  }

  /**
   * Apply damage to this unit
   */
  takeDamage(damage, ignoreArmor = false) {
    let finalDamage;
    if (ignoreArmor) {
      // Special attacks pierce armor entirely - neither mitigated nor amplified.
      finalDamage = damage;
    } else {
      const armor = this.effectiveStats.armor || 0;
      if (armor >= 0) {
        // Linear: 0 armor -> 0% off, MAX armor -> ARMOR_MAX_MITIGATION off.
        const mitigation = Math.min(armor, MAX_EFFECTIVE_ARMOR) / MAX_EFFECTIVE_ARMOR * ARMOR_MAX_MITIGATION;
        finalDamage = damage * (1 - mitigation);
      } else {
        // Negative armor amplifies: -10 -> x2, -20 -> x3, ...
        finalDamage = damage * (1 + (-armor) / 10);
      }
    }
    finalDamage = Math.max(1, finalDamage);

    this.health -= finalDamage;

    // Apply hit-stun ONLY to enemies. For players, hit-stun was making the
    // client cooldown UI lie — the ability appeared ready but the server
    // silently rejected the press because attackCooldown had been reset on
    // hit. Players should always be able to fight back. Enemies still
    // stagger so the player gets reward for landing combos.
    if (this.team !== 'players') {
      this.attackCooldown = 0.5 / this.effectiveStats.attackSpeed;
    }

    if (this.health <= 0) {
      this.health = 0;
      this.isKnockedOut = true;
    }

    return finalDamage;
  }

  /**
   * Restore health
   */
  heal(amount) {
    this.health = Math.min(this.health + amount, this.maxHealth);
  }

  /**
   * Apply knockback to this unit. `lift` is the upward pop (default a small 3);
   * a kick passes a larger value to "juggle" the target up and back.
   */
  applyKnockback(direction, velocity, lift = 3) {
    this.velocityX = direction * velocity;
    this.velocityY = -lift; // Upward knockback (juggle pop scales with lift)
  }

  /**
   * Get state for broadcasting to clients
   */
  getState() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      groundY: this.groundY, // For correct shadow rendering during jumps
      width: this.width,
      height: this.height,
      health: this.health,
      maxHealth: this.maxHealth,
      isAttacking: this.isAttacking,
      isJumping: this.isJumping,
      isKnockedOut: this.isKnockedOut,
      direction: this.direction,
      color: this.color,
      sprite: this.sprite,
      team: this.team,
      velocityX: this.velocityX, // For walking animation
      lastHitTime: this.lastHitTime, // For hit flash effect
      attackType: this.attackType, // For attack visual differentiation
      // Animation timing for the client. attackSeq is an opaque change-token
      // (client restarts its LOCAL clock when it changes); attackDuration is a
      // RELATIVE ms span, safe for client math. NEVER broadcast attackStartTime
      // here - it's a server timestamp and would be diffed against the client's
      // own clock (different machine), corrupting the animation via clock skew.
      attackSeq: this.attackSeq,
      attackDuration: this.attackDuration,
      // Effective stats: the client needs attackSpeed to render the right
      // cooldown sweep on the action buttons (otherwise attack-speed buffs
      // appear cosmetic - the UI button stays grey for the baseline duration
      // even though the server is allowing the next attack much sooner).
      effectiveStats: this.effectiveStats
    };
  }

  /**
   * Get effective stats for display or calculations
   */
  getEffectiveStats() {
    return { ...this.effectiveStats };
  }

  /**
   * Update unit (position, velocity, cooldowns, etc.)
   * Called every frame in game loop
   *
   * groundLevel: front of play area (bottom of depth plane)
   * playAreaTop: back of play area (top of depth plane, where units appear "farther")
   */
  update(deltaTime, gravity = 0.8, groundLevel = 600, worldWidth = 2000, playAreaTop = 380) {
    // Apply horizontal velocity
    this.x += this.velocityX * this.effectiveStats.movementSpeed;

    // Apply depth movement (up/down) recorded by handleInput - once per tick,
    // not per input packet. Same per-tick magnitude a single legit packet used
    // to give, clamped to the play-area depth band. Only when not jumping
    // (matches the old handleInput guard) and not knocked out (corpses don't
    // keep drifting on stale input).
    if (!this.isJumping && !this.isKnockedOut) {
      const depthSpeed = 4 * this.effectiveStats.movementSpeed;
      if (this.currentInput.up) {
        this.groundY = Math.max(playAreaTop, this.groundY - depthSpeed);
        this.y = this.groundY;
      }
      if (this.currentInput.down) {
        this.groundY = Math.min(groundLevel, this.groundY + depthSpeed);
        this.y = this.groundY;
      }
    }

    // Clamp groundY to play area (depth bounds)
    this.groundY = Math.max(playAreaTop, Math.min(this.groundY, groundLevel));

    // Apply vertical velocity (jumping)
    this.y += this.velocityY;

    // Apply gravity when above the unit's current groundY (i.e., in the air)
    if (this.y < this.groundY) {
      this.velocityY += gravity;
    }

    // Land on the unit's current groundY (not the absolute ground)
    if (this.y >= this.groundY) {
      this.y = this.groundY;
      this.velocityY = 0;
      this.isJumping = false;
    }

    // World boundaries (horizontal)
    this.x = Math.max(0, Math.min(this.x, worldWidth - this.width));

    // Update attack cooldowns (punch/kick share one timer; special has its own)
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }
    if (this.specialCooldown > 0) {
      this.specialCooldown -= deltaTime;
    }

    // Update attack animation
    if (this.isAttacking && Date.now() - this.attackStartTime > this.attackDuration) {
      this.isAttacking = false;
    }

    // Apply friction to horizontal velocity
    this.velocityX *= 0.85;
  }

  /**
   * Start an attack - Different mechanics for punch/kick/special
   */
  performAttack(attackType = 'punch') {
    // Check if can attack. Special is gated by its OWN cooldown; punch/kick
    // share attackCooldown. This keeps the special's long 5s recharge from
    // blocking basic punches/kicks (and vice-versa).
    if (this.isAttacking || this.isKnockedOut) {
      return false;
    }
    const onCooldown = attackType === 'special'
      ? this.specialCooldown > 0
      : this.attackCooldown > 0;
    if (onCooldown) {
      return false;
    }

    this.isAttacking = true;
    this.attackStartTime = Date.now();
    this.attackSeq++; // new attack instance - clients restart the anim clock
    this.hasHit = false;
    this.attackType = attackType;

    // Get cooldown from effective stats
    const cooldown = 0.5 / this.effectiveStats.attackSpeed;

    // Set attack properties based on type
    switch (attackType) {
      case 'punch':
        // Quick jab - hits one enemy at close range
        this.attackRange = 50;
        this.attackPower = Math.round(this.effectiveStats.attack * 1.0);
        this.attackDuration = 150; // Very quick (2-3 frames at 60fps)
        this.attackCooldown = cooldown * 0.6; // Fast recovery
        this.attackRadius = 30; // Small radius - single target
        break;
      case 'kick':
        // Longer kick - hits multiple enemies, extends further
        this.attackRange = 100;
        this.attackPower = Math.round(this.effectiveStats.attack * 3.0);
        this.attackDuration = 350; // Slower, longer animation
        this.attackCooldown = cooldown * 1.2; // Slower recovery
        this.attackRadius = 60; // Larger radius - hits multiple
        break;
      case 'special':
        // Area clear - big AoE attack with fixed 5s cooldown
        this.attackRange = 150;
        // Special hits 15x a punch - gated by a 5s cooldown so cumulative DPS
        // stays in check, but each cast feels like a real "screen-clear" ult.
        // NOTE: actual combat damage is computed in GameRoom.applyDamage
        // (which has its own per-type multipliers) - this attackPower is
        // kept in sync for any display/debug use.
        this.attackPower = Math.round(this.effectiveStats.attack * 15.0);
        this.attackDuration = 500; // Long, dramatic animation
        this.specialCooldown = 5; // Fixed 5s cooldown on its OWN timer (doesn't block punch/kick)
        // Bubble hit radius ~2x the old 120 -> 240. GameRoom.checkCombat
        // uses this as a RADIAL distance check for the special (not the
        // rectangular range/vertical-band used by punch/kick), and the
        // client's drawSpecialExplosion matches it so the visual bubble
        // overlaps the actual kill zone.
        this.attackRadius = 240;
        break;
    }

    return true;
  }

  /**
   * Handle movement input - 4-direction movement on depth plane + jumping
   * Up/Down moves the unit's groundY (depth position), not absolute Y
   * Jump applies relative to the unit's current groundY
   */
  handleInput(input, groundLevel = 600, playAreaTop = 380) {
    // Defensive: a malformed/null input must never throw (it would otherwise
    // bubble up and crash the room's input handler).
    if (!input || typeof input !== 'object') return;
    if (this.isKnockedOut) return;

    const speed = 4 * this.effectiveStats.movementSpeed;

    // Reset horizontal velocity
    this.velocityX = 0;

    // Horizontal movement
    if (input.left) {
      this.velocityX = -speed;
      this.direction = -1;
    }
    if (input.right) {
      this.velocityX = speed;
      this.direction = 1;
    }

    // Vertical depth movement (up/down) - just record the intent here. The
    // actual groundY change happens in update() once per server tick, so a
    // client flooding playerInput packets can't teleport along the Y axis
    // (it used to move `speed` px PER PACKET).
    this.currentInput.up = !!input.up;
    this.currentInput.down = !!input.down;

    // Jump (relative to current groundY)
    if (input.jump && !this.isJumping && this.y >= this.groundY - 1) {
      this.velocityY = -15;
      this.isJumping = true;
    }
  }
}

module.exports = Unit;
