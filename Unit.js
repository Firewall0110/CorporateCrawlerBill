/**
 * Base Unit Class - Foundation for all game units (players, enemies, bosses)
 * Handles base stats, effective stats computation, and modifier management
 */

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
    this.x = position.x;
    this.y = position.y;
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
    this.attackCooldown = 0;
    this.hasHit = false;
    this.isKnockedOut = false;
    this.lastHitTime = 0; // Used for hit flash effect on client
    this.attackType = 'punch'; // Tracks last attack type for animations

    // Movement state
    this.isJumping = false;
    this.direction = 1; // 1 = right, -1 = left

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

      // Check if modifier applies to this unit
      const appliesTo = mod.appliesToTeam || 'all';
      if (appliesTo !== 'all' && appliesTo !== this.team) {
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

    // Sync health to new maxHealth (cap if needed)
    this.maxHealth = this.effectiveStats.maxHealth;
    if (this.health > this.maxHealth) {
      this.health = this.maxHealth;
    }
  }

  /**
   * Apply damage to this unit
   */
  takeDamage(damage) {
    // Apply armor reduction
    const armorReduction = this.effectiveStats.armor || 0;
    const finalDamage = Math.max(1, damage * (1 - armorReduction / 100));

    this.health -= finalDamage;

    // Reset attack cooldown when hit (can't attack right after being hit)
    this.attackCooldown = 0.5 / this.effectiveStats.attackSpeed;

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
   * Apply knockback to this unit
   */
  applyKnockback(direction, velocity) {
    this.velocityX = direction * velocity;
    this.velocityY = -3; // Small upward knockback
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
      attackType: this.attackType // For attack visual differentiation
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
   */
  update(deltaTime, gravity = 0.8, groundLevel = 350, worldWidth = 2000) {
    // Apply velocity
    this.x += this.velocityX * this.effectiveStats.movementSpeed;
    this.y += this.velocityY;

    // Apply gravity if in air
    if (this.y < groundLevel) {
      this.velocityY += gravity;
    }

    // Ground collision
    if (this.y >= groundLevel) {
      this.y = groundLevel;
      this.velocityY = 0;
      this.isJumping = false;
    }

    // World boundaries
    this.x = Math.max(0, Math.min(this.x, worldWidth - this.width));

    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
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
    // Check if can attack
    if (this.attackCooldown > 0 || this.isAttacking || this.isKnockedOut) {
      return false;
    }

    this.isAttacking = true;
    this.attackStartTime = Date.now();
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
        this.attackPower = Math.round(this.effectiveStats.attack * 1.5);
        this.attackDuration = 350; // Slower, longer animation
        this.attackCooldown = cooldown * 1.2; // Slower recovery
        this.attackRadius = 60; // Larger radius - hits multiple
        break;
      case 'special':
        // Area clear - big AoE attack
        this.attackRange = 150;
        this.attackPower = Math.round(this.effectiveStats.attack * 2.5);
        this.attackDuration = 500; // Long, dramatic animation
        this.attackCooldown = cooldown * 2.5; // Very slow recovery
        this.attackRadius = 120; // Huge radius - clears area
        break;
    }

    return true;
  }

  /**
   * Handle movement input - includes up/down for 4-direction movement
   */
  handleInput(input, groundLevel = 350) {
    if (this.isKnockedOut) return;

    const speed = 4 * this.effectiveStats.movementSpeed;

    // Reset velocities
    this.velocityX = 0;
    let verticalVelocity = 0;

    // Horizontal movement
    if (input.left) {
      this.velocityX = -speed;
      this.direction = -1;
    }
    if (input.right) {
      this.velocityX = speed;
      this.direction = 1;
    }

    // Vertical movement (up/down) - direct Y axis movement, not affected by gravity
    if (input.up) {
      verticalVelocity = -speed;
    }
    if (input.down) {
      verticalVelocity = speed;
    }

    // Apply vertical movement if present, otherwise use gravity
    if (verticalVelocity !== 0) {
      this.y += verticalVelocity;
      this.isJumping = false;
    } else if (input.jump && !this.isJumping && this.y >= groundLevel) {
      // Jump (only when on ground and not moving vertically)
      this.velocityY = -15;
      this.isJumping = true;
    }
  }
}

module.exports = Unit;
