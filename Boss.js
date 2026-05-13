const Enemy = require('./Enemy');

/**
 * Boss Class - Extends Enemy with boss-specific mechanics
 * Bosses have health bars, multiple attack patterns, and phase-based behavior
 */

class Boss extends Enemy {
  constructor(id, name, baseStats = {}, position = { x: 1000, y: 350 }) {
    const bossStats = {
      maxHealth: 500,
      attack: 20,
      attackSpeed: 1.0,
      armor: 20,
      attackRange: 150,
      movementSpeed: 0.5,
      ...baseStats
    };

    super(id, 'boss', bossStats, position);

    this.name = name;
    this.isBoss = true;
    this.showHealthBar = true;

    // Attack patterns
    this.attacks = [
      {
        name: 'SystemDown',
        type: 'aoe',
        cooldown: 3000,
        telegramDuration: 1000,
        duration: 500,
        damage: 25,
        radius: 200,
        lastUsedTime: 0
      },
      {
        name: 'DataCorruption',
        type: 'line',
        cooldown: 4000,
        telegramDuration: 800,
        duration: 800,
        damage: 15,
        width: 50,
        lastUsedTime: 0
      },
      {
        name: 'ServiceRestarts',
        type: 'zones',
        cooldown: 5000,
        telegramDuration: 500,
        duration: 1000,
        damage: 20,
        zoneCount: 3,
        zoneRadius: 60,
        lastUsedTime: 0
      }
    ];

    // Current attack state
    this.currentAttackIndex = -1;
    this.currentAttackStartTime = 0;
    this.currentAttackTelegramTime = 0;
    this.isInTelegram = false;
    this.isExecutingAttack = false;

    // Attack zones for zones pattern
    this.attackZones = []; // { x, y, radius, spawnTime }

    // Boss AI parameters
    this.stoppingDistance = 150;
    this.speed = 2;
    this.detectionRange = 800;
  }

  /**
   * Update boss AI and attacks
   */
  updateAI(players, deltaTime) {
    if (this.isKnockedOut || players.length === 0) {
      this.velocityX *= 0.85;
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

    // Try to perform attack if cooldown ready
    const now = Date.now();
    let availableAttack = null;

    // Find next available attack
    for (let i = 0; i < this.attacks.length; i++) {
      const attack = this.attacks[i];
      if (now - attack.lastUsedTime >= attack.cooldown) {
        availableAttack = attack;
        break;
      }
    }

    // Start new attack if available and not currently attacking
    if (availableAttack && !this.isExecutingAttack && !this.isInTelegram) {
      this.startAttack(availableAttack, players);
    }

    // Update ongoing attack
    if (this.isExecutingAttack) {
      this.updateAttack(players, now);
    }

    // Movement: Stay at moderate distance from target
    if (!this.isExecutingAttack && this.target) {
      const distance = Math.abs(this.target.x - this.x);

      if (distance < this.stoppingDistance) {
        // Too close, back up
        const direction = this.target.x > this.x ? -1 : 1;
        this.velocityX = direction * this.speed * this.effectiveStats.movementSpeed;
        this.direction = direction;
      } else if (distance > this.stoppingDistance + 100) {
        // Too far, move closer
        const direction = this.target.x > this.x ? 1 : -1;
        this.velocityX = direction * this.speed * this.effectiveStats.movementSpeed;
        this.direction = direction;
      } else {
        // Perfect distance, hold position
        this.velocityX = 0;
      }
    } else {
      this.velocityX *= 0.85; // Friction
    }
  }

  /**
   * Start a new attack pattern
   */
  startAttack(attack, players) {
    this.currentAttack = attack;
    this.currentAttackStartTime = Date.now();
    this.currentAttackTelegramTime = this.currentAttackStartTime;
    this.isInTelegram = true;
    this.isExecutingAttack = true;
    this.velocityX = 0; // Stop moving while attacking

    // Prepare attack zones if zones pattern
    if (attack.type === 'zones') {
      this.attackZones = [];
      if (players.length > 0) {
        // Create zones at player positions
        for (let i = 0; i < Math.min(attack.zoneCount, players.length); i++) {
          this.attackZones.push({
            x: players[i].x,
            y: players[i].y,
            radius: attack.zoneRadius,
            spawnTime: Date.now(),
            hasDetonated: false
          });
        }
      }
    }
  }

  /**
   * Update ongoing attack
   */
  updateAttack(players, now) {
    const attack = this.currentAttack;
    const elapsedSinceTelegram = now - this.currentAttackTelegramTime;
    const elapsedSinceStart = now - this.currentAttackStartTime;

    // Telegram phase (visual warning before damage)
    if (elapsedSinceTelegram < attack.telegramDuration) {
      this.isInTelegram = true;
      return;
    } else {
      this.isInTelegram = false;
    }

    // Damage phase
    if (elapsedSinceStart < attack.telegramDuration + attack.duration) {
      this.performAttackDamage(attack, players, now);
    } else {
      // Attack finished
      this.isExecutingAttack = false;
      attack.lastUsedTime = now;
      this.attackZones = [];
    }
  }

  /**
   * Apply attack damage to players
   */
  performAttackDamage(attack, players, now) {
    if (!players || players.length === 0) return;

    switch (attack.type) {
      case 'aoe':
        // Radial explosion from boss
        players.forEach(player => {
          const distance = Math.sqrt(
            Math.pow(player.x - this.x, 2) + Math.pow(player.y - this.y, 2)
          );
          if (distance < attack.radius) {
            player.takeDamage(attack.damage);
            // Knockback away from boss
            const direction = player.x > this.x ? 1 : -1;
            player.applyKnockback(direction, 8);
          }
        });
        break;

      case 'line':
        // Horizontal line of damage
        players.forEach(player => {
          // Simple line detection: check if player is within line zone
          const verticalDistance = Math.abs(player.y - this.y);
          if (verticalDistance < 80) {
            // Check if in line path (moving from boss)
            const fromBoss = player.x - this.x;
            const bossDirection = this.direction;
            if (fromBoss * bossDirection > 0 && Math.abs(fromBoss) < attack.radius) {
              player.takeDamage(attack.damage);
              // Knockback along line direction
              player.applyKnockback(this.direction, 6);
            }
          }
        });
        break;

      case 'zones':
        // Multiple zones that explode
        this.attackZones.forEach(zone => {
          const detonationTime = zone.spawnTime + 500;
          if (now >= detonationTime && !zone.hasDetonated) {
            zone.hasDetonated = true;
            // Damage players in zone
            players.forEach(player => {
              const distance = Math.sqrt(
                Math.pow(player.x - zone.x, 2) + Math.pow(player.y - zone.y, 2)
              );
              if (distance < zone.radius) {
                player.takeDamage(attack.damage);
                // Knockback away from zone center
                const direction = player.x > zone.x ? 1 : -1;
                player.applyKnockback(direction, 7);
              }
            });
          }
        });
        break;
    }
  }

  /**
   * Get boss state for broadcasting
   */
  getState() {
    const baseState = super.getState();
    return {
      ...baseState,
      isBoss: true,
      showHealthBar: this.showHealthBar,
      currentAttack: this.currentAttack ? {
        name: this.currentAttack.name,
        type: this.currentAttack.type,
        isInTelegram: this.isInTelegram,
        isExecuting: this.isExecutingAttack
      } : null,
      attackZones: this.attackZones.map(zone => ({
        x: zone.x,
        y: zone.y,
        radius: zone.radius,
        hasDetonated: zone.hasDetonated
      }))
    };
  }
}

module.exports = Boss;
