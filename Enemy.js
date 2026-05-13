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
   * Simple AI: Chase nearest player and attack
   */
  updateAI(players, deltaTime) {
    if (this.isKnockedOut || players.length === 0) {
      this.velocityX *= 0.85; // Idle friction
      return;
    }

    // Find nearest player
    let nearestPlayer = null;
    let minDistance = this.detectionRange;

    players.forEach(player => {
      const distance = Math.abs(player.x - this.x);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPlayer = player;
      }
    });

    this.target = nearestPlayer;

    if (!this.target) {
      // No player in range, patrol
      this.aiState = 'patrolling';
      this.patrol();
      return;
    }

    // Chase target
    const distance = Math.abs(this.target.x - this.x);

    if (distance < this.stoppingDistance) {
      // Attack!
      this.aiState = 'attacking';
      this.velocityX = 0; // Stop moving while attacking
      if (!this.isAttacking && this.attackCooldown <= 0) {
        this.performAttack('punch');
      }
    } else {
      // Chase
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
