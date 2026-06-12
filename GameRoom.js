const Player = require('./Player');
const Enemy = require('./Enemy');
const Boss = require('./Boss');
const { rollAttributeChoices, instantiateAttribute } = require('./CharacterAttributes');
const Leaderboard = require('./db/Leaderboard');

// Debug flag - set to true for verbose logging
const DEBUG = process.env.DEBUG === 'true';
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

// Network broadcast rate. The simulation still runs at the full tick rate
// (60Hz); we just send snapshots less often to cut per-client serialization +
// bandwidth. The client renders the latest snapshot every animation frame.
const BROADCAST_HZ = 30;

// How long a downed mook's corpse lingers (broadcast for rendering only) so the
// client can play its ~300ms flash-out death effect before it's removed.
const ENEMY_CORPSE_LINGER_MS = 320;

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
    // Recently-downed mooks kept around briefly (ENEMY_CORPSE_LINGER_MS) so the
    // client can play the flash-out death effect. They're excluded from
    // `enemies`, so gameplay (combat/progression) never sees them - they only
    // get broadcast for rendering.
    this.corpses = [];
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

    // Boss base max-health before per-player scaling and attribute modifiers.
    // Single source of truth for spawnBoss() and rescaleBossHealth(), which
    // previously disagreed (420 vs a stale 300).
    // BALANCE KNOB: tuned 420 -> 650 after players moved to 200 base HP —
    // at 420 the boss died in ~7-10s solo (slow telegraphs, no melee),
    // making it the easiest part of the run. Per-player scaling via
    // computeBossBaseHealth() still applies on top of this value.
    this.BOSS_BASE_HEALTH = 650;

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

    // Player death tracking - PER PLAYER. socketIds we've already fired
    // 'playerDied' for (cleared on respawn/revive). The old single-slot
    // playerDeadSocketId could only track ONE dead player, so a second
    // simultaneous co-op death never got its Game Over UI.
    this.deathEmitted = new Set();

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
        // Walkable band sits on the foreground drive aisle / open concrete
        // floor. groundLevel capped at 640 so the player sprite (cell ~170 px
        // tall, drawn bottom-aligned to the 60 px bounding box) never extends
        // past the 700 px canvas bottom - previously Bill's lower legs were
        // clipping off-screen at the south edge.
        floor: { playAreaTop: 510, groundLevel: 640 },
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
        // Pavement strip is small in this backdrop. groundLevel capped at 640
        // to keep the player sprite from clipping off the bottom of the
        // canvas; playAreaTop lowered to 545 (was 575) to preserve roughly
        // 95 px of walkable depth - Bill will brush the lower edges of the
        // foreground planters but stays out of the buildings/sculpture.
        floor: { playAreaTop: 545, groundLevel: 640 },
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
        // Marble floor occupies the bottom ~28% of the backdrop. groundLevel
        // capped at 640 (was 670) so Bill's sprite doesn't clip past the
        // canvas bottom; playAreaTop stays at 510 to keep him out of the
        // floor-to-ceiling glass wall.
        floor: { playAreaTop: 510, groundLevel: 640 },
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
        // Boss arena width expanded from 1500 -> 2500 to match the scaled
        // dimensions of stage4.png (1952x544 source scales to ~2511x700
        // when fit to canvas height). Previously the rightmost ~1000 px of
        // the backdrop scrolled out of bounds because the world ended at
        // x=1500. Boss spawns at section center (xRange midpoint = 1250).
        width: 2500,
        // groundLevel capped at 640 to stop Bill / boss from clipping off
        // the canvas bottom; depth of 130 px leaves enough vertical room
        // for boss-attack evasion.
        floor: { playAreaTop: 510, groundLevel: 640 },
        sections: [
          {
            name: 'Server Room - Boss',
            xRange: { start: 0, end: 2500 },
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
        attack: 15,        // 5x bump: 3 -> 15 (mooks now actually threatening)
        attackSpeed: 0.4,  // Reduced from 0.8 - half attack frequency
        armor: 0,
        attackRange: 50,
        movementSpeed: 1.0,
        color: '#FF9900'
      },
      'email-ticket': {
        maxHealth: 110,    // 5-6 punches to kill, or 4 kicks
        attack: 20,        // 5x bump: 4 -> 20
        attackSpeed: 0.4,  // Reduced from 0.8 - half attack frequency
        armor: 0,
        attackRange: 50,
        movementSpeed: 0.8,
        color: '#3366FF'
      },
      'network-ticket': {
        maxHealth: 130,    // 7 punches to kill, or 4-5 kicks
        attack: 30,        // 5x bump: 6 -> 30 (heaviest mook)
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
    // Update every tick (60Hz) but only broadcast every Nth tick (~BROADCAST_HZ).
    const broadcastEvery = Math.max(1, Math.round((1000 / BROADCAST_HZ) / this.tickRate));
    let tick = 0;
    this.gameLoop = setInterval(() => {
      this.update();
      if (++tick >= broadcastEvery) {
        tick = 0;
        this.broadcastState();
      }
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
    // Clear every pending one-shot timer too - otherwise a deleted room's
    // callbacks (auto-start, stage swap, loop shutdown) fire later against a
    // dead room and keep it reachable from the event loop.
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
    if (this.stageTransitionTimer) {
      clearTimeout(this.stageTransitionTimer);
      this.stageTransitionTimer = null;
    }
    if (this.levelCompleteTimer) {
      clearTimeout(this.levelCompleteTimer);
      this.levelCompleteTimer = null;
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

      // Boss attacks deal damage internally and used to be silent on the client
      // (no damage numbers / particles / shake - the hardest hits in the game
      // were the least readable). Surface each hit as a playerHit event.
      if (this.boss.pendingHits && this.boss.pendingHits.length) {
        for (const hit of this.boss.pendingHits) {
          this.io.to(this.id).emit('playerHit', {
            attackerId: this.boss.id,
            targetId: hit.targetId,
            damage: hit.damage,
            targetHealth: hit.targetHealth,
            targetX: hit.targetX,
            targetY: hit.targetY,
            attackType: 'kick', // medium-heavy feedback tier (solid shake + particles)
            isEnemy: false,     // target is a player -> red damage numbers
            isCritical: false
          });
        }
      }

      // Boss is taller than players (height 110 vs 60). If we clamp its
      // groundY to the same value as players, the boss's feet (y + height)
      // sit 50 px BELOW the canvas bottom and its lower body is clipped.
      // Cap the boss's groundY 50 px higher so its feet land on the same
      // canvas-bottom line as Bill's at the south boundary.
      const bossGroundLevel = this.groundLevel - (this.boss.height - 60);
      this.boss.update(deltaTime, this.gravity, bossGroundLevel, this.worldWidth, this.playAreaTop);
    }

    // Spawn waves
    this.updateWaveSpawning(now);

    // Combat collision detection
    this.checkCombat();

    // Track kills and retire dead enemies. Each death is counted exactly once
    // (the tick it dies), then the mook is moved out of `this.enemies` into the
    // short-lived `corpses` list so the client can play its flash-out instead
    // of it popping out of existence. Gameplay logic only ever sees `this.enemies`.
    const deadEnemies = this.enemies.filter(enemy => enemy.isKnockedOut && enemy.health <= 0);
    deadEnemies.forEach(enemy => {
      this.totalKills++;
      debugLog(`[Kill] #${this.totalKills}: ${enemy.name}`);
      // Co-op credit: every player in the room gets +1 ticket toward their
      // lifetime stat for each downed mook. Submitted to the leaderboard
      // when the session ends (boss death or disconnect).
      this.players.forEach(player => {
        player.sessionStats.ticketsKilled++;
      });
      enemy.koAt = now;
      this.corpses.push(enemy);
    });
    this.enemies = this.enemies.filter(enemy => !enemy.isKnockedOut || enemy.health > 0);

    // Expire corpses once their linger window passes.
    if (this.corpses.length) {
      this.corpses = this.corpses.filter(c => (now - (c.koAt || now)) < ENEMY_CORPSE_LINGER_MS);
    }

    // Centralized player death detection - catches deaths from ALL sources
    // (regular combat, boss attacks, etc.) Checked per-player every tick so
    // multiple simultaneous co-op deaths each get their own 'playerDied'.
    // Unit.takeDamage already flips isKnockedOut on lethal damage, so the
    // deathEmitted Set (not the isKnockedOut flag) is what dedupes the emit -
    // it's cleared on respawn / stage-transition revive.
    for (const [socketId, player] of this.players.entries()) {
      if (player.health <= 0 && !player.isKnockedOut) {
        player.isKnockedOut = true;
        player.health = 0;
      }
      if (player.health <= 0 && player.isKnockedOut && !this.deathEmitted.has(socketId)) {
        this.deathEmitted.add(socketId);
        debugLog(`[GameOver] Player ${socketId} died!`);
        this.io.to(this.id).emit('playerDied', {
          playerId: socketId
        });
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

    // Progression follows the FURTHEST-ALONG living player, not whoever
    // happens to be first in the Map (the host). Otherwise the host idling
    // at x=0 - or lying dead there - freezes wave spawns for teammates.
    // If everyone is down, fall back to the furthest player regardless.
    const allPlayers = Array.from(this.players.values());
    if (allPlayers.length === 0) return null;
    const alive = allPlayers.filter(p => !p.isKnockedOut);
    const tracked = alive.length > 0 ? alive : allPlayers;
    const playerX = Math.max(...tracked.map(p => p.x || 0));

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
      // Per-stage mob armor (balance): stage 1 = 30, stage 2 = 50, stage 3 = 80.
      // Makes mobs tankier deeper in the run and gives armor-shred picks teeth.
      // getEnemyBaseStats returns a fresh object per call, so mutating is safe.
      const STAGE_MOB_ARMOR = [30, 50, 80];
      baseStats.armor = STAGE_MOB_ARMOR[this.currentZoneIndex] ?? 80;
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

    // Schedule the actual stage swap (handle stored so stop() can cancel it)
    this.stageTransitionTimer = setTimeout(() => this.finishStageTransition(), this.STAGE_TRANSITION_DURATION);
  }

  /**
   * Actually swap to the next stage. Called by setTimeout from beginStageTransition.
   * Resets player coords to start of new stage, spawns boss if it's the boss stage,
   * fires stageStarted event.
   */
  finishStageTransition() {
    this.stageTransitionTimer = null; // one-shot - it just fired (or was bypassed)
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
    // Everyone was just revived above, so future deaths must re-emit.
    this.deathEmitted.clear();

    // Clear any enemies / boss carried over (defensive)
    this.enemies = [];
    this.corpses = [];
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

    // Offer every player a fresh 3-attribute pick at the start of the new
    // stage. They keep their existing attributes; the new one stacks.
    this.players.forEach((_, socketId) => {
      this.offerAttributeChoices(socketId, 'stage-start');
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

    // Boss base health scales with player count (+25% per extra player) via
    // computeBossBaseHealth. Attribute modifiers (e.g. Minimum Viable Product)
    // are layered on top by recomputeEffectiveStats below.
    const playerCount = this.players.size;

    const bossStats = {
      maxHealth: this.computeBossBaseHealth(playerCount),
      attack: 160,           // 5x bump: 32 -> 160 (boss melee threatens 4-5 shot KO)
      attackSpeed: 1.0,
      armor: 100,            // heavy armor (85% cap is 120) - special pierces it
      attackRange: 180,      // bumped: 150 -> 180
      movementSpeed: 0.85    // bumped: 0.4 -> 0.85 (over 2x)
    };

    // Spawn the boss at the height-adjusted groundLevel (see Update notes:
    // boss is 110 tall, so its feet land 50 px lower than a player's if it
    // sits at groundLevel directly - which would clip off the canvas).
    // Boss height is set in the Boss constructor (110); we mirror the
    // offset (boss-height - 60) here so spawn frame 1 already lines up.
    const BOSS_HEIGHT = 110;
    const bossSpawnGroundLevel = this.groundLevel - (BOSS_HEIGHT - 60);
    this.boss = new Boss(
      `${this.id}-boss`,
      'Critical Priority 1 Outage',
      bossStats,
      { x: centerX, y: bossSpawnGroundLevel }
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
        const dx = attacker.x - target.x;
        const dy = attacker.y - target.y;

        let inRange;
        if (attacker.attackType === 'special') {
          // Special uses a RADIAL "bubble" hitbox (matches the on-screen
          // explosion radius) instead of the rectangular range + thin
          // vertical band that punch/kick use. attackRadius=240 -> roughly
          // 2x the old reach, so the special clears a big circle around Bill.
          const dist = Math.sqrt(dx * dx + dy * dy);
          inRange = dist < (attacker.attackRadius || 240);
        } else {
          inRange = Math.abs(dx) < attacker.effectiveStats.attackRange && Math.abs(dy) < 50;
        }

        if (inRange) {
          this.applyDamage(attacker, target);
          hitAny = true;
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
        // Downed players are out of the fight - don't pummel the corpse
        // (it spams damage numbers and drives health further negative).
        if (target.isKnockedOut) return;

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

    // Apply attack type multipliers (AUTHORITATIVE damage - performAttack's
    // attackPower is display-only). Special is x7.5 AND pierces armor entirely.
    const ignoreArmor = attacker.attackType === 'special';
    if (attacker.attackType === 'kick') {
      damage *= 1.5;
      knockbackForce = 8;
    } else if (attacker.attackType === 'special') {
      damage *= 7.5;
      knockbackForce = 12;
    } else {
      // Punch (basic attack). The PLAYER punch is halved (balance pass: it was
      // out-damaging everything else); enemy/mook punches keep their base attack.
      if (attacker.team === 'players') damage *= 0.5;
    }

    target.takeDamage(damage, ignoreArmor);

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

    // Credit every player with the boss kill + crawl completion before we
    // submit, so the persistent stats reflect the win.
    this.players.forEach(player => {
      player.sessionStats.bossesDefeated += 1;
      player.sessionStats.crawlsCompleted += 1;
    });

    // Submit each player's session to the leaderboard. This is Query #2 -
    // see Leaderboard.js for the 2-query contract. We emit a per-socket
    // 'statsSubmitted' so the client can show the leaderboard screen after
    // the retirement splash.
    this.players.forEach(player => {
      this.submitPlayerStats(player);
    });

    this.io.to(this.id).emit('levelComplete', {
      message: 'You defeated the Critical Priority 1 Outage!'
    });

    // Stop the game loop after a brief grace period to avoid spamming
    // gameState broadcasts to clients that already moved on to victory screen.
    // (Handle stored so stop() can cancel it if the room dies first.)
    this.levelCompleteTimer = setTimeout(() => {
      if (this.gameLoop) {
        clearInterval(this.gameLoop);
        this.gameLoop = null;
      }
    }, 500);
  }

  /**
   * Submit a single player's session stats to the persistent leaderboard
   * and emit the updated totals + top-N back to that player's socket.
   * Idempotent per player via the _dbSubmitted flag - safe to call from
   * both levelComplete and removePlayer (disconnect).
   */
  submitPlayerStats(player) {
    if (!player || player._dbSubmitted) return;
    player._dbSubmitted = true;
    try {
      const result = Leaderboard.submitSession(player.name, player.sessionStats);
      if (result) {
        this.io.to(player.id).emit('statsSubmitted', {
          name: result.player.displayName,
          previousTickets: result.previousTotals.previousTickets,
          newTickets: result.player.ticketsKilled,
          newBosses: result.player.bossesDefeated,
          newCrawls: result.player.crawlsCompleted,
          sessionStats: player.sessionStats,
          leaderboard: result.leaderboard,
          globalStats: result.globalStats
        });
      }
    } catch (err) {
      console.error('[GameRoom] Failed to submit player stats:', err.message);
    }
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
   *
   * Players start with NO attributes - they pick one from a tier-rolled set
   * of 3 choices via the on-screen modal (offerAttributeChoices below). They
   * get another choice at the start of every stage. Attributes stack.
   *
   * playerData may include { luck } pre-computed from the persistent
   * leaderboard at the server's createRoom/joinRoom handler. We stash it on
   * the Player and pass it to every attribute roll for this session.
   */
  addPlayer(socketId, playerData) {
    const player = new Player(
      socketId,
      playerData.name || `Player ${this.players.size + 1}`,
      playerData.color || this.getRandomColor(),
      [], // start empty - the picker modal will populate this
      { luck: playerData.luck || 0 }
    );

    // Set initial position spread - mid play-area depth so they're visible
    player.x = 100 + this.players.size * 80;
    // Spawn slightly forward of mid-depth so visible
    const midDepth = (this.playAreaTop + this.groundLevel) / 2 + 40;
    player.y = midDepth;
    player.groundY = midDepth;

    this.players.set(socketId, player);

    // Recompute effective stats with new player (no attrs yet)
    this.recomputeAllEffectiveStats();

    // Broadcast player joined
    this.io.to(this.id).emit('playerJoined', {
      player: player.getState()
    });

    // Offer the new player their first 3 attribute choices (initial roll).
    // They can pick any time; their character spawns without bonuses until
    // they do. We don't gate the game on this - other players keep moving.
    this.offerAttributeChoices(socketId, 'game-start');

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
   * Roll 3 attribute choices and send them to a specific player. The client
   * shows a modal; on click, server.js relays a 'selectAttribute' event back
   * which calls applyAttributeSelection() below.
   *
   * `reason` is one of 'game-start' | 'stage-start' - used by the client to
   * tweak modal styling (e.g. show "Stage N start!" header for stage rolls).
   */
  offerAttributeChoices(socketId, reason = 'stage-start') {
    const player = this.players.get(socketId);
    if (!player) return;
    const luck = player.luck || 0;
    const choices = rollAttributeChoices(3, luck);
    // Cache the exact (key,tier) pairs we offered so applyAttributeSelection can
    // verify the client only picks something it was actually offered - otherwise
    // a client can emit selectAttribute with any key/tier (e.g. an endless
    // stream of celestial buffs) and farm the leaderboard.
    player.pendingAttributeChoices = choices.map((c) => ({ key: c.key, tier: c.tier }));
    this.io.to(socketId).emit('attributeChoicesOffered', {
      choices,
      reason,
      luck, // shown in the modal header so the player sees their luck working
      stageName: this.zoneConfig[this.currentZoneIndex]?.name || ''
    });
  }

  /**
   * Player clicked one of the offered choices. We trust the (key, tier) pair
   * the client sent back as long as it matches the schema - the client picked
   * from a server-generated list, so this is a low-trust but cheap path.
   * If you wanted strict anti-cheat: cache the offered triple per player and
   * verify the chosen index against that cache. For a coop game it's fine.
   */
  applyAttributeSelection(socketId, key, tier) {
    const player = this.players.get(socketId);
    if (!player) return;

    // Accept only a pick that matches a currently-pending offer, then consume
    // it so the same offer can't be replayed for repeated stacking.
    const pending = player.pendingAttributeChoices;
    if (!Array.isArray(pending) || !pending.some((c) => c.key === key && c.tier === tier)) {
      return;
    }

    const attr = instantiateAttribute(key, tier);
    if (!attr) return;

    player.pendingAttributeChoices = null;

    // Capture pre-pick maxHealth so we can scale CURRENT health by the
    // exact same multiplier the attribute applied. This is the only place
    // current health auto-scales - recomputeAllEffectiveStats() runs on
    // join/leave too, but those callers MUST NOT also scale current
    // health (it would double-heal). The scale fires here, exactly once
    // per pick, so it acts as a soft heal at moment-of-selection.
    const prevMaxHealth = player.effectiveStats.maxHealth || player.baseStats.maxHealth || 1;

    player.attributes.push(attr);
    this.recomputeAllEffectiveStats();

    const newMaxHealth = player.effectiveStats.maxHealth || prevMaxHealth;
    if (newMaxHealth > prevMaxHealth && player.health > 0) {
      // Same multiplier as the maxHealth modifier. Round to nearest int and
      // clamp to the new max in case floating-point drift overshoots.
      const ratio = newMaxHealth / prevMaxHealth;
      player.health = Math.min(player.maxHealth, Math.round(player.health * ratio));
    }

    // Broadcast updated player state so the HUD picks up the new attribute.
    // (Was reusing 'playerJoined', which made client logs claim a join on every
    // attribute pick - use a dedicated 'playerUpdated' event instead.)
    this.io.to(this.id).emit('playerUpdated', { player: player.getState() });
  }

  /**
   * Remove player from room
   */
  removePlayer(socketId) {
    const player = this.players.get(socketId);
    this.players.delete(socketId);
    // Drop any death bookkeeping for the leaver so a dead player leaving
    // can't wedge the room's death state.
    this.deathEmitted.delete(socketId);

    if (player) {
      // Submit whatever session progress they had before they vanished. The
      // submitPlayerStats guard makes this a no-op if they already submitted
      // via levelComplete (e.g. boss defeated then player closes the tab).
      this.submitPlayerStats(player);

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

    // Recompute boss if exists. rescaleBossHealth() re-derives the boss's
    // base health for the current player count AND re-applies the active
    // modifiers, so we don't call recomputeEffectiveStats separately here.
    if (this.boss) {
      this.rescaleBossHealth();
    }
  }

  /**
   * Boss base max-health for the current player count, BEFORE attribute
   * modifiers. 1x for solo, +25% per additional player. Single source of
   * truth shared by spawnBoss() and rescaleBossHealth().
   */
  computeBossBaseHealth(playerCount = this.players.size) {
    const mult = 1 + (Math.max(1, playerCount) - 1) * 0.25;
    return Math.round(this.BOSS_BASE_HEALTH * mult);
  }

  /**
   * Rescale boss health for the current player count and re-apply attribute
   * modifiers (e.g. Minimum Viable Product's boss-health debuff), preserving
   * the boss's current health as a fraction of its max.
   */
  rescaleBossHealth() {
    if (!this.boss) return;

    // Preserve the boss's current health as a fraction of its max so a
    // mid-fight player join/leave (or attribute pick) doesn't heal/gut it.
    const healthRatio = this.boss.maxHealth > 0
      ? this.boss.health / this.boss.maxHealth
      : 1;

    // Re-scale the BASE health for the current player count, then let
    // recomputeEffectiveStats layer the active modifiers on top. The old code
    // wrote effectiveStats.maxHealth directly off a stale 300 base, which
    // silently discarded every maxHealth modifier (boss-health debuffs never
    // actually applied).
    this.boss.baseStats.maxHealth = this.computeBossBaseHealth();
    this.boss.recomputeEffectiveStats(this.activeModifiers);

    // recomputeEffectiveStats set boss.maxHealth = effective max; restore the
    // pre-rescale health ratio against that new max.
    this.boss.health = Math.round(this.boss.maxHealth * healthRatio);

    debugLog(`[Boss] Rescaled health to ${Math.round(this.boss.health)}/${this.boss.maxHealth} (${this.players.size} players)`);
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
    // Whitelist the client-supplied attack type. An unknown type would set
    // isAttacking but fall through performAttack's switch without setting any
    // cooldown, letting a hacked client rapid-fire attacks.
    if (!['punch', 'kick', 'special'].includes(attackType)) {
      attackType = 'punch';
    }
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
    // Only a knocked-out player may respawn. Without this guard `playerContinue`
    // is a free, on-demand full heal any client can spam mid-fight.
    if (player && player.isKnockedOut) {
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

      // Re-arm death detection for this player only - other downed players
      // keep their own entries (and overlays) untouched.
      this.deathEmitted.delete(socketId);

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
    // zoneConfig is fixed for the room's lifetime, so compute once and memoize
    // (this used to run nested loops over the whole config on every broadcast).
    if (this._totalEnemyCount == null) {
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
      this._totalEnemyCount = total;
    }
    return this._totalEnemyCount;
  }

  /**
   * Get game state for broadcasting
   */
  getState() {
    const zone = this.zoneConfig[this.currentZoneIndex];

    return {
      roomId: this.id,
      roomName: this.name,
      status: this.status,
      players: Array.from(this.players.values()).map(p => p.getState()),
      // Include lingering corpses so the client can render their death flash-out.
      enemies: [...this.enemies, ...this.corpses].map(e => e.getState()),
      boss: this.boss ? this.boss.getState() : null,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      groundLevel: this.groundLevel,
      playAreaTop: this.playAreaTop, // Back of play area (depth)
      playAreaBottom: this.groundLevel, // Front of play area
      totalEnemyTarget: this.getTotalEnemyCount(), // For HUD progress display
      // NOTE: the full `currentZone`/`currentSection` config objects used to be
      // serialized here every tick. The client only needs the stage name, so we
      // send just `currentStageName` and drop the heavy static config.
      currentZoneIndex: this.currentZoneIndex,
      currentStageIndex: this.currentZoneIndex, // alias for clarity
      currentStageName: zone?.name,
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
      // NOTE: per-player death is broadcast via each player's isKnockedOut
      // flag (in players[].getState()) - the old room-wide playerDead /
      // deadPlayerId single-slot fields are gone.
      totalKills: this.totalKills, // HUD kill counter (top-level, not debug)
      // Debug info - only serialized when DEBUG is on, so prod broadcasts
      // don't ship dev-only fields (playerX etc.) at 30Hz.
      ...(DEBUG ? {
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
      } : {})
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
