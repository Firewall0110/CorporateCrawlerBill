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

    // World settings
    this.worldWidth = 2000;
    this.worldHeight = 400;
    this.gravity = 0.8;
    this.groundLevel = 350;

    // Game loop
    this.tickRate = 1000 / 60; // 60 FPS
    this.gameLoop = null;

    // Level system
    this.currentZoneIndex = 0;
    this.currentWaveIndex = 0;
    this.nextWaveSpawnTime = 0;
    this.zoneConfig = this.createZoneConfig();

    // All active modifiers from player attributes
    this.activeModifiers = [];

    this.startGameLoop();
  }

  /**
   * Create zone configuration with waves and boss
   */
  createZoneConfig() {
    return [
      {
        name: 'Parking Lot',
        scrollRange: { start: 0, end: 500 },
        waves: [
          { enemyType: 'printer-ticket', count: 2, delay: 0 },
          { enemyType: 'email-ticket', count: 3, delay: 3000 },
          { enemyType: 'printer-ticket', count: 3, delay: 6000 }
        ]
      },
      {
        name: 'Quad',
        scrollRange: { start: 500, end: 1000 },
        waves: [
          { enemyType: 'email-ticket', count: 3, delay: 0 },
          { enemyType: 'network-ticket', count: 2, delay: 4000 },
          { enemyType: 'email-ticket', count: 4, delay: 8000 }
        ]
      },
      {
        name: 'Lobby',
        scrollRange: { start: 1000, end: 1500 },
        waves: [
          { enemyType: 'network-ticket', count: 3, delay: 0 },
          { enemyType: 'printer-ticket', count: 4, delay: 5000 }
        ]
      },
      {
        name: 'Elevators',
        scrollRange: { start: 1500, end: 2000 },
        isBoss: true
      }
    ];
  }

  /**
   * Get base stats for enemy types
   */
  getEnemyBaseStats(enemyType) {
    const stats = {
      'printer-ticket': {
        maxHealth: 40,
        attack: 6,
        attackSpeed: 1.1,
        armor: 0,
        attackRange: 50,
        movementSpeed: 1.2,
        color: '#FF9900'
      },
      'email-ticket': {
        maxHealth: 60,
        attack: 7,
        attackSpeed: 0.9,
        armor: 0,
        attackRange: 50,
        movementSpeed: 0.9,
        color: '#3366FF'
      },
      'network-ticket': {
        maxHealth: 100,
        attack: 11,
        attackSpeed: 0.8,
        armor: 5,
        attackRange: 60,
        movementSpeed: 0.7,
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

    if (this.players.size < 2) return; // Need 2+ players to play

    // Update all players
    this.players.forEach(player => {
      player.update(deltaTime, this.gravity, this.groundLevel, this.worldWidth);
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

    // Clean up dead enemies
    this.enemies = this.enemies.filter(enemy => !enemy.isKnockedOut || enemy.health > 0);

    // Boss defeat
    if (this.boss && this.boss.isKnockedOut) {
      this.levelComplete();
    }

    // Level progression
    this.checkZoneProgression();
  }

  /**
   * Spawn enemy waves based on zone configuration
   */
  updateWaveSpawning(now) {
    const zone = this.zoneConfig[this.currentZoneIndex];
    if (!zone || zone.isBoss) return;

    const waves = zone.waves;
    if (this.currentWaveIndex >= waves.length) {
      // Zone complete, move to next
      console.log(`Zone ${this.currentZoneIndex} complete, advancing...`);
      this.advanceZone();
      return;
    }

    const currentWave = waves[this.currentWaveIndex];
    const timeSinceSpawn = now - this.nextWaveSpawnTime;

    if (now >= this.nextWaveSpawnTime) {
      // Spawn wave
      console.log(`Wave spawn time reached! (now=${now}, nextSpawnTime=${this.nextWaveSpawnTime}, delta=${timeSinceSpawn}ms)`);
      this.spawnWave(currentWave);
      this.nextWaveSpawnTime = now + 5000; // 5s between waves
      this.currentWaveIndex++;
    }
  }

  /**
   * Spawn an enemy wave
   */
  spawnWave(waveConfig) {
    const zone = this.zoneConfig[this.currentZoneIndex];
    const startX = zone.scrollRange.start + 100;

    console.log(`Spawning wave: ${waveConfig.count}x ${waveConfig.enemyType} in zone ${this.currentZoneIndex}`);

    for (let i = 0; i < waveConfig.count; i++) {
      const enemyId = `${this.id}-enemy-${Date.now()}-${i}`;
      const baseStats = this.getEnemyBaseStats(waveConfig.enemyType);
      const spawnX = startX + i * 80;

      const enemy = new Enemy(
        enemyId,
        waveConfig.enemyType,
        baseStats,
        { x: spawnX, y: this.groundLevel }
      );

      // Apply current modifiers to enemy
      enemy.recomputeEffectiveStats(this.activeModifiers);

      this.enemies.push(enemy);
      console.log(`  Created enemy: ${enemy.name} at x=${spawnX}`);
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
    this.currentWaveIndex = 0;
    this.nextWaveSpawnTime = Date.now();

    const zone = this.zoneConfig[this.currentZoneIndex];

    // If boss zone, spawn boss
    if (zone.isBoss) {
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
    const centerX = (zone.scrollRange.start + zone.scrollRange.end) / 2;

    const bossStats = {
      maxHealth: 300,
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
  }

  /**
   * Check level progression (players moving through world)
   */
  checkZoneProgression() {
    // Players naturally progress as they fight through zones
    // Zones advance when all enemies in current wave are defeated
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

      allEnemies.forEach(target => {
        const distance = Math.abs(attacker.x - target.x);
        const verticalDistance = Math.abs(attacker.y - target.y);

        if (distance < attacker.effectiveStats.attackRange && verticalDistance < 50) {
          this.applyDamage(attacker, target);
          attacker.hasHit = true;
        }
      });
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
      this.io.to(this.id).emit('playerKnockedOut', {
        playerId: target.id,
        knockedOutBy: attacker.id
      });
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
    }
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
   * Get game state for broadcasting
   */
  getState() {
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
      currentZone: this.zoneConfig[this.currentZoneIndex],
      currentZoneIndex: this.currentZoneIndex,
      zoneCount: this.zoneConfig.length
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
