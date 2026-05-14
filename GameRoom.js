const Player = require('./Player');
const Enemy = require('./Enemy');
const Boss = require('./Boss');
const { getRandomAttribute } = require('./CharacterAttributes');

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

    // World settings - expanded for 4-direction movement
    this.worldWidth = 2000;
    this.worldHeight = 800; // Doubled height for vertical movement
    this.gravity = 0.8;
    this.groundLevel = 600; // Adjusted for taller world

    // Game loop
    this.tickRate = 1000 / 60; // 60 FPS
    this.gameLoop = null;

    // Level system - Section-based progression
    this.currentZoneIndex = 0;
    this.currentSectionIndex = 0;
    this.sectionWavesClear = false; // Has current section's wave been cleared?
    this.sectionWavesSpawned = false; // Have we already spawned waves for this section?
    this.maxRightBound = 300; // Player can't move beyond this X until section is clear
    this.zoneConfig = this.createZoneConfig();

    // All active modifiers from player attributes
    this.activeModifiers = [];

    // Kill tracking
    this.totalKills = 0;
    this.enemiesSpawned = 0;
    this.spawnedEnemyIds = new Set(); // Track which enemies have been spawned

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
    return [
      {
        name: 'Parking Lot',
        sections: [
          {
            name: 'Parking Lot - Section 1',
            xRange: { start: 0, end: 300 },
            waves: [
              { enemyType: 'printer-ticket', count: 3, spawnX: 150 }
            ]
          },
          {
            name: 'Parking Lot - Section 2',
            xRange: { start: 300, end: 600 },
            waves: [
              { enemyType: 'email-ticket', count: 3, spawnX: 450 }
            ]
          },
          {
            name: 'Parking Lot - Section 3',
            xRange: { start: 600, end: 900 },
            waves: [
              { enemyType: 'printer-ticket', count: 4, spawnX: 750 }
            ]
          }
        ]
      },
      {
        name: 'Quad',
        sections: [
          {
            name: 'Quad - Section 1',
            xRange: { start: 900, end: 1200 },
            waves: [
              { enemyType: 'email-ticket', count: 3, spawnX: 1050 }
            ]
          },
          {
            name: 'Quad - Section 2',
            xRange: { start: 1200, end: 1500 },
            waves: [
              { enemyType: 'network-ticket', count: 3, spawnX: 1350 }
            ]
          },
          {
            name: 'Quad - Section 3',
            xRange: { start: 1500, end: 1800 },
            waves: [
              { enemyType: 'email-ticket', count: 4, spawnX: 1650 }
            ]
          }
        ]
      },
      {
        name: 'Lobby',
        sections: [
          {
            name: 'Lobby - Section 1',
            xRange: { start: 1800, end: 2100 },
            waves: [
              { enemyType: 'network-ticket', count: 3, spawnX: 1950 }
            ]
          },
          {
            name: 'Lobby - Section 2',
            xRange: { start: 2100, end: 2400 },
            waves: [
              { enemyType: 'printer-ticket', count: 4, spawnX: 2250 }
            ]
          },
          {
            name: 'Lobby - Section 3',
            xRange: { start: 2400, end: 2700 },
            waves: [
              { enemyType: 'network-ticket', count: 3, spawnX: 2550 }
            ]
          }
        ]
      },
      {
        name: 'Elevators',
        sections: [
          {
            name: 'Elevators - Boss',
            xRange: { start: 2700, end: 3000 },
            isBoss: true,
            waves: []
          }
        ]
      }
    ];
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
        attackSpeed: 0.8,
        armor: 0,
        attackRange: 50,
        movementSpeed: 1.0,
        color: '#FF9900'
      },
      'email-ticket': {
        maxHealth: 110,    // 5-6 punches to kill, or 4 kicks
        attack: 4,
        attackSpeed: 0.8,
        armor: 0,
        attackRange: 50,
        movementSpeed: 0.8,
        color: '#3366FF'
      },
      'network-ticket': {
        maxHealth: 130,    // 7 punches to kill, or 4-5 kicks
        attack: 6,
        attackSpeed: 0.7,
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
      console.log(`[GameRoom ${this.id}] Game update running! Status: ${this.status}, NextWaveTime: ${this.nextWaveSpawnTime}, Now: ${now}, Waves in zone: ${this.zoneConfig[this.currentZoneIndex]?.waves?.length}`);
      this.debugUpdateLogged = true;
    }

    // Update all players
    this.players.forEach(player => {
      player.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth);

      // Enforce section boundary - can't move right until section is clear
      if (!this.sectionWavesClear && player.x > this.maxRightBound) {
        player.x = this.maxRightBound;
        player.velocityX = 0;
      }
    });

    // Update all enemies
    this.enemies.forEach(enemy => {
      enemy.updateAI(Array.from(this.players.values()), deltaTime);
      enemy.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth);
    });

    // Update boss if exists
    if (this.boss) {
      this.boss.updateAI(Array.from(this.players.values()), deltaTime);
      this.boss.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth);
    }

    // Spawn waves
    this.updateWaveSpawning(now);

    // Combat collision detection
    this.checkCombat();

    // Clean up dead enemies and track kills
    const deadEnemies = this.enemies.filter(enemy => enemy.isKnockedOut && enemy.health <= 0);
    deadEnemies.forEach(enemy => {
      this.totalKills++;
      console.log(`[Kill] #${this.totalKills}: ${enemy.name} (Total: ${this.totalKills})`);
    });
    this.enemies = this.enemies.filter(enemy => !enemy.isKnockedOut || enemy.health > 0);

    // Boss defeat
    if (this.boss && this.boss.isKnockedOut) {
      this.levelComplete();
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
   */
  updateWaveSpawning(now) {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone || !zone.sections) return;

    const current = this.getCurrentSection();
    if (!current) return;

    const { section, index } = current;

    // Check if we've moved to a new section
    if (index !== this.currentSectionIndex) {
      this.currentSectionIndex = index;
      this.sectionWavesClear = false;
      this.sectionWavesSpawned = false; // Reset spawn flag for new section
      this.maxRightBound = section.xRange.end;
      console.log(`[Section] Entered: ${section.name} (section ${index})`);
    }

    // Spawn waves in this section ONCE and only once
    if (!this.sectionWavesSpawned && section.waves && section.waves.length > 0) {
      console.log(`[Section] Spawning waves for: ${section.name}`);
      section.waves.forEach(waveConfig => {
        this.spawnWave(waveConfig);
      });
      this.sectionWavesSpawned = true; // Mark as spawned - never spawn again for this section
    }

    // Check if section is cleared (no enemies in this section)
    const enemiesInSection = this.enemies.filter(e =>
      e.x >= section.xRange.start && e.x <= section.xRange.end
    );

    if (enemiesInSection.length === 0 && this.enemies.length > 0) {
      if (!this.sectionWavesClear) {
        this.sectionWavesClear = true;
        console.log(`[Section] CLEARED: ${section.name} - You can now advance!`);
      }
    }
  }

  /**
   * Spawn an enemy wave
   */
  spawnWave(waveConfig) {
    // Get spawn X from wave config or use centered position
    const baseSpawnX = waveConfig.spawnX || 800;

    console.log(`[Spawn] Wave: ${waveConfig.count}x ${waveConfig.enemyType}`);

    for (let i = 0; i < waveConfig.count; i++) {
      const enemyId = `${this.id}-enemy-${Date.now()}-${Math.random()}`; // Ensure unique IDs

      // Don't spawn if already spawned
      if (this.spawnedEnemyIds.has(enemyId)) {
        console.log(`[Spawn] Skipped duplicate: ${enemyId}`);
        continue;
      }

      const baseStats = this.getEnemyBaseStats(waveConfig.enemyType);
      const spawnX = baseSpawnX + i * 60; // Spread enemies out

      const enemy = new Enemy(
        enemyId,
        waveConfig.enemyType,
        baseStats,
        { x: spawnX, y: this.groundLevel }
      );

      // Apply current modifiers to enemy
      enemy.recomputeEffectiveStats(this.activeModifiers);

      this.enemies.push(enemy);
      this.spawnedEnemyIds.add(enemyId);
      this.enemiesSpawned++;

      console.log(`[Spawn] Created #${this.enemiesSpawned}: ${enemy.name} at x=${spawnX}`);
    }
  }

  /**
   * Advance to next zone
   */
  advanceZone() {
    if (this.currentZoneIndex >= this.zoneConfig.length - 1) {
      return; // Already at boss zone
    }

    this.currentZoneIndex++;
    this.currentSectionIndex = 0;
    this.sectionWavesClear = false;
    this.sectionWavesSpawned = false; // Reset for new zone's sections
    this.zoneProgressed = false;

    const zone = this.zoneConfig[this.currentZoneIndex];
    const firstSection = zone.sections?.[0];

    if (firstSection) {
      this.maxRightBound = firstSection.xRange.end;
    }

    // If boss zone, spawn boss
    if (zone.sections && zone.sections[0]?.isBoss) {
      this.spawnBoss();
      this.io.to(this.id).emit('bossEncounter', {
        bossName: 'Critical Priority 1 Outage',
        zoneIndex: this.currentZoneIndex
      });
    }

    this.io.to(this.id).emit('zoneChange', {
      zoneName: zone.name,
      zoneIndex: this.currentZoneIndex
    });
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
      maxHealth: Math.round(300 * healthMultiplier),
      attack: 18,
      attackSpeed: 1.0,
      armor: 20,
      attackRange: 150,
      movementSpeed: 0.4
    };

    this.boss = new Boss(
      `${this.id}-boss`,
      'Critical Priority 1 Outage',
      bossStats,
      { x: centerX, y: this.groundLevel }
    );

    // Apply modifiers to boss
    this.boss.recomputeEffectiveStats(this.activeModifiers);

    console.log(`[Boss] Spawned at x=${centerX} with ${Math.round(bossStats.maxHealth)} health (${playerCount} players)`);
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
        console.log(`[Zone] COMPLETED: ${zone.name}`);
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
   */
  applyDamage(attacker, target) {
    const damage = attacker.effectiveStats.attack;
    target.takeDamage(damage);

    // Knockback
    const direction = target.x > attacker.x ? 1 : -1;
    target.applyKnockback(direction, 5);

    // Broadcast hit event
    this.io.to(this.id).emit('playerHit', {
      attackerId: attacker.id,
      targetId: target.id,
      damage: Math.round(damage),
      targetHealth: target.health,
      isEnemy: target.team === 'enemies'
    });

    // Check for knockout
    if (target.health <= 0) {
      target.isKnockedOut = true;

      // If it's a player, trigger game over
      if (target.team === 'players') {
        this.playerDeadTime = Date.now();
        this.playerDeadSocketId = target.id;
        console.log(`[GameOver] Player ${target.id} died!`);
        this.io.to(this.id).emit('playerDied', {
          playerId: target.id,
          knockedOutBy: attacker.id
        });
      } else {
        // Enemy knockout
        this.io.to(this.id).emit('playerKnockedOut', {
          playerId: target.id,
          knockedOutBy: attacker.id
        });
      }
    }
  }

  /**
   * Level complete
   */
  levelComplete() {
    this.status = 'finished';
    this.io.to(this.id).emit('levelComplete', {
      message: 'You defeated the Critical Priority 1 Outage!'
    });
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

    // Set initial position spread
    player.x = 100 + this.players.size * 80;
    player.y = this.groundLevel;

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
      console.log(`Game started! First wave will spawn at ${this.nextWaveSpawnTime}`);
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

    console.log(`[Boss] Rescaled health to ${Math.round(this.boss.health)}/${newMaxHealth} (${playerCount} players)`);
  }

  /**
   * Handle player input
   */
  handlePlayerInput(socketId, input) {
    const player = this.players.get(socketId);
    if (player) {
      player.handleInput(input, this.groundLevel);
    }
  }

  /**
   * Handle player attack
   */
  handlePlayerAttack(socketId, attackType) {
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
      player.y = this.groundLevel;
      player.velocityX = 0;
      player.velocityY = 0;

      // Clear death state
      this.playerDeadTime = null;
      this.playerDeadSocketId = null;

      console.log(`[Respawn] Player ${socketId} continued!`);
      this.io.to(this.id).emit('playerRespawned', {
        playerId: socketId
      });
    }
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
      currentZone: zone,
      currentZoneIndex: this.currentZoneIndex,
      currentSection: currentSection,
      currentSectionIndex: this.currentSectionIndex,
      zoneCount: this.zoneConfig.length,
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
