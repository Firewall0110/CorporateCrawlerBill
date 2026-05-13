class GameRoom {
  constructor(id, name, io) {
    this.id = id;
    this.name = name;
    this.io = io;
    this.players = new Map();
    this.status = 'waiting'; // waiting, playing, finished
    this.createdAt = Date.now();
    this.lastUpdateTime = Date.now();
    
    // Game world settings
    this.worldWidth = 2000;
    this.worldHeight = 400;
    this.gravity = 0.8;
    this.groundLevel = 350;
    
    // Game loop
    this.tickRate = 1000 / 60; // 60 FPS
    this.gameLoop = null;
    this.startGameLoop();
  }

  startGameLoop() {
    this.gameLoop = setInterval(() => {
      this.update();
      this.broadcastState();
    }, this.tickRate);
  }

  stop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }

  update() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000; // Convert to seconds
    this.lastUpdateTime = now;

    // Update each player
    this.players.forEach((player) => {
      // Apply velocity
      player.x += player.velocityX;
      player.y += player.velocityY;

      // Apply gravity if in air
      if (player.y < this.groundLevel) {
        player.velocityY += this.gravity;
      }

      // Ground collision
      if (player.y >= this.groundLevel) {
        player.y = this.groundLevel;
        player.velocityY = 0;
        player.isJumping = false;
      }

      // World boundaries
      player.x = Math.max(0, Math.min(player.x, this.worldWidth - player.width));

      // Update attack cooldown
      if (player.attackCooldown > 0) {
        player.attackCooldown -= deltaTime;
      }

      // Update attack animation
      if (player.isAttacking && now - player.attackStartTime > player.attackDuration) {
        player.isAttacking = false;
      }

      // Reduce velocity friction
      player.velocityX *= 0.85;
    });

    // Check for combat collisions
    this.checkCombat();
  }

  checkCombat() {
    const playerArray = Array.from(this.players.values());
    
    for (let i = 0; i < playerArray.length; i++) {
      const attacker = playerArray[i];
      
      if (!attacker.isAttacking || attacker.hasHit) continue;

      for (let j = 0; j < playerArray.length; j++) {
        if (i === j) continue;
        
        const target = playerArray[j];
        
        // Check if attacker's attack range overlaps with target
        const distance = Math.abs(attacker.x - target.x);
        const verticalDistance = Math.abs(attacker.y - target.y);
        
        if (distance < attacker.attackRange && verticalDistance < 50) {
          // Hit detected!
          this.applyDamage(attacker, target);
          attacker.hasHit = true; // Prevent multiple hits from same attack
        }
      }
    }
  }

  applyDamage(attacker, target) {
    const damage = attacker.attackPower;
    target.health -= damage;
    
    // Knockback
    const direction = target.x > attacker.x ? 1 : -1;
    target.velocityX = direction * 5;
    target.velocityY = -3;

    // Broadcast hit event
    this.io.to(this.id).emit('playerHit', {
      attackerId: attacker.id,
      targetId: target.id,
      damage,
      targetHealth: target.health
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

  broadcastState() {
    const state = this.getState();
    this.io.to(this.id).emit('gameState', state);
  }

  addPlayer(socketId, playerData) {
    const player = {
      id: socketId,
      name: playerData.name || `Player ${this.players.size + 1}`,
      x: 100 + (this.players.size * 100),
      y: this.groundLevel,
      width: 40,
      height: 60,
      velocityX: 0,
      velocityY: 0,
      health: 100,
      maxHealth: 100,
      isJumping: false,
      isAttacking: false,
      attackCooldown: 0,
      attackDuration: 300, // ms
      attackStartTime: 0,
      attackRange: 60,
      attackPower: 10,
      hasHit: false,
      isKnockedOut: false,
      direction: 1, // 1 = right, -1 = left
      color: playerData.color || this.getRandomColor(),
      sprite: playerData.sprite || null
    };

    this.players.set(socketId, player);
    
    // Broadcast player joined
    this.io.to(this.id).emit('playerJoined', {
      player: this.sanitizePlayer(player)
    });

    // Start game if we have 2+ players
    if (this.players.size >= 2 && this.status === 'waiting') {
      this.status = 'playing';
      this.io.to(this.id).emit('gameStarted');
    }
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    this.io.to(this.id).emit('playerLeft', { playerId: socketId });
  }

  hasPlayer(socketId) {
    return this.players.has(socketId);
  }

  getPlayerCount() {
    return this.players.size;
  }

  handlePlayerInput(socketId, input) {
    const player = this.players.get(socketId);
    if (!player || player.isKnockedOut) return;

    const speed = 4;

    // Reset velocity
    player.velocityX = 0;

    // Movement
    if (input.left) {
      player.velocityX = -speed;
      player.direction = -1;
    }
    if (input.right) {
      player.velocityX = speed;
      player.direction = 1;
    }

    // Jump
    if (input.jump && !player.isJumping && player.y >= this.groundLevel) {
      player.velocityY = -15;
      player.isJumping = true;
    }
  }

  handlePlayerAttack(socketId, attackType) {
    const player = this.players.get(socketId);
    if (!player || player.isKnockedOut) return;

    // Check cooldown
    if (player.attackCooldown > 0 || player.isAttacking) return;

    player.isAttacking = true;
    player.attackStartTime = Date.now();
    player.attackCooldown = 0.5; // 500ms cooldown
    player.hasHit = false;

    // Different attack types
    switch (attackType) {
      case 'punch':
        player.attackRange = 60;
        player.attackPower = 10;
        player.attackDuration = 200;
        break;
      case 'kick':
        player.attackRange = 70;
        player.attackPower = 15;
        player.attackDuration = 300;
        break;
      case 'special':
        player.attackRange = 100;
        player.attackPower = 25;
        player.attackDuration = 500;
        break;
    }
  }

  getState() {
    return {
      roomId: this.id,
      roomName: this.name,
      status: this.status,
      players: Array.from(this.players.values()).map(p => this.sanitizePlayer(p)),
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      groundLevel: this.groundLevel
    };
  }

  sanitizePlayer(player) {
    return {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      width: player.width,
      height: player.height,
      health: player.health,
      maxHealth: player.maxHealth,
      isAttacking: player.isAttacking,
      isJumping: player.isJumping,
      isKnockedOut: player.isKnockedOut,
      direction: player.direction,
      color: player.color,
      sprite: player.sprite
    };
  }

  isStale() {
    // Room is stale if empty for more than 5 minutes
    return this.players.size === 0 && (Date.now() - this.createdAt) > 300000;
  }

  getRandomColor() {
    const colors = [
      '#FF3366', '#33FF66', '#3366FF', '#FF6633',
      '#66FF33', '#6633FF', '#FFFF33', '#FF33FF'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

module.exports = GameRoom;
