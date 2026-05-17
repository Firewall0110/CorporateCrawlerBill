const Enemy = require('./Enemy');

/**
 * Boss Class - Extends Enemy with boss-specific mechanics
 * Bosses have health bars, multiple attack patterns, and phase-based behavior
 */

class Boss extends Enemy {
  constructor(id, name, baseStats = {}, position = { x: 1000, y: 350 }) {
    const bossStats = {
      maxHealth: 500,
      attack: 32,            // bumped: 20 -> 32 (harder hitting)
      attackSpeed: 1.0,
      armor: 25,             // slight bump: 20 -> 25
      attackRange: 180,      // longer reach: 150 -> 180
      movementSpeed: 0.85,   // significantly faster: 0.5 -> 0.85
      ...baseStats
    };

    super(id, 'boss', bossStats, position);

    this.name = name;
    this.isBoss = true;
    this.showHealthBar = true;

    // BIGGER hitbox so the boss feels like a real threat
    this.width = 80;   // was 40 (inherited from Unit)
    this.height = 110; // was 60

    // Attack patterns - HARDER HITTING + cleaner telegraphs
    this.attacks = [
      {
        name: 'SystemDown',
        type: 'shockwave',
        cooldown: 4200,
        telegramDuration: 1400,
        duration: 600,
        damage: 22,           // bumped: 12 -> 22
        radius: 260,          // bigger radius: 220 -> 260
        lastUsedTime: 0,
        // Counter: Jump over the shockwave OR move out of radius
      },
      {
        name: 'DataCorruption',
        type: 'laserBeam',
        cooldown: 4800,
        telegramDuration: 1600,
        duration: 700,
        damage: 20,           // bumped: 10 -> 20
        beamWidth: 60,        // wider beam: 50 -> 60
        lastUsedTime: 0,
        // Counter: Move along Y axis (depth) - beam only hits players near boss Y
      },
      {
        name: 'ServiceRestarts',
        type: 'targetZones',
        cooldown: 5500,
        telegramDuration: 1800,
        duration: 800,
        damage: 18,           // bumped: 10 -> 18 per zone
        zoneCount: 4,         // more zones: 3 -> 4
        zoneRadius: 85,       // bigger zones: 75 -> 85
        lastUsedTime: 0,
        // Counter: Zones are placed at FIXED positions - move out before they explode
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
    this.stoppingDistance = 170; // Slightly larger stopping distance for bigger hitbox
    this.speed = 7;              // Faster pursuit: 4 -> 7
    this.detectionRange = 1000;  // Larger detection: 800 -> 1000
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
