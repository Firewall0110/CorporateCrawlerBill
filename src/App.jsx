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

  const canvasRef = useRef(null);
  const keysPressed = useRef({});
  const animationFrameRef = useRef(null);

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
      setScreen('game');
    });

    newSocket.on('roomJoined', ({ roomId: id, playerId: pid, gameState: gs }) => {
      setRoomId(id);
      setPlayerId(pid);
      setGameState(gs);
      setScreen('game');
    });

    newSocket.on('playerJoined', ({ player }) => {
      console.log('Player joined:', player.name);
    });

    newSocket.on('playerLeft', ({ playerId: pid }) => {
      console.log('Player left:', pid);
    });

    newSocket.on('playerHit', ({ attackerId, targetId, damage }) => {
      console.log(`Hit for ${damage} damage`);
    });

    newSocket.on('playerKnockedOut', ({ playerId: pid, knockedOutBy }) => {
      console.log(`Player ${pid} knocked out`);
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

      if (['a', 'd', 'w', 's', ' ', 'j', 'k', 'l'].includes(e.key.toLowerCase())) {
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
  }, []);

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
      // Clear canvas
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw zone background based on current zone
      drawZoneBackground(ctx, gameState.currentZoneIndex, gameState.worldWidth);

      // Draw ground
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, gameState.groundLevel, canvas.width, canvas.height - gameState.groundLevel);

      // Draw ground line
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, gameState.groundLevel);
      ctx.lineTo(canvas.width, gameState.groundLevel);
      ctx.stroke();

      // Draw all enemies with health bars
      if (gameState.enemies && gameState.enemies.length > 0) {
        gameState.enemies.forEach(enemy => {
          drawUnit(ctx, enemy, cameraX, gameState.groundLevel, false);
        });
      }

      // Draw boss if exists
      if (gameState.boss) {
        drawBoss(ctx, gameState.boss, cameraX, gameState.groundLevel);
      }

      // Draw all players
      if (gameState.players && gameState.players.length > 0) {
        gameState.players.forEach(player => {
          const isMe = player.id === playerId;
          drawUnit(ctx, player, cameraX, gameState.groundLevel, isMe);
        });
      }

      // Draw HUD
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

            {/* Game Over Screen */}
            {gameState?.playerDead && (
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
 * Draw a unit (player or enemy)
 */
function drawUnit(ctx, unit, cameraX, groundLevel, isMe) {
  if (!unit) return;

  const screenX = unit.x - cameraX;
  const screenY = unit.y;

  // Only draw if on screen
  if (screenX + unit.width < 0 || screenX > ctx.canvas.width) return;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(screenX + unit.width / 2, groundLevel + 5, unit.width / 2, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = unit.color || '#888888';
  if (isMe) {
    ctx.shadowColor = unit.color;
    ctx.shadowBlur = 20;
  }
  ctx.fillRect(screenX, screenY, unit.width, unit.height);
  ctx.shadowBlur = 0;

  // Direction indicator
  ctx.fillStyle = '#ffffff';
  const eyeX = unit.direction > 0 ? screenX + unit.width - 10 : screenX + 5;
  ctx.fillRect(eyeX, screenY + 15, 5, 5);

  // Attack effect
  if (unit.isAttacking) {
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff00ff';
    ctx.shadowBlur = 10;
    const attackX = unit.direction > 0 ? screenX + unit.width : screenX;
    ctx.beginPath();
    ctx.arc(attackX + unit.direction * 40, screenY + 30, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Health bar
  const barWidth = unit.width;
  const barHeight = 6;
  const barX = screenX;
  const barY = screenY - 15;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const healthPercent = unit.health / unit.maxHealth;
  ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
  ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  // Name
  ctx.fillStyle = isMe ? '#00ffff' : '#ffffff';
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(unit.name.substring(0, 10), screenX + unit.width / 2, barY - 5);

  // Knocked out
  if (unit.isKnockedOut) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('K.O.', screenX + unit.width / 2, screenY + unit.height / 2);
  }
}

/**
 * Draw the boss with prominent health bar
 */
function drawBoss(ctx, boss, cameraX, groundLevel) {
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
 * Draw zone-specific background
 */
function drawZoneBackground(ctx, zoneIndex, worldWidth) {
  ctx.fillStyle = '#0a0a0a';

  switch (zoneIndex) {
    case 0: // Parking Lot
      ctx.fillStyle = '#4a4a5a';
      // Yellow parking lines
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      for (let i = 0; i < worldWidth; i += 200) {
        ctx.beginPath();
        ctx.moveTo(i, 200);
        ctx.lineTo(i + 100, 200);
        ctx.stroke();
      }
      break;
    case 1: // Quad
      ctx.fillStyle = '#2d5a2d';
      // Trees
      ctx.fillStyle = '#1a3a1a';
      for (let i = 100; i < worldWidth; i += 400) {
        ctx.fillRect(i, 250, 60, 100);
      }
      ctx.fillStyle = '#2d5a2d';
      break;
    case 2: // Lobby
      ctx.fillStyle = '#5a5a6a';
      // Reception desk silhouette
      ctx.fillStyle = '#3a3a4a';
      ctx.fillRect(500, 200, 300, 150);
      ctx.fillStyle = '#5a5a6a';
      break;
    case 3: // Elevators
      ctx.fillStyle = '#4a4a5a';
      // Elevator doors
      ctx.fillStyle = '#888888';
      ctx.fillRect(500, 200, 100, 150);
      ctx.fillRect(650, 200, 100, 150);
      ctx.fillStyle = '#4a4a5a';
      break;
    default:
      // Default background for unknown zones
      ctx.fillStyle = '#0a0a0a';
      break;
  }

  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

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

  // Kill counter (top right - PROMINENT)
  if (gameState.debug) {
    ctx.fillStyle = '#ff3333';
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`KILLS: ${gameState.debug.totalKills}`, canvasWidth - 10, 30);

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

export default BeatEmUpGame;
