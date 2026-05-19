const Player = require('./Player');
const Enemy = require('./Enemy');
const Boss = require('./Boss');
const { getRandomAttribute } = require('./CharacterAttributes');

// Debug flag - set to true for verbose logging
const DEBUG = process.env.DEBUG === 'true';
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

/**
 * GameRoom - Manages a single multiplayer game session
 * Handles players, enemies, level progression, stat management
 */

class GameRoom {
  constructor(id, name, io) {
    this.id = id;
    this.name = name;
    this.io = io;
    this.players = new Map(); // socketId -> Player
    this.enemies = []; // Array of Enemy instances
    this.boss = null; // Current boss (if in boss zone)
    this.status = 'waiting'; // waiting, playing, finished
    this.createdAt = Date.now();
    this.lastUpdateTime = Date.now();

    // World settings - 4 independent STAGES, each with its own coordinate system
    // Each stage starts at x=0 and has its own worldWidth (2500 for stages 0-2, 1500 for boss)
    this.worldHeight = 800; // Doubled height for vertical movement
    this.gravity = 0.8;
    // Default floor bounds (overridden per-stage via zoneConfig.floor)
    // groundLevel: front of play area (closest to viewer)
    // playAreaTop: back of play area (depth) - units can walk between these Y values
    this.DEFAULT_GROUND_LEVEL = 600;
    this.DEFAULT_PLAY_AREA_TOP = 380;
    this.groundLevel = this.DEFAULT_GROUND_LEVEL;
    this.playAreaTop = this.DEFAULT_PLAY_AREA_TOP;

    // Game loop
    this.tickRate = 1000 / 60; // 60 FPS
    this.gameLoop = null;

    // Level system - 4 stages, each with sections
    this.zoneConfig = this.createZoneConfig();
    this.currentZoneIndex = 0;
    this.currentSectionIndex = 0;
    this.sectionWavesClear = false;
    this.sectionWavesSpawned = false;
    this.worldWidth = this.zoneConfig[0].width; // Current stage's width
    // Apply initial zone floor (uses defaults unless zone declares an override)
    this.applyZoneFloor(this.zoneConfig[0]);
    this.maxRightBound = 300; // Player can't move beyond this X until section is clear

    // Stage transition state - when player completes a stage, they auto-exit
    // right and the next stage loads after a brief animation window
    this.stageTransition = null; // { startTime: ms, nextStageIndex: int }
    this.STAGE_TRANSITION_DURATION = 2500; // ms

    // Boss death cinematic: when boss dies, we pause game logic and play
    // the 64-frame death animation before the victory screen appears
    this.bossDeathStartTime = null; // set when boss first dies
    this.BOSS_DEATH_DURATION = 5200; // ms - matches 64 frames @ ~12fps

    // Track which sections have already been spawned (prevents respawn on backtracking)
    // Key format: "zoneIndex-sectionIndex"
    this.spawnedSections = new Set();
    // Track which sections have been cleared (persists across backtracking)
    this.clearedSections = new Set();

    // All active modifiers from player attributes
    this.activeModifiers = [];

    // Kill tracking
    this.totalKills = 0;
    this.enemiesSpawned = 0;

    // Player death tracking
    this.playerDeadTime = null;
    this.playerDeadSocketId = null;

    // Auto-start timer (game starts 3 seconds after room creation)
    this.autoStartTimer = setTimeout(() => {
      if (this.status === 'waiting') {
        console.log(`Auto-starting game in room ${this.id}`);
        this.status = 'playing';
        this.nextWaveSpawnTime = Date.now();
        this.io.to(this.id).emit('gameStarted');
      }
    }, 3000);

    this.startGameLoop();
  }

  /**
   * Create zone configuration with scroll-based sections
   * Progression: Enter section -> Wave spawns -> Clear wave -> Can advance to next section
   */
  createZoneConfig() {
    // Each stage is its OWN independent world starting at x=0
    // Stages 1-3: width 2500, sections 800 wide (3 sections + transition zone)
    // Stage 4 (boss): width 1500, single boss section
    return [
      {
        name: 'Garage',
        width: 2500,
        sections: [
          {
            name: 'Garage - Section 1',
            xRange: { start: 0, end: 800 },
            waves: [
              { enemyType: 'printer-ticket', count: 2, spawnX: 400 }
            ]
          },
          {
            name: 'Garage - Section 2',
            xRange: { start: 800, end: 1600 },
            waves: [
              { enemyType: 'email-ticket', count: 2, spawnX: 1200 }
            ]
          },
          {
            name: 'Garage - Section 3',
            xRange: { start: 1600, end: 2400 },
            waves: [
              { enemyType: 'printer-ticket', count: 2, spawnX: 2000 }
            ]
          }
        ]
      },
      {
        name: 'Quad',
        width: 2500,
        sections: [
          {
            name: 'Quad - Section 1',
            xRange: { start: 0, end: 800 },
            waves: [
              { enemyType: 'email-ticket', count: 2, spawnX: 400 }
            ]
          },
          {
            name: 'Quad - Section 2',
            xRange: { start: 800, end: 1600 },
            waves: [
              { enemyType: 'network-ticket', count: 2, spawnX: 1200 }
            ]
          },
          {
            name: 'Quad - Section 3',
            xRange: { start: 1600, end: 2400 },
            waves: [
              { enemyType: 'email-ticket', count: 2, spawnX: 2000 }
            ]
          }
        ]
      },
      {
        name: 'Lobby',
        width: 2500,
        // The Lobby stage uses a high-res rendered backdrop where the
        // polished marble floor only occupies the bottom ~28% of the image.
        // Push the walkable Y band down so characters stand on the floor
        // and don't walk through the floor-to-ceiling glass wall.
        floor: { playAreaTop: 510, groundLevel: 670 },
        sections: [
          {
            name: 'Lobby - Section 1',
            xRange: { start: 0, end: 800 },
            waves: [
              { enemyType: 'network-ticket', count: 2, spawnX: 400 }
            ]
          },
          {
            name: 'Lobby - Section 2',
            xRange: { start: 800, end: 1600 },
            waves: [
              { enemyType: 'printer-ticket', count: 2, spawnX: 1200 }
            ]
          },
          {
            name: 'Lobby - Section 3',
            xRange: { start: 1600, end: 2400 },
            waves: [
              { enemyType: 'network-ticket', count: 2, spawnX: 2000 }
            ]
          }
        ]
      },
      {
        name: 'Server Room',
        width: 1500,
        sections: [
          {
            name: 'Server Room - Boss',
            xRange: { start: 0, end: 1500 },
            isBoss: true,
            waves: []
          }
        ]
      }
    ];
  }

  /**
   * Apply per-stage walkable floor bounds. Each zone may declare a `floor`
   * override with { playAreaTop, groundLevel } to match the floor location
   * in its backdrop image. Stages without an override use the defaults.
   * Called on the initial stage and whenever a stage transition completes.
   */
  applyZoneFloor(zone) {
    const f = zone && zone.floor;
    this.playAreaTop = (f && typeof f.playAreaTop === 'number')
      ? f.playAreaTop : this.DEFAULT_PLAY_AREA_TOP;
    this.groundLevel = (f && typeof f.groundLevel === 'number')
      ? f.groundLevel : this.DEFAULT_GROUND_LEVEL;
  }

  /**
   * Get base stats for enemy types
   * Punch (20 dmg): ~5 hits to kill | Kick (30 dmg): ~3 hits to kill
   */
  getEnemyBaseStats(enemyType) {
    const stats = {
      'printer-ticket': {
        maxHealth: 100,    // 5 punches to kill
        attack: 3,
        attackSpeed: 0.4,  // Reduced from 0.8 - half attack frequency
        armor: 0,
        attackRange: 50,
        movementSpeed: 1.0,
        color: '#FF9900'
      },
      'email-ticket': {
        maxHealth: 110,    // 5-6 punches to kill, or 4 kicks
        attack: 4,
        attackSpeed: 0.4,  // Reduced from 0.8 - half attack frequency
        armor: 0,
        attackRange: 50,
        movementSpeed: 0.8,
        color: '#3366FF'
      },
      'network-ticket': {
        maxHealth: 130,    // 7 punches to kill, or 4-5 kicks
        attack: 6,
        attackSpeed: 0.35, // Reduced from 0.7 - half attack frequency
        armor: 1,
        attackRange: 50,
        movementSpeed: 0.6,
        color: '#FF3366'
      }
    };
    return stats[enemyType] || stats['printer-ticket'];
  }

  /**
   * Start the game loop
   */
  startGameLoop() {
    this.gameLoop = setInterval(() => {
      this.update();
      this.broadcastState();
    }, this.tickRate);
  }

  /**
   * Stop the game loop
   */
  stop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }

  /**
   * Main game update loop
   */
  update() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    // Only process game logic if game is actively playing
    if (this.status !== 'playing') return;

    // Debug: Log first time we reach this point
    if (!this.debugUpdateLogged) {
      debugLog(`[GameRoom ${this.id}] Game update running! Status: ${this.status}`);
      this.debugUpdateLogged = true;
    }

    // Boss death cinematic: freeze the world, no combat, no movement
    if (this.bossDeathStartTime) {
      // Just tick boss death timer above; the boss-death check happens later in the loop.
      // Keep player animation cooldowns ticking so visuals don't freeze, but skip everything else.
      this.players.forEach(player => {
        player.velocityX *= 0.5;
        player.velocityY = 0;
        if (player.attackCooldown > 0) player.attackCooldown -= deltaTime;
      });
      // Still need to check the boss death trigger
      if (this.boss && this.boss.isKnockedOut &&
          Date.now() - this.bossDeathStartTime >= this.BOSS_DEATH_DURATION) {
        this.levelComplete();
      }
      return;
    }

    // Stage transition: players auto-run right off-screen, no combat
    if (this.stageTransition) {
      const runSpeed = 6;
      this.players.forEach(player => {
        player.velocityX = runSpeed;
        player.direction = 1;
        // Allow them to run past worldWidth (off the right edge)
        // Use 2x worldWidth as the clamping bound during transition
        player.x = Math.min(player.x + runSpeed, this.worldWidth + 200);
        // Just update vertical / cooldowns (skip the player.update boundary clamp)
        if (player.attackCooldown > 0) player.attackCooldown -= deltaTime;
      });
      return; // Skip everything else during transition
    }

    // Update all players
    this.players.forEach(player => {
      player.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth, this.playAreaTop);

      // Enforce section boundary - can't move right until section is clear
      if (!this.sectionWavesClear && player.x > this.maxRightBound) {
        player.x = this.maxRightBound;
        player.velocityX = 0;
      }
    });

    // Update all enemies
    this.enemies.forEach(enemy => {
      enemy.updateAI(Array.from(this.players.values()), deltaTime);
      enemy.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth, this.playAreaTop);
    });

    // Update boss if exists
    if (this.boss) {
      this.boss.updateAI(Array.from(this.players.values()), deltaTime);
      this.boss.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth, this.playAreaTop);
    }

    // Spawn waves
    this.updateWaveSpawning(now);

    // Combat collision detection
    this.checkCombat();

    // Clean up dead enemies and track kills
    const deadEnemies = this.enemies.filter(enemy => enemy.isKnockedOut && enemy.health <= 0);
    deadEnemies.forEach(enemy => {
      this.totalKills++;
      debugLog(`[Kill] #${this.totalKills}: ${enemy.name}`);
    });
    this.enemies = this.enemies.filter(enemy => !enemy.isKnockedOut || enemy.health > 0);

    // Centralized player death detection - catches deaths from ALL sources
    // (regular combat, boss attacks, etc.) Only triggers once until respawn
    if (!this.playerDeadSocketId) {
      for (const [socketId, player] of this.players.entries()) {
        if (player.health <= 0 && !player.isKnockedOut) {
          player.isKnockedOut = true;
          player.health = 0;
        }
        if (player.health <= 0 && player.isKnockedOut) {
          this.playerDeadTime = Date.now();
          this.playerDeadSocketId = socketId;
          debugLog(`[GameOver] Player ${socketId} died!`);
          this.io.to(this.id).emit('playerDied', {
            playerId: socketId
          });
          break;
        }
      }
    }

    // Boss defeat - cinematic death sequence (5.2 seconds)
    if (this.boss && this.boss.isKnockedOut) {
      if (!this.bossDeathStartTime) {
        // First frame the boss dies - kick off the cinematic
        this.bossDeathStartTime = Date.now();
        this.io.to(this.id).emit('bossDying', {
          startTime: this.bossDeathStartTime,
          duration: this.BOSS_DEATH_DURATION
        });
        debugLog(`[Boss] Death cinematic started`);
      }
      // After cinematic duration, trigger level complete
      if (Date.now() - this.bossDeathStartTime >= this.BOSS_DEATH_DURATION) {
        this.levelComplete();
      }
    }

    // Level progression
    this.checkZoneProgression();
  }

  /**
   * Determine which section player is in based on X position
   */
  getCurrentSection() {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone || !zone.sections) return null;

    const playerX = Array.from(this.players.values())[0]?.x || 0;

    for (let i = 0; i < zone.sections.length; i++) {
      const section = zone.sections[i];
      if (playerX >= section.xRange.start && playerX < section.xRange.end) {
        return { section, index: i };
      }
    }

    return null;
  }

  /**
   * Spawn enemy waves based on section progression
   * FIXED: Tracks spawned/cleared sections globally to prevent respawning on backtrack
   */
  updateWaveSpawning(now) {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone || !zone.sections) return;

    const current = this.getCurrentSection();
    if (!current) return;

    const { section, index } = current;
    const sectionKey = `${this.currentZoneIndex}-${index}`;

    // Check if we've moved to a new section
    if (index !== this.currentSectionIndex) {
      this.currentSectionIndex = index;
      // Restore clear state from history (don't reset if already cleared)
      this.sectionWavesClear = this.clearedSections.has(sectionKey);
      this.sectionWavesSpawned = this.spawnedSections.has(sectionKey);

      // Only restrict bound if this section isn't already cleared
      if (!this.sectionWavesClear) {
        this.maxRightBound = section.xRange.end;
      } else {
        // Already cleared - allow free movement
        this.maxRightBound = this.worldWidth;
      }
    }

    // Spawn waves in this section ONCE - tracked globally to prevent respawn on backtrack
    if (!this.spawnedSections.has(sectionKey) && section.waves && section.waves.length > 0) {
      section.waves.forEach(waveConfig => {
        this.spawnWave(waveConfig);
      });
      this.spawnedSections.add(sectionKey);
      this.sectionWavesSpawned = true;
    }

    // Check if section is cleared - count ONLY ALIVE enemies in section
    const aliveEnemiesInSection = this.enemies.filter(e =>
      !e.isKnockedOut &&
      e.health > 0 &&
      e.x >= section.xRange.start &&
      e.x <= section.xRange.end
    );

    // Section is cleared if: waves were spawned AND no alive enemies in section
    if (this.spawnedSections.has(sectionKey) && aliveEnemiesInSection.length === 0) {
      if (!this.sectionWavesClear) {
        this.sectionWavesClear = true;
        this.clearedSections.add(sectionKey);
        this.maxRightBound = this.worldWidth; // Allow advancing
        debugLog(`[Section] CLEARED: ${section.name}`);
      }
    }
  }

  /**
   * Spawn an enemy wave
   */
  spawnWave(waveConfig) {
    // Get spawn X from wave config or use centered position
    const baseSpawnX = waveConfig.spawnX || 800;

    debugLog(`[Spawn] ${waveConfig.count}x ${waveConfig.enemyType}`);

    // Calculate depth range for varied Y spawning
    const depthRange = this.groundLevel - this.playAreaTop;

    for (let i = 0; i < waveConfig.count; i++) {
      // Use counter + random for guaranteed uniqueness
      const enemyId = `${this.id}-e${this.enemiesSpawned}-${Math.random().toString(36).substring(2, 8)}`;

      const baseStats = this.getEnemyBaseStats(waveConfig.enemyType);
      const spawnX = baseSpawnX + i * 60; // Spread enemies out

      // Vary Y position across the play area depth for visual variety
      const yOffset = (i / Math.max(1, waveConfig.count - 1)) * depthRange * 0.7;
      const spawnY = this.playAreaTop + depthRange * 0.15 + yOffset;

      const enemy = new Enemy(
        enemyId,
        waveConfig.enemyType,
        baseStats,
        { x: spawnX, y: spawnY }
      );

      // Apply current modifiers to enemy
      enemy.recomputeEffectiveStats(this.activeModifiers);

      this.enemies.push(enemy);
      this.enemiesSpawned++;
    }
  }

  /**
   * Advance to next zone
   */
  /**
   * Begin a transition from the current stage to the next.
   * Locks player input (server forces auto-run right), runs animation timer,
   * then calls finishStageTransition() to actually swap stages.
   */
  beginStageTransition() {
    if (this.currentZoneIndex >= this.zoneConfig.length - 1) return;
    if (this.stageTransition) return; // already transitioning

    this.stageTransition = {
      startTime: Date.now(),
      fromStageIndex: this.currentZoneIndex,
      nextStageIndex: this.currentZoneIndex + 1
    };

    debugLog(`[Stage] Transitioning from ${this.zoneConfig[this.currentZoneIndex].name}`);

    this.io.to(this.id).emit('stageTransitionStart', {
      fromStageIndex: this.currentZoneIndex,
      fromStageName: this.zoneConfig[this.currentZoneIndex].name,
      nextStageIndex: this.currentZoneIndex + 1,
      nextStageName: this.zoneConfig[this.currentZoneIndex + 1].name,
      duration: this.STAGE_TRANSITION_DURATION
    });

    // Schedule the actual stage swap
    setTimeout(() => this.finishStageTransition(), this.STAGE_TRANSITION_DURATION);
  }

  /**
   * Actually swap to the next stage. Called by setTimeout from beginStageTransition.
   * Resets player coords to start of new stage, spawns boss if it's the boss stage,
   * fires stageStarted event.
   */
  finishStageTransition() {
    if (!this.stageTransition) return;

    const nextIdx = this.stageTransition.nextStageIndex;
    const nextStage = this.zoneConfig[nextIdx];
    if (!nextStage) {
      this.stageTransition = null;
      return;
    }

    this.currentZoneIndex = nextIdx;
    this.currentSectionIndex = 0;
    this.sectionWavesClear = false;
    this.sectionWavesSpawned = false;
    this.zoneProgressed = false;

    // Each stage is its own independent world
    this.worldWidth = nextStage.width;
    // Apply per-stage floor bounds (e.g. Lobby has a higher floor band)
    this.applyZoneFloor(nextStage);

    // Reset player positions to left side of new stage
    const midDepth = (this.playAreaTop + this.groundLevel) / 2 + 40;
    this.players.forEach(player => {
      player.x = 100;
      player.y = midDepth;
      player.groundY = midDepth;
      player.velocityX = 0;
      player.velocityY = 0;
      player.isKnockedOut = false;
      player.health = player.maxHealth;
    });

    // Clear any enemies / boss carried over (defensive)
    this.enemies = [];
    if (this.boss) {
      this.boss = null;
    }

    // First section's maxRightBound
    const firstSection = nextStage.sections?.[0];
    if (firstSection) {
      this.maxRightBound = firstSection.xRange.end;
    }

    // Boss stage: spawn boss
    if (firstSection?.isBoss) {
      this.spawnBoss();
      this.io.to(this.id).emit('bossEncounter', {
        bossName: 'Critical Priority 1 Outage',
        zoneIndex: this.currentZoneIndex
      });
    }

    this.io.to(this.id).emit('stageStarted', {
      stageIndex: this.currentZoneIndex,
      stageName: nextStage.name,
      worldWidth: nextStage.width
    });

    this.io.to(this.id).emit('zoneChange', {
      zoneName: nextStage.name,
      zoneIndex: this.currentZoneIndex
    });

    this.stageTransition = null;
    debugLog(`[Stage] Now in ${nextStage.name}`);
  }

  /** Backwards-compat alias - some other callers still call this */
  advanceZone() {
    this.beginStageTransition();
  }

  /**
   * Spawn the boss
   */
  spawnBoss() {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone || !zone.sections || !zone.sections[0]) {
      console.error('Cannot spawn boss: invalid zone');
      return;
    }

    // Use boss section's xRange to calculate center position
    const bossSection = zone.sections[0];
    const centerX = (bossSection.xRange.start + bossSection.xRange.end) / 2;

    // Boss stats scale with player count (0.25x per player)
    const playerCount = this.players.size;
    const healthMultiplier = 1 + (playerCount - 1) * 0.25;

    const bossStats = {
      maxHealth: Math.round(420 * healthMultiplier), // bumped: 300 -> 420
      attack: 32,            // bumped: 18 -> 32
      attackSpeed: 1.0,
      armor: 25,             // bumped: 20 -> 25
      attackRange: 180,      // bumped: 150 -> 180
      movementSpeed: 0.85    // bumped: 0.4 -> 0.85 (over 2x)
    };

    this.boss = new Boss(
      `${this.id}-boss`,
      'Critical Priority 1 Outage',
      bossStats,
      { x: centerX, y: this.groundLevel }
    );

    // Apply modifiers to boss
    this.boss.recomputeEffectiveStats(this.activeModifiers);

    debugLog(`[Boss] Spawned at x=${centerX} with ${Math.round(bossStats.maxHealth)} health (${playerCount} players)`);
  }

  /**
   * Check level progression (advance to next zone when current is complete)
   */
  checkZoneProgression() {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone) return;

    // Check if all sections in zone are complete
    if (this.currentSectionIndex >= zone.sections.length - 1 && this.sectionWavesClear && this.enemies.length === 0) {
      // Zone complete!
      if (!this.zoneProgressed) {
        this.zoneProgressed = true;
        debugLog(`[Zone] COMPLETED: ${zone.name}`);
        this.advanceZone();
      }
    }
  }

  /**
   * Combat collision detection
   */
  checkCombat() {
    const allEnemies = [...this.enemies];
    if (this.boss) allEnemies.push(this.boss);

    const players = Array.from(this.players.values());

    // Player attacks on enemies
    players.forEach(attacker => {
      if (!attacker.isAttacking || attacker.hasHit) return;

      const hitRadius = attacker.attackRadius || 60;
      let hitAny = false;

      allEnemies.forEach(target => {
        const distance = Math.abs(attacker.x - target.x);
        const verticalDistance = Math.abs(attacker.y - target.y);

        // Check if target is in range
        if (distance < attacker.effectiveStats.attackRange && verticalDistance < 50) {
          this.applyDamage(attacker, target);
          hitAny = true;

          // For kicks and specials, check radius for multi-hit
          if (attacker.attackType === 'kick' || attacker.attackType === 'special') {
            // Already hit, can hit others in radius
          }
        }
      });

      // Mark as hit after hitting at least one enemy
      if (hitAny) {
        attacker.hasHit = true;
      }
    });

    // Enemy attacks on players
    allEnemies.forEach(attacker => {
      if (!attacker.isAttacking || attacker.hasHit) return;

      players.forEach(target => {
        const distance = Math.abs(attacker.x - target.x);
        const verticalDistance = Math.abs(attacker.y - target.y);

        if (distance < attacker.effectiveStats.attackRange && verticalDistance < 50) {
          this.applyDamage(attacker, target);
          attacker.hasHit = true;
        }
      });
    });
  }

  /**
   * Apply damage from attacker to target
   * Attack-type-specific damage multipliers and knockback
   */
  applyDamage(attacker, target) {
    // Base damage from attacker's effective attack
    let damage = attacker.effectiveStats.attack;
    let knockbackForce = 5;

    // Apply attack type multipliers (matching Unit.performAttack mechanics)
    if (attacker.attackType === 'kick') {
      damage *= 1.5;
      knockbackForce = 8;
    } else if (attacker.attackType === 'special') {
      damage *= 2.5;
      knockbackForce = 12;
    }

    target.takeDamage(damage);

    // Mark target as recently hit (for hit flash effect on client)
    target.lastHitTime = Date.now();

    // Knockback
    const direction = target.x > attacker.x ? 1 : -1;
    target.applyKnockback(direction, knockbackForce);

    // Broadcast hit event with position for damage numbers
    this.io.to(this.id).emit('playerHit', {
      attackerId: attacker.id,
      targetId: target.id,
      damage: Math.round(damage),
      targetHealth: target.health,
      targetX: target.x,
      targetY: target.y,
      attackType: attacker.attackType || 'punch',
      isEnemy: target.team === 'enemies' || target.team === 'boss',
      isCritical: attacker.attackType === 'special'
    });

    // Check for knockout (player deaths are handled centrally in update loop)
    if (target.health <= 0) {
      target.isKnockedOut = true;

      // Enemy knockouts - emit immediately for VFX
      if (target.team !== 'players') {
        this.io.to(this.id).emit('playerKnockedOut', {
          playerId: target.id,
          knockedOutBy: attacker.id,
          targetX: target.x,
          targetY: target.y
        });
      }
    }
  }

  /**
   * Level complete - boss defeated, victory!
   * Stops the game loop after a grace period so clients get the levelComplete
   * event and can transition cleanly to the victory screen.
   */
  levelComplete() {
    if (this.status === 'finished') return; // idempotent

    this.status = 'finished';
    this.io.to(this.id).emit('levelComplete', {
      message: 'You defeated the Critical Priority 1 Outage!'
    });

    // Stop the game loop after a brief grace period to avoid spamming
    // gameState broadcasts to clients that already moved on to victory screen.
    setTimeout(() => {
      if (this.gameLoop) {
        clearInterval(this.gameLoop);
        this.gameLoop = null;
      }
    }, 500);
  }

  /**
   * Broadcast game state to all players
   */
  broadcastState() {
    const state = this.getState();
    this.io.to(this.id).emit('gameState', state);
  }

  /**
   * Add player to room
   */
  addPlayer(socketId, playerData) {
    // Assign a random character attribute if not specified
    const attribute = getRandomAttribute();

    const player = new Player(
      socketId,
      playerData.name || `Player ${this.players.size + 1}`,
      playerData.color || this.getRandomColor(),
      [attribute]
    );

    // Set initial position spread - mid play-area depth so they're visible
    player.x = 100 + this.players.size * 80;
    // Spawn slightly forward of mid-depth so visible
    const midDepth = (this.playAreaTop + this.groundLevel) / 2 + 40;
    player.y = midDepth;
    player.groundY = midDepth;

    this.players.set(socketId, player);

    // Recompute effective stats with new player
    this.recomputeAllEffectiveStats();

    // Broadcast player joined
    this.io.to(this.id).emit('playerJoined', {
      player: player.getState()
    });

    // Start game if we have 2+ players
    if (this.players.size >= 2 && this.status === 'waiting') {
      this.status = 'playing';
      // Initialize wave spawning timer when game starts
      this.nextWaveSpawnTime = Date.now();
      debugLog(`Game started! First wave will spawn at ${this.nextWaveSpawnTime}`);
      this.io.to(this.id).emit('gameStarted');
    }
  }

  /**
   * Remove player from room
   */
  removePlayer(socketId) {
    const player = this.players.get(socketId);
    this.players.delete(socketId);

    if (player) {
      // Recompute effective stats with player removed
      this.recomputeAllEffectiveStats();

      this.io.to(this.id).emit('playerLeft', { playerId: socketId });
    }
  }

  /**
   * Recompute effective stats for all units
   * Called when: level starts, player joins, player leaves
   */
  recomputeAllEffectiveStats() {
    // Collect all active modifiers from all players' attributes
    this.activeModifiers = [];

    this.players.forEach(player => {
      player.attributes.forEach(attr => {
        this.activeModifiers.push(attr.modifier);
      });
    });

    // Recompute all players
    this.players.forEach(player => {
      player.recomputeEffectiveStats(this.activeModifiers);
    });

    // Recompute all enemies
    this.enemies.forEach(enemy => {
      enemy.recomputeEffectiveStats(this.activeModifiers);
    });

    // Recompute boss if exists
    if (this.boss) {
      this.boss.recomputeEffectiveStats(this.activeModifiers);

      // Also rescale boss health based on current player count
      this.rescaleBossHealth();
    }
  }

  /**
   * Rescale boss health based on current player count
   */
  rescaleBossHealth() {
    if (!this.boss) return;

    const playerCount = this.players.size;
    const healthMultiplier = 1 + (playerCount - 1) * 0.25;
    const newMaxHealth = Math.round(300 * healthMultiplier);

    // Adjust current health proportionally to the new max health
    if (this.boss.maxHealth > 0) {
      const healthRatio = this.boss.health / this.boss.maxHealth;
      this.boss.maxHealth = newMaxHealth;
      this.boss.effectiveStats.maxHealth = newMaxHealth;
      this.boss.health = Math.round(newMaxHealth * healthRatio);
    } else {
      this.boss.maxHealth = newMaxHealth;
      this.boss.effectiveStats.maxHealth = newMaxHealth;
      this.boss.health = newMaxHealth;
    }

    debugLog(`[Boss] Rescaled health to ${Math.round(this.boss.health)}/${newMaxHealth} (${playerCount} players)`);
  }

  /**
   * Handle player input
   */
  handlePlayerInput(socketId, input) {
    // Ignore input during stage transitions or boss death cinematic
    if (this.stageTransition || this.bossDeathStartTime) return;
    const player = this.players.get(socketId);
    if (player) {
      player.handleInput(input, this.groundLevel, this.playAreaTop);
    }
  }

  /**
   * Handle player attack
   */
  handlePlayerAttack(socketId, attackType) {
    if (this.stageTransition || this.bossDeathStartTime) return;
    const player = this.players.get(socketId);
    if (player) {
      player.performAttack(attackType);
    }
  }

  /**
   * Respawn a dead player (continue game)
   */
  respawnPlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      // Reset player stats
      player.health = player.maxHealth;
      player.isKnockedOut = false;
      player.x = 100; // Reset to start position
      // Respawn at mid play-area depth
      const midDepth = (this.playAreaTop + this.groundLevel) / 2 + 40;
      player.y = midDepth;
      player.groundY = midDepth;
      player.velocityX = 0;
      player.velocityY = 0;

      // Clear death state
      this.playerDeadTime = null;
      this.playerDeadSocketId = null;

      debugLog(`[Respawn] Player ${socketId} continued!`);
      this.io.to(this.id).emit('playerRespawned', {
        playerId: socketId
      });
    }
  }

  /**
   * Calculate total enemies across all non-boss sections (used for HUD kill target)
   */
  getTotalEnemyCount() {
    let total = 0;
    this.zoneConfig.forEach(zone => {
      if (!zone.sections) return;
      zone.sections.forEach(section => {
        if (section.isBoss) return;
        (section.waves || []).forEach(wave => {
          total += wave.count || 0;
        });
      });
    });
    return total;
  }

  /**
   * Get game state for broadcasting
   */
  getState() {
    const zone = this.zoneConfig[this.currentZoneIndex];
    const currentSection = zone?.sections?.[this.currentSectionIndex];

    return {
      roomId: this.id,
      roomName: this.name,
      status: this.status,
      players: Array.from(this.players.values()).map(p => p.getState()),
      enemies: this.enemies.map(e => e.getState()),
      boss: this.boss ? this.boss.getState() : null,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      groundLevel: this.groundLevel,
      playAreaTop: this.playAreaTop, // Back of play area (depth)
      playAreaBottom: this.groundLevel, // Front of play area
      totalEnemyTarget: this.getTotalEnemyCount(), // For HUD progress display
      currentZone: zone,
      currentZoneIndex: this.currentZoneIndex,
      currentStageIndex: this.currentZoneIndex, // alias for clarity
      currentStageName: zone?.name,
      currentSection: currentSection,
      currentSectionIndex: this.currentSectionIndex,
      zoneCount: this.zoneConfig.length,
      stageTransition: this.stageTransition ? {
        elapsed: Date.now() - this.stageTransition.startTime,
        duration: this.STAGE_TRANSITION_DURATION,
        fromStageIndex: this.stageTransition.fromStageIndex,
        nextStageIndex: this.stageTransition.nextStageIndex
      } : null,
      bossDying: this.bossDeathStartTime ? {
        elapsed: Date.now() - this.bossDeathStartTime,
        duration: this.BOSS_DEATH_DURATION
      } : null,
      maxRightBound: this.maxRightBound,
      sectionClear: this.sectionWavesClear,
      playerDead: this.playerDeadSocketId ? true : false,
      deadPlayerId: this.playerDeadSocketId,
      // Debug info
      debug: {
        playerCount: this.players.size,
        enemyCount: this.enemies.length,
        totalKills: this.totalKills,
        enemiesSpawned: this.enemiesSpawned,
        currentSectionIndex: this.currentSectionIndex,
        sectionClear: this.sectionWavesClear,
        maxX: this.maxRightBound,
        playerX: Array.from(this.players.values())[0]?.x || 0
      }
    };
  }

  /**
   * Utility: Check if player is in room
   */
  hasPlayer(socketId) {
    return this.players.has(socketId);
  }

  /**
   * Utility: Get player count
   */
  getPlayerCount() {
    return this.players.size;
  }

  /**
   * Utility: Check if room is stale
   */
  isStale() {
    return this.players.size === 0 && Date.now() - this.createdAt > 300000;
  }

  /**
   * Utility: Get random color
   */
  getRandomColor() {
    const colors = [
      '#FF3366', '#33FF66', '#3366FF', '#FF6633',
      '#66FF33', '#6633FF', '#FFFF33', '#FF33FF'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

module.exports = GameRoom;
