import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

// SERVER CONFIG - Update this after deploying to Railway
const SERVER_URL = 'https://corporatecrawlerbill-production.up.railway.app';

const BeatEmUpGame = () => {
  const [screen, setScreen] = useState('menu'); // menu, lobby, game
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [error, setError] = useState('');
  
  const canvasRef = useRef(null);
  const keysPressed = useRef({});
  const animationFrameRef = useRef(null);

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
      // Visual/audio feedback for hits
      console.log(`Player ${attackerId} hit ${targetId} for ${damage} damage`);
    });

    newSocket.on('playerKnockedOut', ({ playerId: pid, knockedOutBy }) => {
      console.log(`Player ${pid} knocked out by ${knockedOutBy}`);
    });

    newSocket.on('gameStarted', () => {
      console.log('Game started!');
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
      
      // Prevent default for game keys
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
        jump: keysPressed.current['w'] || keysPressed.current['arrowup'] || keysPressed.current[' ']
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
    }, 16); // ~60 FPS

    return () => clearInterval(inputInterval);
  }, [socket, screen, roomId]);

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

      // Draw background grid
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

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

      // Draw players
      gameState.players.forEach((player) => {
        const isMe = player.id === playerId;

        // Player shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(
          player.x + player.width / 2,
          gameState.groundLevel + 5,
          player.width / 2,
          8,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Player body
        ctx.fillStyle = player.color;
        if (isMe) {
          ctx.shadowColor = player.color;
          ctx.shadowBlur = 20;
        }
        
        // Draw rectangle for player
        ctx.fillRect(player.x, player.y, player.width, player.height);
        
        ctx.shadowBlur = 0;

        // Draw direction indicator
        ctx.fillStyle = '#ffffff';
        const eyeX = player.direction > 0 ? player.x + player.width - 10 : player.x + 5;
        ctx.fillRect(eyeX, player.y + 15, 5, 5);

        // Attack visual
        if (player.isAttacking) {
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#ff00ff';
          ctx.shadowBlur = 10;
          
          const attackX = player.direction > 0 ? player.x + player.width : player.x;
          ctx.beginPath();
          ctx.arc(attackX + (player.direction * 40), player.y + 30, 25, 0, Math.PI * 2);
          ctx.stroke();
          
          ctx.shadowBlur = 0;
        }

        // Health bar
        const barWidth = player.width;
        const barHeight = 6;
        const barX = player.x;
        const barY = player.y - 15;
        
        // Health bar background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Health bar fill
        const healthPercent = player.health / player.maxHealth;
        ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
        ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
        
        // Health bar border
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // Player name
        ctx.fillStyle = isMe ? '#00ffff' : '#ffffff';
        ctx.font = '12px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x + player.width / 2, barY - 5);

        // Knocked out indicator
        if (player.isKnockedOut) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
          ctx.font = 'bold 16px "Press Start 2P", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('K.O.', player.x + player.width / 2, player.y + player.height / 2);
        }
      });

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState, screen, playerId]);

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
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    const roomName = `${playerName}'s Game`;
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
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
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
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
      {/* Import retro font */}
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
            STREET BRAWL
          </h1>
          
          <p style={{ fontSize: '10px', marginBottom: '30px', color: '#00ffff' }}>
            Multiplayer Beat'em Up
          </p>

          <input
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

      {screen === 'game' && (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* HUD */}
          <div style={{
            padding: '20px',
            background: 'rgba(10, 10, 10, 0.9)',
            borderBottom: '2px solid #00ffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <span style={{ fontSize: '12px', color: '#00ffff' }}>ROOM: {roomId}</span>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#ff00ff' }}>
                PLAYERS: {gameState?.players.length || 0}/8
              </span>
            </div>
          </div>

          {/* Game Canvas */}
          <canvas
            ref={canvasRef}
            width={1200}
            height={500}
            style={{
              flex: 1,
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 180px)',
              margin: '0 auto',
              border: '3px solid #00ffff',
              boxShadow: '0 0 40px rgba(0, 255, 255, 0.3)',
              background: '#0a0a0a'
            }}
          />

          {/* Controls */}
          <div style={{
            padding: '15px',
            background: 'rgba(10, 10, 10, 0.9)',
            borderTop: '2px solid #00ffff',
            display: 'flex',
            justifyContent: 'center',
            gap: '30px',
            fontSize: '10px'
          }}>
            <span>MOVE: A/D or ← →</span>
            <span>JUMP: W/SPACE or ↑</span>
            <span>PUNCH: J</span>
            <span>KICK: K</span>
            <span>SPECIAL: L</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BeatEmUpGame;
