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

    // Attack patterns - rebalanced with clear telegraphs and counter-play
    this.attacks = [
      {
        name: 'SystemDown',
        type: 'shockwave',
        cooldown: 4500,
        telegramDuration: 1500, // Long telegraph - boss winds up
        duration: 600,
        damage: 12, // Reduced from 25
        radius: 220,
        lastUsedTime: 0,
        // Counter: Jump over the shockwave OR move out of radius
        // Shockwave doesn't hit airborne players
      },
      {
        name: 'DataCorruption',
        type: 'laserBeam',
        cooldown: 5000,
        telegramDuration: 1800, // Very long warning with laser sight
        duration: 700,
        damage: 10, // Reduced from 15
        beamWidth: 50,
        lastUsedTime: 0,
        // Counter: Move along Y axis (depth) - the beam only hits players
        // near the boss's current Y position
      },
      {
        name: 'ServiceRestarts',
        type: 'targetZones',
        cooldown: 6000,
        telegramDuration: 2000, // Long pulsing warning
        duration: 800,
        damage: 10, // Reduced from 20 per zone
        zoneCount: 3,
        zoneRadius: 75,
        lastUsedTime: 0,
        // Counter: Zones are placed at FIXED positions (not following players)
        // and clearly visible - just move out of them before they explode
      }
    ];

    // Minimum gap between attacks (prevents back-to-back chaining)
    this.minAttackGap = 2000;
    this.lastAttackEndTime = 0;

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
    this.speed = 4; // Doubled from 2 - boss now closes distance more aggressively
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

    // Enforce minimum gap between attacks (no chain spam)
    const gapElapsed = now - this.lastAttackEndTime >= this.minAttackGap;

    if (gapElapsed) {
      // Find a random available attack (prevents predictable cycling)
      const availableAttacks = this.attacks.filter(a => now - a.lastUsedTime >= a.cooldown);
      if (availableAttacks.length > 0) {
        availableAttack = availableAttacks[Math.floor(Math.random() * availableAttacks.length)];
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

    // Save laser aim direction at start of telegraph (don't track player after)
    if (attack.type === 'laserBeam') {
      // Aim toward nearest player at time of telegraph start
      if (this.target) {
        this.laserAimX = this.target.x;
        this.laserAimY = this.target.y;
        this.laserStartX = this.x;
        this.laserStartY = this.y;
        // Boss faces player direction for the laser
        this.direction = this.target.x > this.x ? 1 : -1;
      }
    }

    // Prepare zones for targetZones attack - FIXED positions (not tracking players)
    if (attack.type === 'targetZones') {
      this.attackZones = [];
      // Place zones at strategic positions around the boss, not at player feet
      // This way players can SEE where danger will be and move away
      const zoneSpread = 180;
      const baseX = this.target ? (this.x + this.target.x) / 2 : this.x;
      const baseY = this.target ? this.target.y : this.y;

      for (let i = 0; i < attack.zoneCount; i++) {
        // Spread zones around player area: left, center, right
        const offsetX = (i - 1) * zoneSpread + (Math.random() - 0.5) * 80;
        const offsetY = (Math.random() - 0.5) * 100; // Small Y variation
        this.attackZones.push({
          x: baseX + offsetX,
          y: baseY + offsetY,
          radius: attack.zoneRadius,
          spawnTime: Date.now(),
          telegraphDuration: attack.telegramDuration,
          hasDetonated: false,
          hasDamaged: false
        });
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
      this.lastAttackEndTime = now; // Used for minAttackGap enforcement
      this.attackZones = [];
      this.hasDealtAttackDamage = false; // Reset for next attack
    }
  }

  /**
   * Apply attack damage to players - each attack only damages ONCE per cycle
   * Counter-play built in for each attack type
   */
  performAttackDamage(attack, players, now) {
    if (!players || players.length === 0) return;

    switch (attack.type) {
      case 'shockwave': {
        // System Down: Shockwave expands from boss
        // Counter-play: Jump (airborne players safe) OR move out of radius
        if (this.hasDealtAttackDamage) return;
        this.hasDealtAttackDamage = true;

        players.forEach(player => {
          if (player.isKnockedOut) return;

          // Players in air (jumping) are safe from ground shockwave
          const isAirborne = player.y < player.groundY - 10;
          if (isAirborne) return;

          const distance = Math.sqrt(
            Math.pow(player.x - this.x, 2) + Math.pow(player.y - this.y, 2)
          );
          if (distance < attack.radius) {
            player.takeDamage(attack.damage);
            player.lastHitTime = now;
            // Knockback away from boss
            const direction = player.x > this.x ? 1 : -1;
            player.applyKnockback(direction, 8);
          }
        });
        break;
      }

      case 'laserBeam': {
        // Data Corruption: Laser beam along Y at boss's depth
        // Counter-play: Move along Y (depth) to dodge the beam
        if (this.hasDealtAttackDamage) return;
        this.hasDealtAttackDamage = true;

        const beamY = this.laserStartY !== undefined ? this.laserStartY : this.y;
        const beamHalfWidth = attack.beamWidth / 2;

        players.forEach(player => {
          if (player.isKnockedOut) return;

          // Hit only if player's Y is within beam width of beam's Y
          const yDistance = Math.abs(player.y - beamY);
          if (yDistance > beamHalfWidth) return;

          // Check X direction (beam fires in boss's facing direction)
          const fromBoss = player.x - this.x;
          if (fromBoss * this.direction > 0 && Math.abs(fromBoss) < 1000) {
            player.takeDamage(attack.damage);
            player.lastHitTime = now;
            player.applyKnockback(this.direction, 6);
          }
        });
        break;
      }

      case 'targetZones': {
        // Service Restarts: Fixed-position zones explode at telegraph end
        // Counter-play: Move out of clearly visible zones before they explode
        this.attackZones.forEach(zone => {
          const elapsedSinceTelegram = now - zone.spawnTime;
          const detonationTime = zone.telegraphDuration;

          if (elapsedSinceTelegram >= detonationTime && !zone.hasDamaged) {
            zone.hasDetonated = true;
            zone.hasDamaged = true; // Damage applies only once per zone

            players.forEach(player => {
              if (player.isKnockedOut) return;

              const distance = Math.sqrt(
                Math.pow(player.x - zone.x, 2) + Math.pow(player.y - zone.y, 2)
              );
              if (distance < zone.radius) {
                player.takeDamage(attack.damage);
                player.lastHitTime = now;
                const direction = player.x > zone.x ? 1 : -1;
                player.applyKnockback(direction, 7);
              }
            });
          }
        });
        break;
      }

      default:
        break;
    }
  }

  /**
   * Get boss state for broadcasting
   * Includes detailed attack telegraph info for client-side visualization
   */
  getState() {
    const baseState = super.getState();
    const now = Date.now();

    // Detailed attack data for telegraph rendering
    let attackData = null;
    if (this.currentAttack && this.isExecutingAttack) {
      const elapsed = now - this.currentAttackStartTime;
      const telegramElapsed = Math.min(elapsed, this.currentAttack.telegramDuration);
      const telegramProgress = telegramElapsed / this.currentAttack.telegramDuration;
      const damageElapsed = Math.max(0, elapsed - this.currentAttack.telegramDuration);
      const damageProgress = damageElapsed / this.currentAttack.duration;

      attackData = {
        name: this.currentAttack.name,
        type: this.currentAttack.type,
        isInTelegram: this.isInTelegram,
        isExecuting: this.isExecutingAttack,
        telegramProgress: Math.min(1, telegramProgress), // 0-1
        damageProgress: Math.min(1, damageProgress), // 0-1
        radius: this.currentAttack.radius,
        beamWidth: this.currentAttack.beamWidth,
        bossX: this.x,
        bossY: this.y,
        // For laser beam - aim line
        laserAimX: this.laserAimX,
        laserAimY: this.laserAimY,
        laserStartX: this.laserStartX,
        laserStartY: this.laserStartY,
        direction: this.direction
      };
    }

    return {
      ...baseState,
      isBoss: true,
      showHealthBar: this.showHealthBar,
      currentAttack: attackData,
      attackZones: this.attackZones.map(zone => ({
        x: zone.x,
        y: zone.y,
        radius: zone.radius,
        telegraphProgress: Math.min(1, (now - zone.spawnTime) / (zone.telegraphDuration || 500)),
        hasDetonated: zone.hasDetonated
      }))
    };
  }
}

module.exports = Boss;
