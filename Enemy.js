const Unit = require('./Unit');

/**
 * Enemy Class - Extends Unit with enemy-specific logic
 * Enemies have AI behavior and can be spawned in waves
 */

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
    this.aiState = 'idle'; // idle, moving, attacking, patrolling
    this.target = null; // Target player (nearest or first)
    this.patrolLeft = position.x - 100;
    this.patrolRight = position.x + 100;
    this.lastAttackTime = 0;

    // Movement behavior
    this.stoppingDistance = 80; // How close to get to target before attacking
    this.speed = 3;
    this.detectionRange = 300; // How far to "see" the player
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

    // 2D chase: track player on both X (horizontal) and Y (depth plane)
    const xDistance = Math.abs(this.target.x - this.x);
    const yDistance = Math.abs(this.target.y - this.y);

    // Move along Y axis (depth) toward player - simple "tracking" behavior
    const yAlignThreshold = 30; // Stop matching Y when this close
    if (yDistance > yAlignThreshold) {
      const yDir = this.target.y > this.y ? 1 : -1;
      const ySpeed = this.speed * this.effectiveStats.movementSpeed * 0.5; // Slower Y movement
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
      this.velocityX = direction * this.speed * this.effectiveStats.movementSpeed;
      this.direction = direction;
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
