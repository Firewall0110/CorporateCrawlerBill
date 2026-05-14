import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// SERVER CONFIG - Use relative URL so it works both locally and on Railway
const SERVER_URL = window.location.origin;

const BeatEmUpGame = () => {
  const [screen, setScreen] = useState('menu'); // menu, lobby, game
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [error, setError] = useState('');
  const [cameraX, setCameraX] = useState(0);
  const [levelWon, setLevelWon] = useState(false);

  const canvasRef = useRef(null);
  const keysPressed = useRef({});
  const animationFrameRef = useRef(null);

  // Visual effects refs (mutable, don't trigger re-renders)
  const damageNumbersRef = useRef([]); // {id, x, y, value, color, spawnTime, vy}
  const hitParticlesRef = useRef([]); // {x, y, vx, vy, color, life}
  const screenShakeRef = useRef({ intensity: 0, until: 0 });
  const flashEffectRef = useRef({ color: null, until: 0 });

  const CANVAS_WIDTH = 1200;
  const CANVAS_HEIGHT = 700; // Expanded to show more vertical space

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SERVER_URL, {
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('gameState', (state) => {
      setGameState(state);
      // Debug logging
      if (state.debug && (state.debug.enemyCount > 0 || state.debug.currentWaveIndex > 0)) {
        console.log(`[GameState] Enemies: ${state.debug.enemyCount}, Wave: ${state.debug.currentWaveIndex}, Zone: ${state.currentZoneIndex}`);
      }
    });

    newSocket.on('roomCreated', ({ roomId: id, playerId: pid, gameState: gs }) => {
      setRoomId(id);
      setPlayerId(pid);
      setGameState(gs);
      setLevelWon(false);
      setScreen('game');
    });

    newSocket.on('roomJoined', ({ roomId: id, playerId: pid, gameState: gs }) => {
      setRoomId(id);
      setPlayerId(pid);
      setGameState(gs);
      setLevelWon(false);
      setScreen('game');
    });

    newSocket.on('playerJoined', ({ player }) => {
      console.log('Player joined:', player.name);
    });

    newSocket.on('playerLeft', ({ playerId: pid }) => {
      console.log('Player left:', pid);
    });

    newSocket.on('playerHit', ({ attackerId, targetId, damage, targetX, targetY, attackType, isEnemy, isCritical }) => {
      // Spawn floating damage number
      damageNumbersRef.current.push({
        id: `dmg-${Date.now()}-${Math.random()}`,
        x: targetX,
        y: targetY,
        value: damage,
        color: isCritical ? '#ff00ff' : (isEnemy ? '#ffff00' : '#ff3333'),
        spawnTime: Date.now(),
        vy: -2,
        isCritical
      });

      // Spawn hit particles
      const particleCount = attackType === 'special' ? 12 : attackType === 'kick' ? 8 : 5;
      const particleColor = isCritical ? '#ff00ff' : (isEnemy ? '#ffff66' : '#ff3333');
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
        const speed = 2 + Math.random() * 3;
        hitParticlesRef.current.push({
          x: targetX,
          y: targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          color: particleColor,
          life: 1.0
        });
      }

      // Screen shake based on attack type
      const shakeIntensity = attackType === 'special' ? 8 : attackType === 'kick' ? 4 : 2;
      const shakeDuration = attackType === 'special' ? 300 : attackType === 'kick' ? 200 : 100;
      const now = Date.now();
      if (now + shakeDuration > screenShakeRef.current.until) {
        screenShakeRef.current = {
          intensity: Math.max(screenShakeRef.current.intensity, shakeIntensity),
          until: now + shakeDuration
        };
      }

      // Brief flash effect on critical hits
      if (isCritical) {
        flashEffectRef.current = {
          color: 'rgba(255, 0, 255, 0.2)',
          until: Date.now() + 100
        };
      }
    });

    newSocket.on('playerKnockedOut', ({ playerId: pid, knockedOutBy, targetX, targetY }) => {
      // KO explosion particles
      if (targetX !== undefined && targetY !== undefined) {
        for (let i = 0; i < 20; i++) {
          const angle = (Math.PI * 2 * i) / 20;
          const speed = 3 + Math.random() * 4;
          hitParticlesRef.current.push({
            x: targetX,
            y: targetY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            color: '#ff9900',
            life: 1.5
          });
        }
        // Bigger screen shake on KO
        screenShakeRef.current = {
          intensity: 6,
          until: Date.now() + 250
        };
      }
    });

    newSocket.on('playerDied', ({ playerId: pid }) => {
      console.log(`Player ${pid} died! Game Over!`);
    });

    newSocket.on('playerRespawned', ({ playerId: pid }) => {
      console.log(`Player ${pid} respawned!`);
    });

    newSocket.on('gameStarted', () => {
      console.log('Game started!');
    });

    newSocket.on('zoneChange', ({ zoneName, zoneIndex }) => {
      console.log(`Entered zone: ${zoneName}`);
    });

    newSocket.on('bossEncounter', ({ bossName }) => {
      console.log(`Boss encounter: ${bossName}`);
    });

    newSocket.on('levelComplete', ({ message }) => {
      console.log(message);
      setLevelWon(true);
    });

    newSocket.on('error', ({ message }) => {
      setError(message);
      setTimeout(() => setError(''), 3000);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Keyboard input handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      keysPressed.current[e.key.toLowerCase()] = true;

      // Only prevent default for game controls when actually in the game
      if (screen === 'game' && ['a', 'd', 'w', 's', ' ', 'j', 'k', 'l'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e) => {
      keysPressed.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [screen]);

  // Send input to server
  useEffect(() => {
    if (!socket || screen !== 'game') return;

    const inputInterval = setInterval(() => {
      const input = {
        left: keysPressed.current['a'] || keysPressed.current['arrowleft'],
        right: keysPressed.current['d'] || keysPressed.current['arrowright'],
        jump: keysPressed.current['w'] || keysPressed.current['arrowup'] || keysPressed.current[' '],
        up: keysPressed.current['w'] || keysPressed.current['arrowup'], // Vertical movement up
        down: keysPressed.current['s'] || keysPressed.current['arrowdown'] // Vertical movement down
      };

      socket.emit('playerInput', { roomId, input });

      // Attack inputs
      if (keysPressed.current['j']) {
        socket.emit('playerAttack', { roomId, attackType: 'punch' });
        keysPressed.current['j'] = false;
      }
      if (keysPressed.current['k']) {
        socket.emit('playerAttack', { roomId, attackType: 'kick' });
        keysPressed.current['k'] = false;
      }
      if (keysPressed.current['l']) {
        socket.emit('playerAttack', { roomId, attackType: 'special' });
        keysPressed.current['l'] = false;
      }
    }, 16);

    return () => clearInterval(inputInterval);
  }, [socket, screen, roomId]);

  // Update camera position
  useEffect(() => {
    if (!gameState || !gameState.players.length) return;

    // Find this player
    const thisPlayer = gameState.players.find(p => p.id === playerId);
    if (!thisPlayer) return;

    // Follow player, keeping them centered-ish in viewport
    const targetCameraX = thisPlayer.x - CANVAS_WIDTH / 3;
    const clampedCameraX = Math.max(0, Math.min(targetCameraX, gameState.worldWidth - CANVAS_WIDTH));
    setCameraX(clampedCameraX);
  }, [gameState, playerId]);

  // Canvas rendering
  useEffect(() => {
    if (screen !== 'game' || !gameState) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    const render = () => {
      const now = Date.now();

      // Calculate screen shake offset
      let shakeX = 0, shakeY = 0;
      if (now < screenShakeRef.current.until) {
        const remaining = (screenShakeRef.current.until - now) / 300;
        const intensity = screenShakeRef.current.intensity * remaining;
        shakeX = (Math.random() - 0.5) * intensity * 2;
        shakeY = (Math.random() - 0.5) * intensity * 2;
      } else {
        screenShakeRef.current.intensity = 0;
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);

      // Draw parallax scrolling background
      drawParallaxBackground(
        ctx,
        gameState.currentZoneIndex,
        cameraX,
        gameState.worldWidth,
        gameState.worldHeight
      );

      // Draw ground line (cyan accent)
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, gameState.groundLevel);
      ctx.lineTo(canvas.width, gameState.groundLevel);
      ctx.stroke();

      // Build sorted render list (sort by Y so deeper units render behind)
      const allUnits = [];
      if (gameState.enemies) gameState.enemies.forEach(e => allUnits.push({ unit: e, isPlayer: false, isBoss: false }));
      if (gameState.boss) allUnits.push({ unit: gameState.boss, isPlayer: false, isBoss: true });
      if (gameState.players) gameState.players.forEach(p => allUnits.push({ unit: p, isPlayer: true, isBoss: false }));
      allUnits.sort((a, b) => a.unit.y - b.unit.y);

      // Render units in Y-sorted order
      allUnits.forEach(({ unit, isPlayer, isBoss }) => {
        if (isBoss) {
          drawBoss(ctx, unit, cameraX, gameState.groundLevel, now);
        } else {
          drawUnit(ctx, unit, cameraX, gameState.groundLevel, isPlayer && unit.id === playerId, now);
        }
      });

      // Draw hit particles
      updateAndDrawParticles(ctx, hitParticlesRef.current, cameraX);

      // Draw floating damage numbers
      updateAndDrawDamageNumbers(ctx, damageNumbersRef.current, cameraX);

      // Draw "advance right" indicator if section is clear
      if (gameState.sectionClear && !gameState.boss) {
        drawAdvanceIndicator(ctx, now, canvas.width);
      }

      ctx.restore();

      // Flash overlay (not affected by shake)
      if (now < flashEffectRef.current.until && flashEffectRef.current.color) {
        ctx.fillStyle = flashEffectRef.current.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Draw HUD (above shake, never moves)
      drawHUD(ctx, gameState, playerId, CANVAS_WIDTH);

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState, screen, playerId, cameraX]);

  // Fetch available rooms
  const fetchRooms = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/rooms`);
      const data = await response.json();
      setAvailableRooms(data.rooms);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    }
  };

  const createRoom = () => {
    console.log('[CreateRoom] Button clicked', { playerName, socketConnected: socket?.connected });

    if (!playerName.trim()) {
      console.log('[CreateRoom] Name validation failed');
      setError('Please enter your name');
      return;
    }

    if (!socket) {
      console.log('[CreateRoom] Socket not initialized');
      setError('Connection error - please refresh');
      return;
    }

    const roomName = `${playerName}'s Game`;
    const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
    console.log('[CreateRoom] Emitting createRoom event', { roomName, playerData: { name: playerName, color } });

    socket.emit('createRoom', {
      roomName,
      playerData: { name: playerName, color }
    });
  };

  const joinRoom = (roomId) => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
    socket.emit('joinRoom', {
      roomId,
      playerData: { name: playerName, color }
    });
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
      color: '#00ffff',
      fontFamily: '"Press Start 2P", monospace',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />

      {error && (
        <div style={{
          position: 'fixed',
          top: '20px',
          background: '#ff0066',
          color: '#ffffff',
          padding: '15px 30px',
          borderRadius: '5px',
          fontSize: '12px',
          zIndex: 1000,
          border: '2px solid #ffffff',
          boxShadow: '0 0 20px rgba(255, 0, 102, 0.5)'
        }}>
          {error}
        </div>
      )}

      {screen === 'menu' && (
        <div style={{
          textAlign: 'center',
          maxWidth: '600px',
          padding: '40px',
          background: 'rgba(26, 26, 46, 0.8)',
          border: '3px solid #00ffff',
          borderRadius: '10px',
          boxShadow: '0 0 40px rgba(0, 255, 255, 0.3)'
        }}>
          <h1 style={{
            fontSize: '32px',
            marginBottom: '20px',
            color: '#ff00ff',
            textShadow: '0 0 10px rgba(255, 0, 255, 0.8)',
            letterSpacing: '2px'
          }}>
            CORPORATE CRAWLER BILL
          </h1>

          <p style={{ fontSize: '10px', marginBottom: '30px', color: '#00ffff' }}>
            Defeat the Critical Priority 1 Outage
          </p>

          <input
            id="playerName"
            name="playerName"
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '14px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#0a0a0a',
              border: '2px solid #00ffff',
              color: '#00ffff',
              marginBottom: '20px',
              borderRadius: '5px',
              outline: 'none'
            }}
            onKeyPress={(e) => e.key === 'Enter' && createRoom()}
          />

          <button
            onClick={createRoom}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '14px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#ff00ff',
              color: '#ffffff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginBottom: '15px',
              transition: 'all 0.2s',
              boxShadow: '0 0 20px rgba(255, 0, 255, 0.5)'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#ff33ff';
              e.target.style.boxShadow = '0 0 30px rgba(255, 0, 255, 0.8)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#ff00ff';
              e.target.style.boxShadow = '0 0 20px rgba(255, 0, 255, 0.5)';
            }}
          >
            CREATE ROOM
          </button>

          <button
            onClick={() => {
              setScreen('lobby');
              fetchRooms();
            }}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '14px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#00ffff',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#33ffff';
              e.target.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.8)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#00ffff';
              e.target.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.5)';
            }}
          >
            JOIN ROOM
          </button>
        </div>
      )}

      {screen === 'lobby' && (
        <div style={{
          textAlign: 'center',
          maxWidth: '700px',
          width: '90%',
          padding: '40px',
          background: 'rgba(26, 26, 46, 0.8)',
          border: '3px solid #00ffff',
          borderRadius: '10px',
          boxShadow: '0 0 40px rgba(0, 255, 255, 0.3)'
        }}>
          <h2 style={{
            fontSize: '24px',
            marginBottom: '30px',
            color: '#ff00ff',
            textShadow: '0 0 10px rgba(255, 0, 255, 0.8)'
          }}>
            ACTIVE ROOMS
          </h2>

          {!playerName.trim() && (
            <input
              id="playerNameWarning"
              name="playerNameWarning"
              type="text"
              placeholder="Enter your name first"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              style={{
                width: '100%',
                padding: '15px',
                fontSize: '14px',
                fontFamily: '"Press Start 2P", monospace',
                background: '#0a0a0a',
                border: '2px solid #00ffff',
                color: '#00ffff',
                marginBottom: '20px',
                borderRadius: '5px',
                outline: 'none'
              }}
            />
          )}

          <div style={{ marginBottom: '20px', maxHeight: '400px', overflowY: 'auto' }}>
            {availableRooms.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#888' }}>No rooms available</p>
            ) : (
              availableRooms.map((room) => (
                <div
                  key={room.id}
                  style={{
                    background: '#1a1a2e',
                    padding: '20px',
                    marginBottom: '10px',
                    border: '2px solid #00ffff',
                    borderRadius: '5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '14px', color: '#00ffff', marginBottom: '5px' }}>
                      {room.name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#888' }}>
                      Players: {room.playerCount}/{room.maxPlayers} | ID: {room.id}
                    </div>
                  </div>
                  <button
                    onClick={() => joinRoom(room.id)}
                    disabled={room.playerCount >= room.maxPlayers}
                    style={{
                      padding: '10px 20px',
                      fontSize: '12px',
                      fontFamily: '"Press Start 2P", monospace',
                      background: room.playerCount >= room.maxPlayers ? '#444' : '#00ff00',
                      color: room.playerCount >= room.maxPlayers ? '#888' : '#0a0a0a',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: room.playerCount >= room.maxPlayers ? 'not-allowed' : 'pointer',
                      boxShadow: room.playerCount >= room.maxPlayers ? 'none' : '0 0 10px rgba(0, 255, 0, 0.5)'
                    }}
                  >
                    {room.playerCount >= room.maxPlayers ? 'FULL' : 'JOIN'}
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => fetchRooms()}
            style={{
              padding: '12px 30px',
              fontSize: '12px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#ffff00',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginRight: '10px',
              boxShadow: '0 0 10px rgba(255, 255, 0, 0.5)'
            }}
          >
            REFRESH
          </button>

          <button
            onClick={() => setScreen('menu')}
            style={{
              padding: '12px 30px',
              fontSize: '12px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#ff0066',
              color: '#ffffff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              boxShadow: '0 0 10px rgba(255, 0, 102, 0.5)'
            }}
          >
            BACK
          </button>
        </div>
      )}

      {screen === 'game' && gameState && (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Top HUD */}
          <div style={{
            padding: '15px 20px',
            background: 'rgba(10, 10, 10, 0.95)',
            borderBottom: '2px solid #00ffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px'
          }}>
            <div>
              <span style={{ color: '#00ffff', marginRight: '20px' }}>
                ZONE: {gameState.currentZone?.name || 'Unknown'}
              </span>
            </div>
            <div style={{ color: '#ff00ff' }}>
              PLAYERS: {gameState.players.length}/8
            </div>
          </div>

          {/* Canvas */}
          <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              style={{
                flex: 1,
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 160px)',
                margin: '0 auto',
                border: '3px solid #00ffff',
                boxShadow: '0 0 40px rgba(0, 255, 255, 0.3)',
                background: '#0a0a0a',
                display: 'block'
              }}
            />

            {/* Victory Screen */}
            {levelWon && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100
              }}>
                <div style={{
                  textAlign: 'center',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#00ff00'
                }}>
                  <h1 style={{ fontSize: '40px', marginBottom: '30px', textShadow: '0 0 20px #00ff00' }}>
                    VICTORY!
                  </h1>
                  <p style={{ fontSize: '18px', marginBottom: '20px', color: '#ffff00' }}>
                    You defeated the
                  </p>
                  <p style={{ fontSize: '18px', marginBottom: '40px', color: '#ff3366' }}>
                    Critical Priority 1 Outage!
                  </p>
                  <button
                    onClick={() => {
                      setLevelWon(false);
                      setScreen('menu');
                    }}
                    style={{
                      padding: '20px 40px',
                      fontSize: '16px',
                      fontFamily: '"Press Start 2P", monospace',
                      background: '#00ffff',
                      color: '#000000',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#33ffff';
                      e.target.style.boxShadow = '0 0 40px rgba(0, 255, 255, 0.8)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = '#00ffff';
                      e.target.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.5)';
                    }}
                  >
                    BACK TO MENU
                  </button>
                </div>
              </div>
            )}

            {/* Game Over Screen */}
            {gameState?.playerDead && !levelWon && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100
              }}>
                <div style={{
                  textAlign: 'center',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#ff3333'
                }}>
                  <h1 style={{ fontSize: '40px', marginBottom: '30px', textShadow: '0 0 20px #ff3333' }}>
                    GAME OVER
                  </h1>
                  <p style={{ fontSize: '18px', marginBottom: '40px', color: '#ffff00' }}>
                    You were defeated!
                  </p>
                  <button
                    onClick={() => {
                      socket.emit('playerContinue', { roomId });
                    }}
                    style={{
                      padding: '20px 40px',
                      fontSize: '16px',
                      fontFamily: '"Press Start 2P", monospace',
                      background: '#00ff00',
                      color: '#000000',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 0 20px rgba(0, 255, 0, 0.5)'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = '#33ff33';
                      e.target.style.boxShadow = '0 0 40px rgba(0, 255, 0, 0.8)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = '#00ff00';
                      e.target.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.5)';
                    }}
                  >
                    CONTINUE
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom HUD */}
          <div style={{
            padding: '15px',
            background: 'rgba(10, 10, 10, 0.95)',
            borderTop: '2px solid #00ffff',
            display: 'flex',
            justifyContent: 'center',
            gap: '20px',
            fontSize: '9px',
            flexWrap: 'wrap'
          }}>
            <span>A/D: LEFT/RIGHT</span>
            <span>W/S: UP/DOWN</span>
            <span>SPACE: JUMP</span>
            <span>J: PUNCH</span>
            <span>K: KICK</span>
            <span>L: SPECIAL</span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Draw a unit with 16-bit style sprite anatomy, animations, and effects
 */
function drawUnit(ctx, unit, cameraX, groundLevel, isMe, now) {
  if (!unit) return;

  const screenX = unit.x - cameraX;
  const screenY = unit.y;

  // Only draw if on screen (with margin)
  if (screenX + unit.width < -20 || screenX > ctx.canvas.width + 20) return;

  const w = unit.width;
  const h = unit.height;
  const cx = screenX + w / 2; // center X
  const facing = unit.direction || 1;

  // Walking bob animation based on horizontal velocity
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  const bobAmount = isMoving ? Math.sin(now / 80) * 2 : 0;

  // Hit flash effect (within 150ms of being hit)
  const hitFlash = unit.lastHitTime && (now - unit.lastHitTime) < 150;
  const flashAlpha = hitFlash ? 1 - ((now - unit.lastHitTime) / 150) : 0;

  // Y-axis depth: smaller shadow when higher up
  const heightFromGround = Math.max(0, groundLevel - screenY);
  const shadowScale = Math.max(0.5, 1 - heightFromGround / 200);

  // Drop shadow (scales with height for depth)
  ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(cx, groundLevel + 5, (w / 2) * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Skip drawing body if knocked out (fall over animation)
  const koTilt = unit.isKnockedOut ? Math.PI / 2 : 0;

  ctx.save();
  ctx.translate(cx, screenY + h / 2 + bobAmount);
  ctx.rotate(koTilt * facing);

  // Player glow effect
  if (isMe && !unit.isKnockedOut) {
    ctx.shadowColor = unit.color || '#00ffff';
    ctx.shadowBlur = 15;
  }

  // === BODY (torso) ===
  const bodyColor = unit.color || '#888888';
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-w / 2, -h / 4, w, h / 2);

  // Body outline for definition
  ctx.strokeStyle = darkenColor(bodyColor, 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 4, w, h / 2);

  // === HEAD ===
  const headSize = w * 0.75;
  ctx.fillStyle = lightenColor(bodyColor, 0.2);
  ctx.fillRect(-headSize / 2, -h / 2, headSize, h / 4);
  ctx.strokeRect(-headSize / 2, -h / 2, headSize, h / 4);

  // === EYES ===
  ctx.fillStyle = '#ffffff';
  const eyeY = -h / 2 + 5;
  const eyeSpacing = 8;
  if (facing > 0) {
    ctx.fillRect(-eyeSpacing / 2 - 3, eyeY, 4, 4);
    ctx.fillRect(eyeSpacing / 2 - 1, eyeY, 4, 4);
    // Pupils
    ctx.fillStyle = '#000000';
    ctx.fillRect(-eyeSpacing / 2 - 1, eyeY + 1, 2, 2);
    ctx.fillRect(eyeSpacing / 2 + 1, eyeY + 1, 2, 2);
  } else {
    ctx.fillRect(-eyeSpacing / 2 - 3, eyeY, 4, 4);
    ctx.fillRect(eyeSpacing / 2 - 1, eyeY, 4, 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(-eyeSpacing / 2 - 3, eyeY + 1, 2, 2);
    ctx.fillRect(eyeSpacing / 2 - 1, eyeY + 1, 2, 2);
  }

  // === ARMS ===
  const armColor = darkenColor(bodyColor, 0.85);
  ctx.fillStyle = armColor;
  const armSwing = isMoving ? Math.sin(now / 80) * 4 : 0;

  // If attacking, position arm forward
  if (unit.isAttacking) {
    // Punching/attacking arm extends forward
    const armLength = unit.attackType === 'kick' ? 0 : (unit.attackType === 'special' ? 16 : 12);
    ctx.fillRect(facing > 0 ? w / 2 : -w / 2 - armLength,
      -h / 6, armLength, h / 6);
    // Back arm
    ctx.fillRect(facing > 0 ? -w / 2 - 4 : w / 2, -h / 6 + 2, 4, h / 6);
  } else {
    // Idle/walking arms
    ctx.fillRect(-w / 2 - 4, -h / 6 + armSwing, 4, h / 6);
    ctx.fillRect(w / 2, -h / 6 - armSwing, 4, h / 6);
  }

  // === LEGS ===
  const legColor = darkenColor(bodyColor, 0.7);
  ctx.fillStyle = legColor;
  const legW = w * 0.35;
  const legH = h * 0.25;
  const legSwing = isMoving ? Math.sin(now / 80) * 3 : 0;

  // If kicking, extend leg forward
  if (unit.isAttacking && unit.attackType === 'kick') {
    const kickLength = 20;
    ctx.fillRect(facing > 0 ? w / 2 - 2 : -w / 2 - kickLength + 2,
      h / 4 + 5, kickLength, legH * 0.6);
    ctx.fillRect(-legW / 2, h / 4, legW, legH);
  } else {
    ctx.fillRect(-w / 2 + 2, h / 4 - legSwing, legW, legH + legSwing);
    ctx.fillRect(w / 2 - legW - 2, h / 4 + legSwing, legW, legH - legSwing);
  }

  ctx.shadowBlur = 0;

  // === HIT FLASH (white overlay) ===
  if (hitFlash) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    ctx.fillRect(-w / 2 - 5, -h / 2 - 2, w + 10, h + 5);
  }

  ctx.restore();

  // === ATTACK EFFECTS (in world space, not rotated) ===
  if (unit.isAttacking) {
    drawAttackEffect(ctx, unit, screenX, screenY, facing, now);
  }

  // === HEALTH BAR ===
  if (!unit.isKnockedOut) {
    const barWidth = w;
    const barHeight = 4;
    const barX = screenX;
    const barY = screenY - 12;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    // Fill
    const healthPercent = unit.health / unit.maxHealth;
    ctx.fillStyle = healthPercent > 0.5 ? '#00ff66' : healthPercent > 0.25 ? '#ffcc00' : '#ff3333';
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  }

  // === NAME (only for player) ===
  if (isMe) {
    ctx.fillStyle = '#00ffff';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText('YOU', cx, screenY - 18);
    ctx.shadowBlur = 0;
  }

  // === K.O. INDICATOR ===
  if (unit.isKnockedOut) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.font = 'bold 12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText('K.O.', cx, screenY + h / 2);
    ctx.shadowBlur = 0;
  }
}

/**
 * Draw attack effect (different per attack type)
 */
function drawAttackEffect(ctx, unit, screenX, screenY, facing, now) {
  const cx = screenX + unit.width / 2;
  const attackProgress = Math.min(1, ((now - unit.attackStartTime) || 0) / (unit.attackDuration || 300));
  const attackOpacity = Math.sin(attackProgress * Math.PI); // Fade in/out

  if (unit.attackType === 'special') {
    // Large ring expanding outward
    const radius = 30 + attackProgress * 90;
    ctx.strokeStyle = `rgba(255, 0, 255, ${attackOpacity * 0.8})`;
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff00ff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(cx, screenY + unit.height / 2, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = `rgba(255, 255, 255, ${attackOpacity})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, screenY + unit.height / 2, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
  } else if (unit.attackType === 'kick') {
    // Arc swoosh
    const swooshX = cx + facing * 40;
    const swooshY = screenY + unit.height / 2;
    ctx.strokeStyle = `rgba(255, 200, 0, ${attackOpacity * 0.9})`;
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(swooshX, swooshY, 35, facing > 0 ? -Math.PI / 3 : Math.PI - Math.PI / 3,
      facing > 0 ? Math.PI / 3 : Math.PI + Math.PI / 3);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    // Punch: quick impact star
    const punchX = cx + facing * 35;
    const punchY = screenY + unit.height / 3;
    ctx.fillStyle = `rgba(255, 255, 255, ${attackOpacity})`;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    // Draw a 4-pointed star
    const spikeLen = 8 + attackProgress * 6;
    ctx.beginPath();
    ctx.moveTo(punchX, punchY - spikeLen);
    ctx.lineTo(punchX + 3, punchY - 3);
    ctx.lineTo(punchX + spikeLen, punchY);
    ctx.lineTo(punchX + 3, punchY + 3);
    ctx.lineTo(punchX, punchY + spikeLen);
    ctx.lineTo(punchX - 3, punchY + 3);
    ctx.lineTo(punchX - spikeLen, punchY);
    ctx.lineTo(punchX - 3, punchY - 3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * Update and draw floating damage numbers
 */
function updateAndDrawDamageNumbers(ctx, numbers, cameraX) {
  const now = Date.now();
  const LIFETIME = 800;

  for (let i = numbers.length - 1; i >= 0; i--) {
    const dn = numbers[i];
    const age = now - dn.spawnTime;
    if (age > LIFETIME) {
      numbers.splice(i, 1);
      continue;
    }

    // Rise and fade
    const progress = age / LIFETIME;
    const yOffset = -progress * 40;
    const alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
    const screenX = dn.x - cameraX;
    const screenY = dn.y + yOffset;

    // Scale up briefly at start
    const scale = age < 100 ? 0.5 + (age / 100) * 0.5 : 1;
    const fontSize = (dn.isCritical ? 18 : 14) * scale;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${fontSize}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;

    // Outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(`${dn.value}`, screenX, screenY);

    // Fill
    ctx.fillStyle = dn.color;
    ctx.fillText(`${dn.value}`, screenX, screenY);

    ctx.restore();
  }
}

/**
 * Update and draw hit particles
 */
function updateAndDrawParticles(ctx, particles, cameraX) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.3; // gravity
    p.life -= 0.04;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const screenX = p.x - cameraX;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillRect(screenX - 2, p.y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }
}

/**
 * Draw "advance right" indicator when section is clear
 */
function drawAdvanceIndicator(ctx, now, canvasWidth) {
  const pulse = (Math.sin(now / 200) + 1) / 2; // 0 to 1
  const alpha = 0.4 + pulse * 0.4;

  ctx.save();
  ctx.fillStyle = `rgba(0, 255, 102, ${alpha})`;
  ctx.font = 'bold 14px "Press Start 2P", monospace';
  ctx.textAlign = 'right';
  ctx.shadowColor = '#00ff66';
  ctx.shadowBlur = 10;

  const text = 'CLEAR! → →';
  const x = canvasWidth - 30 + pulse * 8;
  ctx.fillText(text, x, 70);

  // Arrow icon
  const arrowY = 90;
  const arrowX = canvasWidth - 80 + pulse * 12;
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX + 20, arrowY + 10);
  ctx.lineTo(arrowX, arrowY + 20);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Helper: darken a hex color
 */
function darkenColor(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.floor(parseInt(c.substring(0, 2), 16) * amount);
  const g = Math.floor(parseInt(c.substring(2, 4), 16) * amount);
  const b = Math.floor(parseInt(c.substring(4, 6), 16) * amount);
  return `rgb(${r},${g},${b})`;
}

/**
 * Helper: lighten a hex color
 */
function lightenColor(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.min(255, Math.floor(parseInt(c.substring(0, 2), 16) + 255 * amount));
  const g = Math.min(255, Math.floor(parseInt(c.substring(2, 4), 16) + 255 * amount));
  const b = Math.min(255, Math.floor(parseInt(c.substring(4, 6), 16) + 255 * amount));
  return `rgb(${r},${g},${b})`;
}

/**
 * Draw the boss with prominent health bar
 */
function drawBoss(ctx, boss, cameraX, groundLevel, now) {
  if (!boss) return;

  const screenX = boss.x - cameraX;
  const screenY = boss.y;

  // Only draw if on screen
  if (screenX + boss.width < 0 || screenX > ctx.canvas.width) return;

  // Glow effect
  ctx.shadowColor = '#ff00ff';
  ctx.shadowBlur = 30;

  // Body (larger)
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(screenX - 20, screenY - 20, boss.width + 40, boss.height + 40);

  ctx.shadowBlur = 0;

  // Boss health bar (prominent, at top)
  const bossBarWidth = 200;
  const bossBarHeight = 20;
  const bossBarX = ctx.canvas.width / 2 - bossBarWidth / 2;
  const bossBarY = 30;

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(bossBarX, bossBarY, bossBarWidth, bossBarHeight);

  // Health fill
  const healthPercent = boss.health / boss.maxHealth;
  if (healthPercent > 0.5) ctx.fillStyle = '#ff3366';
  else if (healthPercent > 0.25) ctx.fillStyle = '#ffff00';
  else ctx.fillStyle = '#ff0000';

  ctx.fillRect(bossBarX, bossBarY, bossBarWidth * healthPercent, bossBarHeight);

  // Border
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(bossBarX, bossBarY, bossBarWidth, bossBarHeight);

  // Label
  ctx.fillStyle = '#ff00ff';
  ctx.font = 'bold 12px "Press Start 2P", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('BOSS', bossBarX + 10, bossBarY + 15);

  // Health text
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px "Press Start 2P", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(boss.health)}/${Math.round(boss.maxHealth)}`, bossBarX + bossBarWidth - 10, bossBarY + 15);

  // Draw attack telegrams
  if (boss.currentAttack) {
    if (boss.currentAttack.isInTelegram) {
      ctx.fillStyle = 'rgba(255, 0, 102, 0.3)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      ctx.fillStyle = '#ff0066';
      ctx.font = 'bold 16px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${boss.currentAttack.name} INCOMING!`, ctx.canvas.width / 2, 100);
    }

    // Draw attack zones for ServiceRestarts pattern
    if (boss.currentAttack.type === 'zones' && boss.attackZones) {
      boss.attackZones.forEach(zone => {
        const zoneScreenX = zone.x - cameraX;
        ctx.strokeStyle = zone.hasDetonated ? '#ff0000' : '#ff9900';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zoneScreenX, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();

        if (!zone.hasDetonated) {
          ctx.fillStyle = 'rgba(255, 153, 0, 0.2)';
          ctx.fill();
        }
      });
    }
  }
}

/**
 * Draw parallax scrolling 16-bit campus background
 */
function drawParallaxBackground(ctx, zoneIndex, cameraX, worldWidth, worldHeight) {
  // Sky gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, worldHeight);
  gradient.addColorStop(0, '#1a3a5c'); // Dark blue top
  gradient.addColorStop(0.5, '#3a6a9c'); // Medium blue
  gradient.addColorStop(1, '#5a9acc'); // Light blue bottom
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, worldWidth, worldHeight);

  // Get zone-specific colors
  const zoneColors = {
    0: { sky: '#1a3a5c', building: '#4a6a8a', accent: '#ff9900' }, // Parking Lot
    1: { sky: '#2a4a6c', building: '#3a7a4a', accent: '#33ff66' }, // Quad
    2: { sky: '#3a3a6c', building: '#5a5a8a', accent: '#3366ff' }, // Lobby
    3: { sky: '#1a1a3c', building: '#4a3a6a', accent: '#ff3366' }  // Elevators
  };
  const colors = zoneColors[zoneIndex] || zoneColors[0];

  // Layer 1: Distant mountains/sky (slowest - 0.2x)
  drawDistantMountains(ctx, cameraX * 0.2, worldWidth, worldHeight, colors);

  // Layer 2: Background buildings (0.4x parallax)
  drawBackgroundBuildings(ctx, cameraX * 0.4, worldWidth, worldHeight, colors);

  // Layer 3: Mid-ground structures (0.6x parallax)
  drawMidgroundElements(ctx, cameraX * 0.6, worldWidth, worldHeight, zoneIndex, colors);

  // Layer 4: Trees and decorations (0.8x parallax)
  drawForegroundTrees(ctx, cameraX * 0.8, worldWidth, worldHeight, colors);

  // Layer 5: Ground details (1.0x - moves with camera)
  drawGroundDetails(ctx, cameraX, worldWidth, worldHeight, zoneIndex);
}

/**
 * Draw distant mountains/clouds
 */
function drawDistantMountains(ctx, scrollX, worldWidth, worldHeight, colors) {
  ctx.fillStyle = 'rgba(100, 140, 180, 0.3)';

  // Draw clouds
  for (let i = -1; i < worldWidth / 200; i++) {
    const x = (i * 200 - scrollX) % (worldWidth + 400);
    // Cloud shape made of rectangles
    ctx.fillRect(x, 50, 80, 30);
    ctx.fillRect(x + 30, 30, 80, 30);
    ctx.fillRect(x + 60, 50, 80, 30);
  }
}

/**
 * Draw background tall buildings
 */
function drawBackgroundBuildings(ctx, scrollX, worldWidth, worldHeight, colors) {
  ctx.fillStyle = colors.building;

  // Distant office building towers
  for (let i = -1; i < worldWidth / 300; i++) {
    const x = (i * 300 - scrollX) % (worldWidth + 400);

    // Main building
    ctx.fillRect(x, 150, 80, 300);

    // Windows
    ctx.fillStyle = '#ffff99';
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.fillRect(x + 10 + col * 20, 160 + row * 20, 12, 12);
      }
    }

    // Roof
    ctx.fillStyle = '#333333';
    ctx.fillRect(x, 140, 80, 10);

    // Return to building color
    ctx.fillStyle = colors.building;
  }
}

/**
 * Draw mid-ground elements (buildings, server racks)
 */
function drawMidgroundElements(ctx, scrollX, worldWidth, worldHeight, zoneIndex, colors) {
  if (zoneIndex === 0) {
    // Parking Lot - cars and parking structures
    ctx.fillStyle = '#cc4444';
    for (let i = -1; i < worldWidth / 250; i++) {
      const x = (i * 250 - scrollX) % (worldWidth + 400);
      // Parked car
      ctx.fillRect(x, 450, 60, 40);
      ctx.fillRect(x + 15, 430, 20, 20); // Window
    }
  } else if (zoneIndex === 1) {
    // Quad - benches and pavilion
    ctx.fillStyle = '#8B4513';
    for (let i = -1; i < worldWidth / 300; i++) {
      const x = (i * 300 - scrollX) % (worldWidth + 400);
      ctx.fillRect(x, 520, 80, 20); // Bench
      ctx.fillRect(x + 35, 480, 10, 40); // Bench support
    }
  } else if (zoneIndex === 2) {
    // Lobby - entrance structure
    ctx.fillStyle = '#5a5a7a';
    for (let i = -1; i < worldWidth / 350; i++) {
      const x = (i * 350 - scrollX) % (worldWidth + 400);
      ctx.fillRect(x, 400, 100, 200); // Lobby building
      ctx.fillRect(x + 20, 420, 30, 40); // Door
      ctx.fillRect(x + 60, 420, 30, 40); // Door
    }
  } else if (zoneIndex === 3) {
    // Elevators - server racks and tech
    ctx.fillStyle = '#3a3a5a';
    for (let i = -1; i < worldWidth / 200; i++) {
      const x = (i * 200 - scrollX) % (worldWidth + 400);
      // Server rack
      ctx.fillRect(x, 480, 40, 120);
      ctx.fillStyle = '#ff0000';
      for (let j = 0; j < 6; j++) {
        ctx.fillRect(x + 5, 490 + j * 18, 30, 8);
      }
      ctx.fillStyle = '#3a3a5a';
    }
  }
}

/**
 * Draw foreground trees and obstacles
 */
function drawForegroundTrees(ctx, scrollX, worldWidth, worldHeight, colors) {
  ctx.fillStyle = '#2a5a2a';

  // Trees
  for (let i = -1; i < worldWidth / 200; i++) {
    const x = (i * 200 - scrollX) % (worldWidth + 400);

    // Trunk
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + 15, 480, 20, 60);

    // Foliage - blocky tree shape
    ctx.fillStyle = '#2a7a2a';
    ctx.fillRect(x, 420, 50, 50); // Bottom
    ctx.fillRect(x + 5, 380, 40, 40); // Middle
    ctx.fillRect(x + 10, 350, 30, 30); // Top
  }
}

/**
 * Draw ground-level details
 */
function drawGroundDetails(ctx, cameraX, worldWidth, worldHeight, zoneIndex) {
  if (zoneIndex === 0) {
    // Parking Lot - road markings
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 4;
    for (let i = -1; i < worldWidth / 100; i++) {
      const x = i * 100 - (cameraX % 100);
      ctx.beginPath();
      ctx.moveTo(x, worldHeight - 50);
      ctx.lineTo(x + 40, worldHeight - 50);
      ctx.stroke();
    }
  } else if (zoneIndex === 1) {
    // Quad - grass pattern
    ctx.fillStyle = 'rgba(100, 180, 100, 0.3)';
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 10; j++) {
        const x = (i * 100 - (cameraX % 100)) % worldWidth;
        const y = 550 + j * 30;
        if (Math.random() > 0.7) {
          ctx.fillRect(x, y, 20, 20);
        }
      }
    }
  } else if (zoneIndex === 2) {
    // Lobby - tile pattern
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.lineWidth = 2;
    for (let i = -1; i < worldWidth / 50; i++) {
      const x = i * 50 - (cameraX % 50);
      ctx.beginPath();
      ctx.moveTo(x, 580);
      ctx.lineTo(x, 620);
      ctx.stroke();
    }
  } else if (zoneIndex === 3) {
    // Elevators - metal floor grating
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.5)';
    ctx.lineWidth = 1;
    for (let i = -1; i < worldWidth / 30; i++) {
      const x = i * 30 - (cameraX % 30);
      for (let j = 580; j < 620; j += 15) {
        ctx.beginPath();
        ctx.moveTo(x, j);
        ctx.lineTo(x + 15, j);
        ctx.stroke();
      }
    }
  }
}

/**
 * Draw zone-specific background (OLD - kept for compatibility)
 */
/**
 * Draw HUD overlay
 */
function drawHUD(ctx, gameState, playerId, canvasWidth) {
  // Current player info
  if (!gameState || !gameState.players || gameState.players.length === 0) return;

  const thisPlayer = gameState.players.find(p => p.id === playerId);
  if (thisPlayer && thisPlayer.attributes && thisPlayer.attributes.length > 0) {
    ctx.fillStyle = '#00ffff';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.textAlign = 'left';

    let y = 20;
    ctx.fillText('YOUR ATTRIBUTES:', 10, y);
    y += 12;

    thisPlayer.attributes.forEach(attr => {
      ctx.fillStyle = '#ffff00';
      ctx.fillText(`• ${attr.name}`, 15, y);
      y += 11;
    });
  }

  // Kill counter (top right - PROMINENT) - Show progress to boss (30 kills)
  if (gameState.debug) {
    const targetKills = 30; // Total enemies before boss
    const killsRemaining = Math.max(0, targetKills - gameState.debug.totalKills);
    ctx.fillStyle = killsRemaining === 0 ? '#00ff00' : '#ff3333';
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`KILLS: ${gameState.debug.totalKills}/${targetKills}`, canvasWidth - 10, 30);

    // Show progress text if not all enemies defeated
    if (killsRemaining > 0) {
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 10px "Press Start 2P", monospace';
      ctx.fillText(`${killsRemaining} to boss`, canvasWidth - 10, 45);
    } else {
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 10px "Press Start 2P", monospace';
      ctx.fillText(`BOSS UNLOCKED!`, canvasWidth - 10, 45);
    }

    // Section/spawn info
    ctx.fillStyle = '#ffff00';
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    let debugY = ctx.canvas.height - 72;
    ctx.fillText(`SPAWNED: ${gameState.debug.enemiesSpawned}`, 10, debugY);
    ctx.fillText(`ALIVE: ${gameState.debug.enemyCount}`, 10, debugY + 12);
    ctx.fillText(`SECTION: ${gameState.debug.currentSectionIndex}`, 10, debugY + 24);
    ctx.fillText(`CLEAR: ${gameState.debug.sectionClear ? 'YES' : 'NO'}`, 10, debugY + 36);
    ctx.fillText(`X POS: ${Math.floor(gameState.debug.playerX)}/${gameState.debug.maxX}`, 10, debugY + 48);
  }
}

/**
 * Error Boundary to catch render errors and prevent full app crashes
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Game error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100vw',
          height: '100vh',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
          color: '#ff3333',
          fontFamily: '"Press Start 2P", monospace',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '32px', marginBottom: '20px', textShadow: '0 0 10px #ff3333' }}>
            CRITICAL ERROR
          </h1>
          <p style={{ fontSize: '12px', marginBottom: '30px', color: '#ffff00' }}>
            The game encountered an error.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '15px 30px',
              fontSize: '14px',
              fontFamily: '"Press Start 2P", monospace',
              background: '#00ff00',
              color: '#000',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(0, 255, 0, 0.5)'
            }}
          >
            RESTART
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap the main component in error boundary
const AppWithErrorBoundary = () => (
  <ErrorBoundary>
    <BeatEmUpGame />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
