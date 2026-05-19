import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getTileset } from './Tileset';
import { loadBillSprites, getBillSprites, pickBillFrame } from './SpriteLoader';
import { loadTicketSprites, getTicketSprites, pickTicketFrame } from './TicketSprites';
import { loadBossSprites, getBossSprites, pickBossFrame, loadBossDeathSprites, pickBossDeathFrame } from './BossSprites';

// SERVER CONFIG - Use relative URL so it works both locally and on Railway
const SERVER_URL = window.location.origin;

// Client-side attack cooldown durations (ms) for mobile button visuals.
// Must roughly match server-side Unit.attackCooldown for each attackType.
const COOLDOWN_MS = { punch: 300, kick: 600, special: 5000 };

/**
 * Action button with cooldown sweep overlay.
 * The overlay is a conic-gradient that goes from full coverage (just-pressed)
 * to no coverage (cooldown finished), creating a clockwise "fill" indicator.
 */
const ActionButton = ({
  cooldownKey, // 'punch' | 'kick' | 'special' | null (no cooldown)
  cooldownsRef,
  pressHandlers,
  style,
  label
}) => {
  // Read cooldown from ref. We rely on parent's rAF loop to re-render.
  const cd = cooldownKey ? cooldownsRef?.current?.[cooldownKey] : null;
  const now = Date.now();
  let progress = 1; // 1 = ready, 0 = just-pressed
  if (cd && cd.end > now && cd.end > cd.start) {
    progress = (now - cd.start) / (cd.end - cd.start);
    progress = Math.max(0, Math.min(1, progress));
  }
  const onCooldown = progress < 1;
  // Format remaining seconds for special button
  const remainingSec = onCooldown ? Math.ceil((cd.end - now) / 1000) : 0;

  return (
    <div
      {...pressHandlers}
      style={{
        ...style,
        position: 'absolute',
        overflow: 'hidden',
        opacity: onCooldown ? 0.6 : 1
      }}
    >
      {/* Cooldown sweep overlay (conic gradient) */}
      {onCooldown && (
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(rgba(0,0,0,0.65) ${progress * 360}deg, transparent ${progress * 360}deg)`,
          pointerEvents: 'none'
        }} />
      )}
      {/* Button label (and remaining time for long cooldowns) */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        <span>{label}</span>
        {cooldownKey === 'special' && onCooldown && (
          <span style={{ fontSize: '11px', marginTop: '2px' }}>{remainingSec}s</span>
        )}
      </div>
    </div>
  );
};

/**
 * MobileControls - Touch-screen D-pad + action buttons for phones/tablets
 * Sets the same keysPressed flags that the keyboard handlers use,
 * so the input emit loop picks them up automatically.
 *
 * Action buttons show cooldown sweep animations and grey out while
 * the ability is recharging. Special has a 5-second cooldown.
 */
const MobileControls = ({ keysPressed, cooldownsRef }) => {
  // Force re-render at ~60fps to update cooldown sweep visuals
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    let raf;
    const loop = () => {
      // Only re-render if any cooldown is active (saves CPU when idle)
      const now = Date.now();
      const cds = cooldownsRef.current;
      const anyActive = cds.punch.end > now || cds.kick.end > now || cds.special.end > now;
      if (anyActive) forceUpdate();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cooldownsRef]);

  const setKey = (key, down) => {
    keysPressed.current[key] = down;
  };

  // Check if an attack key should be blocked due to client-side cooldown
  const isOnCooldown = (cdKey) => {
    if (!cdKey) return false;
    const cd = cooldownsRef.current[cdKey];
    return cd && cd.end > Date.now();
  };

  // Reusable touch handlers; for attack keys, only register if not on cooldown
  const pressHandlers = (key, cdKey) => ({
    onTouchStart: (e) => {
      e.preventDefault();
      if (isOnCooldown(cdKey)) return;
      setKey(key, true);
    },
    onTouchEnd: (e) => { e.preventDefault(); setKey(key, false); },
    onTouchCancel: (e) => { e.preventDefault(); setKey(key, false); },
    onMouseDown: (e) => {
      e.preventDefault();
      if (isOnCooldown(cdKey)) return;
      setKey(key, true);
    },
    onMouseUp: (e) => { e.preventDefault(); setKey(key, false); },
    onMouseLeave: () => { setKey(key, false); }
  });

  const buttonBaseStyle = {
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
    fontFamily: '"Press Start 2P", monospace',
    color: '#00ffff',
    background: 'rgba(0, 30, 60, 0.7)',
    border: '2px solid #00ffff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    textShadow: '0 0 5px #00ffff',
    boxShadow: '0 0 10px rgba(0, 255, 255, 0.4)'
  };

  const dpadSize = 60;
  const actionSize = 70;

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 50,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        padding: '0 20px',
        pointerEvents: 'none',
        zIndex: 200
      }}
    >
      {/* Left: D-pad (movement) */}
      <div style={{
        position: 'relative',
        width: dpadSize * 3,
        height: dpadSize * 3,
        pointerEvents: 'auto'
      }}>
        <div {...pressHandlers('w')} style={{ ...buttonBaseStyle, position: 'absolute', left: dpadSize, top: 0, width: dpadSize, height: dpadSize }}>▲</div>
        <div {...pressHandlers('a')} style={{ ...buttonBaseStyle, position: 'absolute', left: 0, top: dpadSize, width: dpadSize, height: dpadSize }}>◀</div>
        <div {...pressHandlers('d')} style={{ ...buttonBaseStyle, position: 'absolute', left: dpadSize * 2, top: dpadSize, width: dpadSize, height: dpadSize }}>▶</div>
        <div {...pressHandlers('s')} style={{ ...buttonBaseStyle, position: 'absolute', left: dpadSize, top: dpadSize * 2, width: dpadSize, height: dpadSize }}>▼</div>
      </div>

      {/* Right: Action buttons (Y-pattern like SNES) with cooldown overlays */}
      <div style={{
        position: 'relative',
        width: actionSize * 3,
        height: actionSize * 3,
        pointerEvents: 'auto'
      }}>
        {/* JUMP (top) - no cooldown */}
        <ActionButton
          cooldownKey={null}
          cooldownsRef={cooldownsRef}
          pressHandlers={pressHandlers(' ', null)}
          label="JUMP"
          style={{
            ...buttonBaseStyle,
            left: actionSize, top: 0, width: actionSize, height: actionSize,
            background: 'rgba(60, 60, 0, 0.7)',
            border: '2px solid #ffff00',
            color: '#ffff00',
            textShadow: '0 0 5px #ffff00',
            boxShadow: '0 0 10px rgba(255, 255, 0, 0.4)',
            fontSize: '11px'
          }}
        />
        {/* PUNCH (left) - short cooldown */}
        <ActionButton
          cooldownKey="punch"
          cooldownsRef={cooldownsRef}
          pressHandlers={pressHandlers('j', 'punch')}
          label="PUNCH"
          style={{
            ...buttonBaseStyle,
            left: 0, top: actionSize, width: actionSize, height: actionSize,
            background: 'rgba(60, 0, 30, 0.7)',
            border: '2px solid #ff3366',
            color: '#ff3366',
            textShadow: '0 0 5px #ff3366',
            boxShadow: '0 0 10px rgba(255, 51, 102, 0.4)',
            fontSize: '10px'
          }}
        />
        {/* KICK (right) - medium cooldown */}
        <ActionButton
          cooldownKey="kick"
          cooldownsRef={cooldownsRef}
          pressHandlers={pressHandlers('k', 'kick')}
          label="KICK"
          style={{
            ...buttonBaseStyle,
            left: actionSize * 2, top: actionSize, width: actionSize, height: actionSize,
            background: 'rgba(60, 30, 0, 0.7)',
            border: '2px solid #ff9900',
            color: '#ff9900',
            textShadow: '0 0 5px #ff9900',
            boxShadow: '0 0 10px rgba(255, 153, 0, 0.4)',
            fontSize: '11px'
          }}
        />
        {/* SPECIAL (bottom) - 5 second cooldown */}
        <ActionButton
          cooldownKey="special"
          cooldownsRef={cooldownsRef}
          pressHandlers={pressHandlers('l', 'special')}
          label="SPECIAL"
          style={{
            ...buttonBaseStyle,
            left: actionSize, top: actionSize * 2, width: actionSize, height: actionSize,
            background: 'rgba(40, 0, 60, 0.7)',
            border: '2px solid #ff00ff',
            color: '#ff00ff',
            textShadow: '0 0 5px #ff00ff',
            boxShadow: '0 0 10px rgba(255, 0, 255, 0.4)',
            fontSize: '9px'
          }}
        />
      </div>
    </div>
  );
};

/**
 * VictoryScreen - dedicated full-screen 16-bit splash shown after defeating boss
 *
 * Takes over the ENTIRE viewport so the game canvas (which is unmounted at
 * this point) doesn't keep rendering stale frames. Animated with CSS
 * keyframes for confetti, pulsing glow, rainbow text, and blinking subtitle.
 */
const VictoryScreen = ({ onBackToMenu }) => {
  // Generate confetti pieces once at mount
  const confetti = React.useMemo(() => {
    const colors = ['#ff3344', '#ffaa22', '#ffee33', '#33ff66', '#33ccff', '#aa55ff', '#ff44cc'];
    return Array.from({ length: 80 }, (_, i) => ({
      x: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 6 + Math.floor(Math.random() * 10),
      rotateDir: Math.random() > 0.5 ? 1 : -1,
      drift: (Math.random() - 0.5) * 60
    }));
  }, []);

  // Pixel-style stars in the background
  const stars = React.useMemo(() => Array.from({ length: 40 }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    delay: Math.random() * 2,
    size: 2 + Math.floor(Math.random() * 3)
  })), []);

  // Inject CSS keyframes
  const keyframes = `
    @keyframes vs-pulseGlow {
      0%, 100% {
        text-shadow: 0 0 12px #ffff00, 0 0 24px #ff00ff, 0 0 48px #ff00ff;
        transform: scale(1);
      }
      50% {
        text-shadow: 0 0 24px #ffff00, 0 0 48px #ff00ff, 0 0 96px #ff00ff;
        transform: scale(1.04);
      }
    }
    @keyframes vs-rainbow {
      0%   { color: #ff3344; }
      16%  { color: #ffaa22; }
      33%  { color: #ffee33; }
      50%  { color: #33ff66; }
      66%  { color: #33ccff; }
      83%  { color: #aa55ff; }
      100% { color: #ff3344; }
    }
    @keyframes vs-popIn {
      0% { transform: translateY(-80px) scale(0.5); opacity: 0; }
      60% { transform: translateY(8px) scale(1.1); opacity: 1; }
      100% { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes vs-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }
    @keyframes vs-fall {
      0%   { transform: translateY(-50px) translateX(0) rotate(0deg); }
      100% { transform: translateY(110vh) translateX(var(--drift)) rotate(var(--rotate)); }
    }
    @keyframes vs-twinkle {
      0%, 100% { opacity: 0.3; transform: scale(0.7); }
      50% { opacity: 1; transform: scale(1.2); }
    }
    @keyframes vs-scroll {
      0% { transform: translateX(100%); }
      100% { transform: translateX(-100%); }
    }
    .vs-pixel { image-rendering: pixelated; image-rendering: crisp-edges; }
  `;

  return (
    <>
      <style>{keyframes}</style>
      <div
        className="vs-pixel"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'linear-gradient(180deg, #1a0033 0%, #2a0055 30%, #4a0080 60%, #2a0055 100%)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          fontFamily: '"Press Start 2P", monospace'
        }}
      >
        {/* Twinkling pixel stars */}
        {stars.map((s, i) => (
          <div key={`star-${i}`} style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: '#ffffff',
            animation: `vs-twinkle ${1.5 + s.delay}s ease-in-out infinite`,
            animationDelay: `${s.delay}s`,
            pointerEvents: 'none'
          }} />
        ))}

        {/* Falling confetti */}
        {confetti.map((c, i) => (
          <div key={`conf-${i}`} style={{
            position: 'absolute',
            top: -20,
            left: `${c.x}%`,
            width: c.size,
            height: c.size,
            background: c.color,
            border: '1px solid rgba(0,0,0,0.4)',
            animation: `vs-fall ${c.duration}s linear ${c.delay}s infinite`,
            '--drift': `${c.drift}px`,
            '--rotate': `${c.rotateDir * 720}deg`,
            pointerEvents: 'none'
          }} />
        ))}

        {/* Top scrolling marquee */}
        <div style={{
          position: 'absolute',
          top: '40px',
          left: 0,
          right: 0,
          height: '32px',
          overflow: 'hidden',
          background: 'rgba(0,0,0,0.5)',
          borderTop: '2px solid #ffff00',
          borderBottom: '2px solid #ffff00'
        }}>
          <div style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            color: '#ffee33',
            fontSize: '14px',
            paddingTop: '8px',
            animation: 'vs-scroll 18s linear infinite'
          }}>
            ★ HERO STATUS ACHIEVED ★ BOSS DEFEATED ★ CRITICAL PRIORITY 1 RESOLVED ★ TICKETS CLOSED ★ COFFEE EARNED ★
          </div>
        </div>

        {/* Title block */}
        <div style={{ textAlign: 'center', zIndex: 2, marginTop: '20px' }}>
          <h2 style={{
            fontSize: 'clamp(20px, 3vw, 36px)',
            color: '#ffee33',
            margin: '0 0 24px 0',
            animation: 'vs-pulseGlow 2.4s ease-in-out infinite, vs-popIn 0.6s ease-out'
          }}>
            CONGRATS ON RETIREMENT
          </h2>
          <h1 style={{
            fontSize: 'clamp(48px, 9vw, 110px)',
            margin: '0 0 40px 0',
            animation: 'vs-pulseGlow 1.8s ease-in-out infinite, vs-rainbow 4s linear infinite, vs-popIn 0.7s ease-out 0.3s backwards',
            letterSpacing: '0.08em',
            textShadow: '0 0 24px #ff00ff'
          }}>
            BILL!
          </h1>
          <p style={{
            fontSize: 'clamp(14px, 2vw, 24px)',
            color: '#00ffff',
            margin: 0,
            animation: 'vs-blink 1.4s ease-in-out infinite, vs-popIn 0.6s ease-out 0.6s backwards',
            textShadow: '0 0 12px #00ffff'
          }}>
            YOU SURVIVED THE CRAWL!
          </p>
        </div>

        {/* Back to menu */}
        <button
          onClick={onBackToMenu}
          style={{
            marginTop: '60px',
            padding: '20px 50px',
            fontSize: '16px',
            fontFamily: '"Press Start 2P", monospace',
            background: '#33ff66',
            color: '#0a0010',
            border: '3px solid #ffffff',
            borderRadius: '0',
            cursor: 'pointer',
            boxShadow: '0 0 30px rgba(51, 255, 102, 0.7), 0 4px 0 #117733',
            textShadow: '1px 1px 0 rgba(0,0,0,0.3)',
            transition: 'transform 0.1s',
            zIndex: 2,
            animation: 'vs-popIn 0.6s ease-out 1.2s backwards'
          }}
          onMouseEnter={(e) => { e.target.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; }}
          onMouseDown={(e) => { e.target.style.transform = 'translateY(2px)'; }}
          onMouseUp={(e) => { e.target.style.transform = 'scale(1.05)'; }}
        >
          ▶ BACK TO MENU
        </button>

        {/* Bottom corner credit */}
        <div style={{
          position: 'absolute',
          bottom: '20px',
          fontSize: '10px',
          color: '#ffffff',
          opacity: 0.5,
          textAlign: 'center',
          width: '100%'
        }}>
          ※ CORPORATE CRAWLER BILL ※ END OF SHIFT ※
        </div>
      </div>
    </>
  );
};

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
  // Stage transition state: { fromName, toName, until } shown as overlay
  const [stageTransition, setStageTransition] = useState(null);

  const canvasRef = useRef(null);
  const keysPressed = useRef({});
  const animationFrameRef = useRef(null);

  // Visual effects refs (mutable, don't trigger re-renders)
  const damageNumbersRef = useRef([]); // {id, x, y, value, color, spawnTime, vy}
  const hitParticlesRef = useRef([]); // {x, y, vx, vy, color, life}
  const screenShakeRef = useRef({ intensity: 0, until: 0 });
  const flashEffectRef = useRef({ color: null, until: 0 });

  // Client-side cooldown predictions (for visual feedback on action buttons)
  // Each entry: { start: ms, end: ms }. Read by MobileControls each frame.
  const cooldownsRef = useRef({
    punch: { start: 0, end: 0 },
    kick: { start: 0, end: 0 },
    special: { start: 0, end: 0 }
  });

  const CANVAS_WIDTH = 1200;
  const CANVAS_HEIGHT = 700; // Expanded to show more vertical space

  // Load Bill sprite sheets on mount (one-time, cached)
  // Render loop checks getBillSprites() each frame so we don't need React state
  useEffect(() => {
    loadBillSprites()
      .then(() => {
        console.log('Bill sprites loaded successfully');
      })
      .catch(err => {
        console.warn('Bill sprites failed to load, using procedural fallback:', err);
      });
    loadTicketSprites()
      .then(() => {
        console.log('Ticket sprites loaded successfully');
      })
      .catch(err => {
        console.warn('Ticket sprites failed to load, using procedural fallback:', err);
      });
    loadBossSprites()
      .then(() => console.log('Boss sprites loaded successfully'))
      .catch(err => console.warn('Boss sprites failed to load, using procedural fallback:', err));
    loadBossDeathSprites()
      .then(() => console.log('Boss death cinematic loaded successfully'))
      .catch(err => console.warn('Boss death cinematic failed to load:', err));
  }, []);

  // Load the 4 per-stage backgrounds (one per level)
  // Falls back to /sprites/stage.png if specific stage images don't exist
  const stageImagesRef = useRef([null, null, null, null]);
  useEffect(() => {
    const sources = ['/sprites/stage1.png', '/sprites/stage2.png', '/sprites/stage3.png', '/sprites/stage4.png'];
    sources.forEach((src, idx) => {
      const img = new Image();
      img.onload = () => {
        stageImagesRef.current[idx] = img;
        console.log(`Stage ${idx + 1} loaded (${src})`);
      };
      img.onerror = () => {
        console.warn(`Stage ${idx + 1} failed to load (${src})`);
      };
      img.src = src;
    });
  }, []);

  // Detect mobile devices for showing touch controls
  // Uses multiple signals to avoid false positives (e.g. touch laptops)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      // Signal 1: User-agent indicates mobile OS
      const ua = navigator.userAgent || '';
      const isMobileUA = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile/i.test(ua);
      // Signal 2: Device has touch input
      const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
      // Signal 3: Small viewport
      const smallScreen = window.innerWidth < 900;
      // Signal 4: Coarse pointer (typically a finger, not a mouse)
      const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

      // Show mobile controls if:
      // - Mobile UA, OR
      // - Has touch AND (small screen OR coarse pointer)
      const shouldShow = isMobileUA || (hasTouch && (smallScreen || coarsePointer));
      setIsMobile(shouldShow);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
      // Switch to the dedicated victory screen so the game canvas unmounts
      // (avoids stale frames being rendered from the just-finished room)
      setLevelWon(true);
      setScreen('victory');
    });

    // Server has begun a stage transition - show the splash overlay
    newSocket.on('stageTransitionStart', ({ fromStageName, nextStageName, duration }) => {
      console.log(`[Stage] ${fromStageName} → ${nextStageName}`);
      setStageTransition({
        fromName: fromStageName,
        toName: nextStageName,
        until: Date.now() + duration
      });
      // Clear it slightly after duration so animation fully plays
      setTimeout(() => setStageTransition(null), duration + 200);
    });

    // New stage has started - cooldowns reset, camera should snap to 0
    newSocket.on('stageStarted', ({ stageName }) => {
      console.log(`[Stage] Now playing: ${stageName}`);
      // Reset client visual cooldowns + camera
      cooldownsRef.current = {
        punch: { start: 0, end: 0 },
        kick: { start: 0, end: 0 },
        special: { start: 0, end: 0 }
      };
      setCameraX(0);
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
        jump: keysPressed.current[' '], // SPACE only - W is for depth movement
        up: keysPressed.current['w'] || keysPressed.current['arrowup'], // Move up in depth plane
        down: keysPressed.current['s'] || keysPressed.current['arrowdown'] // Move down in depth plane
      };

      socket.emit('playerInput', { roomId, input });

      // Attack inputs - respect client-side cooldowns and record for visual feedback
      const nowMs = Date.now();
      const tryAttack = (key, attackType) => {
        if (!keysPressed.current[key]) return;
        const cd = cooldownsRef.current[attackType];
        if (cd && cd.end > nowMs) {
          // Still on cooldown - swallow the press
          keysPressed.current[key] = false;
          return;
        }
        socket.emit('playerAttack', { roomId, attackType });
        keysPressed.current[key] = false;
        cooldownsRef.current[attackType] = {
          start: nowMs,
          end: nowMs + COOLDOWN_MS[attackType]
        };
      };
      tryAttack('j', 'punch');
      tryAttack('k', 'kick');
      tryAttack('l', 'special');
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

      // Draw stage: pick the image for the current stage index
      // Stage images may be high-res (e.g. 3904x1088); scale to fit canvas
      // height while preserving aspect ratio, then offset by cameraX so the
      // image scrolls with the world. Any image source resolution works
      // because we never assume a 1:1 mapping between PNG px and world px.
      const stageIdx = gameState.currentStageIndex ?? gameState.currentZoneIndex ?? 0;
      const stageImg = stageImagesRef.current[stageIdx];
      if (stageImg && stageImg.complete && stageImg.naturalWidth > 0) {
        const scale = CANVAS_HEIGHT / stageImg.naturalHeight;
        const drawW = stageImg.naturalWidth * scale;
        const drawH = CANVAS_HEIGHT;
        ctx.drawImage(stageImg, -cameraX, 0, drawW, drawH);
        if (drawW < gameState.worldWidth) {
          ctx.fillStyle = '#1a1a2a';
          ctx.fillRect(drawW - cameraX, 0, gameState.worldWidth - drawW, drawH);
        }
      } else {
        drawParallaxBackground(
          ctx,
          gameState.currentZoneIndex,
          cameraX,
          gameState.worldWidth,
          gameState.worldHeight
        );
      }

      // Play area depth boundaries are rendered through the tiled ground
      // No need for explicit line — the back wall transitions to floor naturally

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

      // Boss death cinematic - dims everything, zooms in, plays 64-frame anim
      if (gameState.bossDying) {
        drawBossDeathCinematic(ctx, gameState, now, canvas.width, canvas.height);
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
  // FIXED: endpoint is /api/rooms - the wildcard route catches anything else
  // and returns index.html, which then fails JSON.parse silently.
  const fetchRooms = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/rooms`);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Expected JSON, got ${contentType}`);
      }
      const data = await response.json();
      setAvailableRooms(Array.isArray(data.rooms) ? data.rooms : []);
    } catch (err) {
      console.error('[fetchRooms] failed:', err);
      // Show error to user instead of just silently logging
      setError(`Could not load room list: ${err.message}`);
      setTimeout(() => setError(''), 4000);
      setAvailableRooms([]);
    }
  };

  // Auto-refresh the room list every 3 seconds while on the lobby screen
  // (so newly-created rooms appear without manual REFRESH clicks)
  useEffect(() => {
    if (screen !== 'lobby') return;
    const interval = setInterval(() => {
      fetchRooms();
    }, 3000);
    return () => clearInterval(interval);
    // fetchRooms is stable-enough (defined inside component); intentionally
    // not in deps to avoid recreating the interval each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Reset all room/game state and return to the menu screen.
  // Used by both victory screen and game-over flows so a new game starts clean.
  const resetToMenu = () => {
    setLevelWon(false);
    setGameState(null);
    setRoomId('');
    setPlayerId('');
    setCameraX(0);
    setStageTransition(null);
    // Clear visual effects refs
    damageNumbersRef.current = [];
    hitParticlesRef.current = [];
    screenShakeRef.current = { intensity: 0, until: 0 };
    flashEffectRef.current = { color: null, until: 0 };
    cooldownsRef.current = {
      punch: { start: 0, end: 0 },
      kick: { start: 0, end: 0 },
      special: { start: 0, end: 0 }
    };
    keysPressed.current = {};
    setScreen('menu');
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

      {screen === 'victory' && (
        <VictoryScreen onBackToMenu={resetToMenu} />
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
                // Lock the 12:7 ratio so portrait/landscape orientation changes
                // can't squish the canvas. maxWidth/maxHeight without aspect-ratio
                // applies each axis independently and distorts the image.
                aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 160px)',
                width: 'auto',
                height: 'auto',
                margin: '0 auto',
                border: '3px solid #00ffff',
                boxShadow: '0 0 40px rgba(0, 255, 255, 0.3)',
                background: '#0a0a0a',
                display: 'block'
              }}
            />

            {/* Victory is now handled by the dedicated VictoryScreen above (screen==='victory') */}

            {/* Stage Transition Splash */}
            {stageTransition && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                fontFamily: '"Press Start 2P", monospace',
                zIndex: 90,
                animation: 'stageTransIn 0.4s ease-out'
              }}>
                <style>{`
                  @keyframes stageTransIn {
                    0% { opacity: 0; transform: scale(0.9); }
                    100% { opacity: 1; transform: scale(1); }
                  }
                  @keyframes stageLabelPop {
                    0% { transform: translateY(-30px); opacity: 0; }
                    60% { transform: translateY(6px); opacity: 1; }
                    100% { transform: translateY(0); opacity: 1; }
                  }
                  @keyframes stageArrow {
                    0%, 100% { transform: translateX(0); }
                    50% { transform: translateX(20px); }
                  }
                `}</style>
                <div style={{ textAlign: 'center', color: '#00ff66' }}>
                  <div style={{
                    fontSize: '16px',
                    color: '#ffff00',
                    marginBottom: '24px',
                    animation: 'stageLabelPop 0.5s ease-out',
                    textShadow: '0 0 10px #ffff00'
                  }}>
                    STAGE CLEAR!
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#aaaaaa',
                    marginBottom: '12px'
                  }}>
                    {stageTransition.fromName}
                  </div>
                  <div style={{
                    fontSize: '28px',
                    color: '#00ff66',
                    animation: 'stageArrow 0.7s ease-in-out infinite',
                    marginBottom: '12px',
                    textShadow: '0 0 20px #00ff66'
                  }}>
                    ▶ ▶ ▶
                  </div>
                  <div style={{
                    fontSize: '22px',
                    color: '#00ffff',
                    animation: 'stageLabelPop 0.6s ease-out 0.3s backwards',
                    textShadow: '0 0 12px #00ffff'
                  }}>
                    {stageTransition.toName}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: '#888888',
                    marginTop: '32px'
                  }}>
                    LOADING NEXT LEVEL...
                  </div>
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

          {/* Mobile Touch Controls - only on touch devices */}
          {isMobile && (
            <MobileControls keysPressed={keysPressed} cooldownsRef={cooldownsRef} />
          )}

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
            {!isMobile && (
              <>
                <span>A/D: MOVE</span>
                <span>W/S: DEPTH</span>
                <span>SPACE: JUMP</span>
                <span>J: PUNCH</span>
                <span>K: KICK</span>
                <span>L: SPECIAL</span>
              </>
            )}
            {isMobile && (
              <span>TOUCH CONTROLS BELOW</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Draw a unit with 16-bit style sprite anatomy, animations, and effects
 * For players (team='players'), uses pre-loaded Bill sprite sheets when available
 */
function drawUnit(ctx, unit, cameraX, groundLevel, isMe, now) {
  if (!unit) return;

  const screenX = unit.x - cameraX;
  const screenY = unit.y;

  // Only draw if on screen (with margin)
  if (screenX + unit.width < -20 || screenX > ctx.canvas.width + 20) return;

  const w = unit.width;
  const h = unit.height;
  const cx = screenX + w / 2;
  const facing = unit.direction || 1;

  // Walking bob animation based on horizontal velocity
  const isMoving = Math.abs(unit.velocityX || 0) > 0.3;
  const bobAmount = isMoving ? Math.sin(now / 80) * 2 : 0;

  // Hit flash effect (within 150ms of being hit)
  const hitFlash = unit.lastHitTime && (now - unit.lastHitTime) < 150;
  const flashAlpha = hitFlash ? 1 - ((now - unit.lastHitTime) / 150) : 0;

  // Shadow follows unit's ground (depth) position, scales smaller when in air
  const unitGroundY = unit.groundY !== undefined ? unit.groundY : groundLevel;
  const jumpHeight = Math.max(0, unitGroundY - screenY);
  const shadowScale = Math.max(0.5, 1 - jumpHeight / 200);

  // Drop shadow at the unit's current ground position (depth)
  ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(cx, unitGroundY + h - 2, (w / 2) * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // === Use Bill sprite rendering for players if loaded AND a valid frame exists ===
  if (unit.team === 'players' && getBillSprites()) {
    const billFrame = pickBillFrame(unit, now);
    if (billFrame && billFrame.sprite && billFrame.sprite.canvas) {
      drawBillSprite(ctx, unit, screenX, screenY, w, h, facing, bobAmount, hitFlash, flashAlpha, isMe, now, billFrame);
      return;
    }
    // If frame invalid, fall through to procedural rendering below
  }

  // === Use ticket-monster sprites for enemies if loaded ===
  if (unit.team === 'enemies' && getTicketSprites()) {
    const ticketFrame = pickTicketFrame(unit);
    if (ticketFrame && ticketFrame.canvas) {
      drawTicketSprite(ctx, unit, screenX, screenY, w, h, facing, bobAmount, hitFlash, flashAlpha, now, ticketFrame);
      return;
    }
    // Otherwise fall through to procedural
  }

  // Procedural rendering for enemies / when sprites failed to load

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
 * Draw an enemy as a help-ticket monster sprite.
 * Frame is pre-validated by caller. Flips for facing direction, applies
 * hit flash, attack-attacking "lunge", and renders health bar / KO text.
 */
function drawTicketSprite(ctx, unit, screenX, screenY, w, h, facing, bobAmount, hitFlash, flashAlpha, now, frame) {
  const sprite = frame;
  // Ticket sprites are intentionally a bit chunkier than the hitbox so they
  // read clearly. They're shorter than Bill (matching enemy size hierarchy).
  const drawH = 100;
  const aspect = sprite.canvas.width / sprite.canvas.height;
  const drawW = drawH * aspect;
  const cx = screenX + w / 2;
  const feetY = screenY + h;
  const drawX = cx - drawW / 2;
  const drawY = feetY - drawH + bobAmount;

  ctx.save();

  // Knockout: tilt over
  if (unit.isKnockedOut) {
    ctx.translate(cx, feetY);
    ctx.rotate((Math.PI / 2) * facing);
    ctx.translate(-cx, -feetY);
  }

  // Attacking: small forward lunge
  let lunge = 0;
  if (unit.isAttacking) {
    const elapsed = now - (unit.attackStartTime || now);
    const dur = unit.attackDuration || 300;
    const t = Math.min(1, elapsed / dur);
    lunge = facing * Math.sin(t * Math.PI) * 6;
  }

  // Flip for left-facing (tickets are drawn facing right)
  if (facing < 0) {
    ctx.translate(drawX + drawW + lunge, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.canvas, 0, drawY, drawW, drawH);
  } else {
    ctx.drawImage(sprite.canvas, drawX + lunge, drawY, drawW, drawH);
  }

  // Hit flash overlay (white tint on the sprite)
  if (hitFlash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    if (facing < 0) {
      ctx.fillRect(0, drawY, drawW, drawH);
    } else {
      ctx.fillRect(drawX + lunge, drawY, drawW, drawH);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();

  // Health bar (above sprite)
  if (!unit.isKnockedOut) {
    const barWidth = Math.max(w, 36);
    const barHeight = 4;
    const barX = cx - barWidth / 2;
    const barY = drawY - 8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    const hp = unit.health / unit.maxHealth;
    ctx.fillStyle = hp > 0.5 ? '#00ff66' : hp > 0.25 ? '#ffcc00' : '#ff3333';
    ctx.fillRect(barX, barY, barWidth * hp, barHeight);
  }

  // K.O. indicator
  if (unit.isKnockedOut) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.font = 'bold 12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText('K.O.', cx, screenY + h / 2);
    ctx.shadowBlur = 0;
  }
}

/**
 * Draw Bill using sprite sheets (Corporate Crawler Bill character)
 * Handles idle, walking, punching, kicking animations + flipping
 * Frame is pre-validated by caller in drawUnit
 */
function drawBillSprite(ctx, unit, screenX, screenY, w, h, facing, bobAmount, hitFlash, flashAlpha, isMe, now, frame) {
  const sprite = frame.sprite;
  // Render each frame at its native source pixel dimensions. The SpriteLoader
  // now returns full cells (~125×166) instead of bbox-cropped sub-regions,
  // so every frame has the SAME canvas dimensions and the body sits in the
  // SAME position within the cell. FX (special's energy ball, kick's wind
  // streaks) appear at the relative size the artist drew them without
  // distorting the body's on-screen size or position.
  const SPRITE_SCALE = 1.0;
  const drawW = sprite.canvas.width * SPRITE_SCALE;
  const drawH = sprite.canvas.height * SPRITE_SCALE;
  const cx = screenX + w / 2;
  const feetY = screenY + h;
  const drawX = cx - drawW / 2;
  const drawY = feetY - drawH + bobAmount;

  // The sheet has separate walk-left / walk-right rows; for those, frame.mirror=false
  // For other anims (punch/kick/etc.) only one direction is drawn, so we flip when facing left
  const shouldMirror = !!frame.mirror;

  ctx.save();

  // Player glow effect
  if (isMe && !unit.isKnockedOut) {
    ctx.shadowColor = unit.color || '#00ffff';
    ctx.shadowBlur = 12;
  }

  // Note: the "defeated" row already shows fall animation, so no extra tilt
  // for knocked-out characters - just play through the row's frames

  // Apply horizontal flip if frame says so
  if (shouldMirror) {
    ctx.translate(drawX + drawW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.canvas, 0, drawY, drawW, drawH);
  } else {
    ctx.drawImage(sprite.canvas, drawX, drawY, drawW, drawH);
  }

  ctx.shadowBlur = 0;

  // Hit flash overlay
  if (hitFlash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    if (shouldMirror) {
      ctx.fillRect(0, drawY, drawW, drawH);
    } else {
      ctx.fillRect(drawX, drawY, drawW, drawH);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();

  // Health bar (above sprite)
  if (!unit.isKnockedOut) {
    const barWidth = w;
    const barHeight = 4;
    const barX = screenX;
    const barY = drawY - 8;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    const healthPercent = unit.health / unit.maxHealth;
    ctx.fillStyle = healthPercent > 0.5 ? '#00ff66' : healthPercent > 0.25 ? '#ffcc00' : '#ff3333';
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  }

  // "YOU" label for own character
  if (isMe) {
    ctx.fillStyle = '#00ffff';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText('YOU', cx, drawY - 14);
    ctx.shadowBlur = 0;
  }

  // K.O. indicator
  if (unit.isKnockedOut) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.font = 'bold 14px "Press Start 2P", monospace';
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
 * Cinematic boss death overlay - dims the game, centers a large boss death
 * sprite, plays 64-frame animation over ~5.2 seconds.
 *
 * Phases (per server-side timing):
 *   0-13%   stagger
 *   13-25%  look up + scream begins
 *   25-37%  full scream + eye beams
 *   37-50%  energy vortex
 *   50-62%  cracking
 *   62-75%  collapse
 *   75-87%  vaporize
 *   87-100% final dispersal
 */
function drawBossDeathCinematic(ctx, gameState, now, canvasW, canvasH) {
  const death = gameState.bossDying;
  if (!death) return;
  const elapsed = death.elapsed;
  const duration = death.duration;
  const t = Math.min(1, elapsed / duration);

  // Phase progress (0-7)
  const phase = Math.min(7, Math.floor(t * 8));

  // Dark vignette overlay - intensifies through the cinematic
  const dimAlpha = 0.5 + t * 0.35;
  ctx.fillStyle = `rgba(0, 0, 0, ${dimAlpha})`;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Radial vignette (darker corners)
  const grad = ctx.createRadialGradient(canvasW / 2, canvasH / 2, 100,
                                        canvasW / 2, canvasH / 2, canvasW * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Get death frame
  const frame = pickBossDeathFrame(elapsed, duration);

  // Centered boss draw position with zoom that increases through the cinematic
  // Start at 1.6x, ramp up to 2.5x by phase 3, then slowly shrink as dispersing
  let zoom;
  if (phase <= 3) zoom = 1.6 + phase * 0.3; // 1.6 -> 2.5
  else if (phase <= 5) zoom = 2.5 - (phase - 3) * 0.1; // 2.5 -> 2.3
  else zoom = 2.3 - (phase - 5) * 0.2; // 2.3 -> 1.9

  // Screen-shake during dramatic phases (2-4: scream + cracking)
  let shakeX = 0, shakeY = 0;
  if (phase >= 2 && phase <= 4) {
    const intensity = phase === 3 || phase === 4 ? 6 : 3;
    shakeX = (Math.random() - 0.5) * intensity * 2;
    shakeY = (Math.random() - 0.5) * intensity * 2;
  }

  if (frame && frame.canvas && !frame.isEmpty) {
    const baseH = 200;
    const drawH = baseH * zoom;
    const aspect = frame.canvas.width / frame.canvas.height;
    const drawW = drawH * aspect;

    // Position centered, slightly above center (toward sky-screaming visual)
    const cx = canvasW / 2 + shakeX;
    const cy = canvasH / 2 + 20 + shakeY;
    const drawX = cx - drawW / 2;
    const drawY = cy - drawH / 2;

    // Bright glow halo during scream phases
    if (phase >= 1 && phase <= 4) {
      const glowAlpha = 0.4 + Math.sin(now / 100) * 0.1;
      ctx.save();
      ctx.globalAlpha = glowAlpha;
      ctx.fillStyle = phase === 2 ? '#ffffff' : phase === 3 ? '#ff00cc' : '#00ddff';
      ctx.beginPath();
      ctx.arc(cx, cy, 100 + phase * 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Drop shadow for the sprite
    ctx.save();
    ctx.shadowColor = phase >= 6 ? '#aaccff' : phase >= 4 ? '#ff66ff' : '#00ddff';
    ctx.shadowBlur = 20 + phase * 5;
    ctx.drawImage(frame.canvas, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  // Text overlay at top - matches the cinematic mood
  ctx.save();
  ctx.font = 'bold 14px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 8;
  if (phase <= 1) {
    ctx.fillStyle = '#ff3344';
    ctx.fillText('CRITICAL!', canvasW / 2, 70);
  } else if (phase <= 3) {
    ctx.fillStyle = '#ffffff';
    ctx.fillText('NO!!!', canvasW / 2, 70);
  } else if (phase <= 5) {
    ctx.fillStyle = '#00ddff';
    ctx.fillText('SYSTEM FAILURE...', canvasW / 2, 70);
  } else {
    ctx.fillStyle = '#aaccff';
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.fillText('THE OUTAGE IS RESOLVED', canvasW / 2, 70);
  }
  ctx.restore();
}

/**
 * Draw the boss with prominent health bar
 */
function drawBoss(ctx, boss, cameraX, groundLevel, now) {
  if (!boss) return;

  const screenX = boss.x - cameraX;
  const screenY = boss.y;

  // === FIRST: Draw attack telegraphs BEHIND boss for layering ===
  if (boss.currentAttack) {
    drawBossAttackTelegraph(ctx, boss, cameraX, now);
  }
  if (boss.attackZones && boss.attackZones.length > 0) {
    drawBossTargetZones(ctx, boss.attackZones, cameraX, now);
  }

  // === Draw boss body (only if on screen) ===
  if (screenX + boss.width >= 0 && screenX <= ctx.canvas.width) {
    const isCharging = boss.currentAttack && boss.currentAttack.isInTelegram;
    const chargeIntensity = isCharging ? boss.currentAttack.telegramProgress : 0;
    const wobble = isCharging ? Math.sin(now / 60) * 3 * chargeIntensity : 0;

    // Try to use sprite-based rendering (Broadcast Storm)
    const bossSprites = getBossSprites();
    const bossFrame = bossSprites ? pickBossFrame(boss, now) : null;

    if (bossFrame && bossFrame.sprite && bossFrame.sprite.canvas) {
      const sprite = bossFrame.sprite;
      // Render at 1.6x sprite scale so the boss feels massive
      const drawH = 220;
      const aspect = sprite.canvas.width / sprite.canvas.height;
      const drawW = drawH * aspect;
      const cx = screenX + boss.width / 2;
      const feetY = screenY + boss.height;
      const drawX = cx - drawW / 2 + wobble;
      const drawY = feetY - drawH;

      // Charge glow during telegraph
      if (isCharging) {
        const pulse = Math.sin(now / 100) * 0.5 + 0.5;
        ctx.shadowColor = boss.currentAttack.type === 'laserBeam' ? '#ff00cc' :
                          boss.currentAttack.type === 'targetZones' ? '#ffaa00' : '#00ddff';
        ctx.shadowBlur = 15 + chargeIntensity * 25 + pulse * 8;
      } else {
        ctx.shadowColor = '#00ddff';
        ctx.shadowBlur = 18;
      }

      ctx.drawImage(sprite.canvas, drawX, drawY, drawW, drawH);
      ctx.shadowBlur = 0;
    } else {
      // Fallback: procedural body (the original magenta rectangle look)
      if (isCharging) {
        const pulse = Math.sin(now / 100) * 0.5 + 0.5;
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 20 + chargeIntensity * 30 + pulse * 10;
      } else {
        ctx.shadowColor = '#ff00ff';
        ctx.shadowBlur = 25;
      }
      const bodyW = boss.width + 40;
      const bodyH = boss.height + 40;
      const bodyX = screenX - 20;
      const bodyY = screenY - 20;
      ctx.fillStyle = isCharging ? '#cc00ff' : '#ff00ff';
      ctx.fillRect(bodyX + wobble, bodyY, bodyW, bodyH);
      ctx.fillStyle = '#660099';
      ctx.fillRect(bodyX + 10 + wobble, bodyY + 15, bodyW - 20, 25);
      const eyeColor = isCharging ? '#ff0000' : '#ffff00';
      ctx.fillStyle = eyeColor;
      ctx.fillRect(bodyX + 20 + wobble, bodyY + 25, 12, 8);
      ctx.fillRect(bodyX + bodyW - 32 + wobble, bodyY + 25, 12, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bodyX + 24 + wobble, bodyY + 28, 4, 4);
      ctx.fillRect(bodyX + bodyW - 28 + wobble, bodyY + 28, 4, 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 14px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('P1', bodyX + bodyW / 2 + wobble, bodyY + bodyH - 12);
    }
  }

  ctx.shadowBlur = 0;

  // === Boss health bar (top of screen) ===
  const bossBarWidth = 320;
  const bossBarHeight = 22;
  const bossBarX = ctx.canvas.width / 2 - bossBarWidth / 2;
  const bossBarY = 28;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(bossBarX - 4, bossBarY - 4, bossBarWidth + 8, bossBarHeight + 8);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(bossBarX, bossBarY, bossBarWidth, bossBarHeight);

  const healthPercent = boss.health / boss.maxHealth;
  if (healthPercent > 0.5) ctx.fillStyle = '#ff3366';
  else if (healthPercent > 0.25) ctx.fillStyle = '#ffaa00';
  else ctx.fillStyle = '#ff0000';
  ctx.fillRect(bossBarX, bossBarY, bossBarWidth * healthPercent, bossBarHeight);

  // Segmented divisions on health bar
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = bossBarX + (bossBarWidth / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, bossBarY);
    ctx.lineTo(x, bossBarY + bossBarHeight);
    ctx.stroke();
  }

  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(bossBarX, bossBarY, bossBarWidth, bossBarHeight);

  // Boss name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 3;
  ctx.fillText('BROADCAST STORM - P1 OUTAGE', ctx.canvas.width / 2, bossBarY - 6);
  ctx.shadowBlur = 0;

  // Health number
  ctx.fillStyle = '#ffffff';
  ctx.font = '9px "Press Start 2P", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(boss.health)}/${Math.round(boss.maxHealth)}`,
    bossBarX + bossBarWidth - 6, bossBarY + 15);
}

/**
 * Draw boss attack telegraph - one per attack type, all clearly visible
 */
function drawBossAttackTelegraph(ctx, boss, cameraX, now) {
  const atk = boss.currentAttack;
  if (!atk) return;

  // Convert world coordinates to screen
  const bossScreenX = (atk.bossX !== undefined ? atk.bossX : boss.x) - cameraX;
  const bossScreenY = (atk.bossY !== undefined ? atk.bossY : boss.y);

  // === SHOCKWAVE TELEGRAPH ===
  if (atk.type === 'shockwave') {
    const maxRadius = atk.radius || 220;

    if (atk.isInTelegram) {
      // Telegraph: pulsing red preview circle on ground
      const pulse = Math.sin(now / 80) * 0.3 + 0.7;
      const previewRadius = maxRadius * (0.3 + atk.telegramProgress * 0.7);

      // Filled red zone preview
      ctx.fillStyle = `rgba(255, 0, 0, ${0.15 + atk.telegramProgress * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(bossScreenX + boss.width / 2, bossScreenY + boss.height,
        previewRadius, previewRadius * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing outline
      ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
      ctx.lineWidth = 3 + atk.telegramProgress * 4;
      ctx.beginPath();
      ctx.ellipse(bossScreenX + boss.width / 2, bossScreenY + boss.height,
        previewRadius, previewRadius * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Warning text
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('JUMP OR MOVE BACK!', ctx.canvas.width / 2, 90);
      ctx.shadowBlur = 0;
    } else {
      // Damage phase: shockwave ring expanding outward
      const shockRadius = maxRadius * atk.damageProgress;
      const opacity = 1 - atk.damageProgress;

      // Outer wave
      ctx.strokeStyle = `rgba(255, 100, 0, ${opacity})`;
      ctx.lineWidth = 10;
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.ellipse(bossScreenX + boss.width / 2, bossScreenY + boss.height,
        shockRadius, shockRadius * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Inner wave
      ctx.strokeStyle = `rgba(255, 255, 0, ${opacity * 0.8})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(bossScreenX + boss.width / 2, bossScreenY + boss.height,
        shockRadius * 0.85, shockRadius * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
    }
  }

  // === LASER BEAM TELEGRAPH ===
  if (atk.type === 'laserBeam') {
    const beamY = atk.laserStartY !== undefined ? atk.laserStartY : bossScreenY;
    const beamScreenY = beamY + boss.height / 2;
    const halfWidth = (atk.beamWidth || 50) / 2;
    const direction = atk.direction || 1;

    if (atk.isInTelegram) {
      // Aim sight line - red laser pointer
      const alpha = 0.3 + atk.telegramProgress * 0.6;
      const blink = Math.sin(now / 60) > 0 ? 1 : 0.5;

      // Thin red sight line across entire screen
      ctx.strokeStyle = `rgba(255, 0, 0, ${alpha * blink})`;
      ctx.lineWidth = 1 + atk.telegramProgress * 2;
      ctx.beginPath();
      ctx.moveTo(0, beamScreenY);
      ctx.lineTo(ctx.canvas.width, beamScreenY);
      ctx.stroke();

      // Warning band shows where damage will be
      ctx.fillStyle = `rgba(255, 0, 0, ${0.1 + atk.telegramProgress * 0.15})`;
      const beamStartX = direction > 0 ? bossScreenX + boss.width : 0;
      const beamEndX = direction > 0 ? ctx.canvas.width : bossScreenX;
      ctx.fillRect(beamStartX, beamScreenY - halfWidth,
        beamEndX - beamStartX, halfWidth * 2);

      // Boss is aiming - draw aim indicators
      const indicatorSize = 8 + Math.sin(now / 100) * 4;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(bossScreenX + boss.width / 2, beamScreenY - 30, indicatorSize, 0, Math.PI * 2);
      ctx.fill();

      // Warning text
      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('DODGE WITH W/S!', ctx.canvas.width / 2, 90);
      ctx.shadowBlur = 0;
    } else {
      // Firing! Bright cyan laser beam
      const opacity = 1 - atk.damageProgress;
      const beamStartX = direction > 0 ? bossScreenX + boss.width : 0;
      const beamEndX = direction > 0 ? ctx.canvas.width : bossScreenX;

      // Outer beam (cyan)
      ctx.fillStyle = `rgba(0, 220, 255, ${opacity * 0.8})`;
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 25;
      ctx.fillRect(beamStartX, beamScreenY - halfWidth,
        beamEndX - beamStartX, halfWidth * 2);

      // Inner beam (white core)
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fillRect(beamStartX, beamScreenY - halfWidth * 0.4,
        beamEndX - beamStartX, halfWidth * 0.8);
      ctx.shadowBlur = 0;
    }
  }
}

/**
 * Draw target zones for "Service Restarts" attack
 * Zones are clearly visible, pulse during telegraph, then explode
 */
function drawBossTargetZones(ctx, zones, cameraX, now) {
  zones.forEach(zone => {
    const screenX = zone.x - cameraX;
    if (screenX < -100 || screenX > ctx.canvas.width + 100) return;

    if (!zone.hasDetonated) {
      // Telegraph: pulsing orange/yellow warning circle
      const tp = zone.telegraphProgress || 0;
      const pulse = Math.sin(now / 80) * 0.3 + 0.7;
      const colorMix = tp; // 0 = orange, 1 = red

      // Fill - intensity grows during telegraph
      const r = Math.floor(255);
      const g = Math.floor(180 - colorMix * 180);
      const b = 0;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.2 + tp * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(screenX, zone.y + 30, zone.radius, zone.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Outline - pulses
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
      ctx.lineWidth = 3 + tp * 3;
      ctx.beginPath();
      ctx.ellipse(screenX, zone.y + 30, zone.radius, zone.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair in center to mark target
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screenX - 10, zone.y + 30);
      ctx.lineTo(screenX + 10, zone.y + 30);
      ctx.moveTo(screenX, zone.y + 25);
      ctx.lineTo(screenX, zone.y + 35);
      ctx.stroke();

      // Countdown bar (visual representation of time remaining)
      const barW = zone.radius * 1.5;
      const barH = 4;
      const barX = screenX - barW / 2;
      const barY = zone.y - zone.radius * 0.5 - 10;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(barX, barY, barW * tp, barH);
    } else {
      // Explosion! Bright red burst
      ctx.fillStyle = 'rgba(255, 80, 0, 0.5)';
      ctx.beginPath();
      ctx.ellipse(screenX, zone.y + 30, zone.radius * 1.1, zone.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner blast (yellow/white)
      ctx.fillStyle = 'rgba(255, 255, 100, 0.7)';
      ctx.beginPath();
      ctx.ellipse(screenX, zone.y + 30, zone.radius * 0.7, zone.radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * Draw parallax scrolling 16-bit SNES-style corporate campus background
 * Uses pre-rendered tiles for performance and authentic pixel-art feel
 */
function drawParallaxBackground(ctx, zoneIndex, cameraX, worldWidth, worldHeight) {
  const tiles = getTileset();
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;

  // Zone-specific sky colors
  const skyColors = {
    0: ['#3a5a8a', '#7aaccc', '#ccddee'], // Parking Lot - daytime blue
    1: ['#5a8acc', '#a0c4e0', '#d0e4f0'], // Quad - bright clear sky
    2: ['#4a4a6a', '#8a8aaa', '#ccccd8'], // Lobby - cool indoor
    3: ['#0a0a2a', '#1a1a3a', '#2a2a4a']  // Elevators - dark server room
  };
  const sky = skyColors[zoneIndex] || skyColors[0];

  // === Sky gradient (covers everything above ground level) ===
  const gradient = ctx.createLinearGradient(0, 0, 0, 380);
  gradient.addColorStop(0, sky[0]);
  gradient.addColorStop(0.6, sky[1]);
  gradient.addColorStop(1, sky[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasW, 380);

  // === Layer 1: Distant clouds (0.15x parallax) ===
  if (zoneIndex !== 3) { // No clouds in elevator/server room
    drawClouds(ctx, tiles, cameraX * 0.15, canvasW);
  }

  // === Layer 2: Skyline buildings (0.35x parallax) ===
  drawSkyline(ctx, tiles, cameraX * 0.35, canvasW, zoneIndex);

  // === Layer 3: Mid-ground buildings (0.55x parallax) ===
  drawMidgroundBuildings(ctx, tiles, cameraX * 0.55, canvasW, zoneIndex);

  // === Layer 4: Tiled ground (0.95x - near full parallax) ===
  drawTiledGround(ctx, tiles, cameraX * 0.95, canvasW, canvasH, zoneIndex);

  // === Layer 5: Foreground props (0.85x parallax) ===
  drawForegroundProps(ctx, tiles, cameraX * 0.85, canvasW, zoneIndex);
}

/**
 * Draw scrolling clouds in the sky
 */
function drawClouds(ctx, tiles, scrollX, canvasW) {
  if (!tiles.cloud) return;
  const cloudSpacing = 250;
  const numClouds = Math.ceil(canvasW / cloudSpacing) + 2;
  for (let i = -1; i < numClouds; i++) {
    const xRaw = i * cloudSpacing - scrollX;
    const x = ((xRaw % (canvasW + 400)) + canvasW + 400) % (canvasW + 400) - 200;
    const y = 30 + (i * 17) % 50;
    ctx.drawImage(tiles.cloud, Math.floor(x), Math.floor(y));
  }
}

/**
 * Draw skyline buildings (background)
 */
function drawSkyline(ctx, tiles, scrollX, canvasW, zoneIndex) {
  const spacing = 120;
  const numBuildings = Math.ceil(canvasW / spacing) + 2;
  for (let i = -1; i < numBuildings; i++) {
    const xRaw = i * spacing - scrollX;
    const x = ((xRaw % (canvasW + 300)) + canvasW + 300) % (canvasW + 300) - 150;
    // Alternate between tall and short buildings
    const isTall = (i * 7) % 5 < 2;
    const bldg = isTall ? tiles.officeBuildingTall : tiles.officeBuilding;
    if (!bldg) continue;
    const y = isTall ? 130 : 180;
    ctx.drawImage(bldg, Math.floor(x), y);
  }
}

/**
 * Draw mid-ground buildings (closer)
 */
function drawMidgroundBuildings(ctx, tiles, scrollX, canvasW, zoneIndex) {
  const spacing = 180;
  const numBuildings = Math.ceil(canvasW / spacing) + 2;
  for (let i = -1; i < numBuildings; i++) {
    const xRaw = i * spacing - scrollX;
    const x = ((xRaw % (canvasW + 400)) + canvasW + 400) % (canvasW + 400) - 200;
    // Every 3rd building is a different style
    const useShort = (i * 5) % 3 === 0;
    const bldg = useShort ? tiles.buildingShort : tiles.officeBuilding;
    if (!bldg) continue;
    const y = useShort ? 230 : 200;
    ctx.drawImage(bldg, Math.floor(x), y);
  }
}

/**
 * Draw tiled ground (back wall + floor)
 * Ground is the main play surface - tiled with zone-specific tiles
 */
function drawTiledGround(ctx, tiles, scrollX, canvasW, canvasH, zoneIndex) {
  const playFloorY = 380; // Start of play floor
  const groundEndY = 700;

  // Zone-specific ground tile
  let primaryTile = tiles.asphalt;
  let accentTile = tiles.asphaltStripe;
  let wallColor = '#2a2a30';

  switch (zoneIndex) {
    case 0: // Parking Lot
      primaryTile = tiles.asphalt;
      accentTile = tiles.asphaltStripe;
      wallColor = '#3a3a44';
      break;
    case 1: // Quad
      primaryTile = tiles.grass;
      accentTile = tiles.grassFlower;
      wallColor = '#2a6a3a';
      break;
    case 2: // Lobby
      primaryTile = tiles.marble;
      accentTile = tiles.marbleAccent;
      wallColor = '#7a7a8a';
      break;
    case 3: // Elevators
      primaryTile = tiles.metalGrate;
      accentTile = tiles.metalGrate;
      wallColor = '#1a1a2a';
      break;
    default:
      break;
  }

  // Back wall gradient
  const wallGrad = ctx.createLinearGradient(0, 280, 0, playFloorY);
  wallGrad.addColorStop(0, wallColor);
  wallGrad.addColorStop(1, lightenHex(wallColor, 0.2));
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 320, canvasW, 60);

  // Floor: tiled with primary tile, occasionally accent
  if (primaryTile) {
    const tw = primaryTile.width; // 32
    const th = primaryTile.height; // 32
    const startX = -((scrollX % tw) + tw) % tw;
    for (let x = startX; x < canvasW; x += tw) {
      for (let y = playFloorY; y < groundEndY; y += th) {
        // Decide which tile to use (stripe accent every 5th tile row in parking lot)
        let useAccent = false;
        if (zoneIndex === 0) {
          // Parking lot: stripe accent every 4th tile column
          useAccent = (Math.floor((x + scrollX) / tw) % 4 === 0) && y === playFloorY + th * 2;
        } else if (zoneIndex === 1) {
          // Quad: flower every 6th tile
          useAccent = (Math.floor((x + scrollX) / tw) % 7 === 0) && (Math.floor(y / th) % 3 === 0);
        } else if (zoneIndex === 2) {
          // Lobby: accent in checker
          useAccent = ((Math.floor((x + scrollX) / tw) + Math.floor(y / th)) % 4 === 0);
        }
        const tileToUse = useAccent && accentTile ? accentTile : primaryTile;
        ctx.drawImage(tileToUse, Math.floor(x), Math.floor(y));
      }
    }
  }

  // Floor edge highlight (front of play area)
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.15;
  ctx.fillRect(0, playFloorY, canvasW, 1);
  ctx.globalAlpha = 1;
}

/**
 * Draw foreground props (cars, benches, server racks, etc.)
 */
function drawForegroundProps(ctx, tiles, scrollX, canvasW, zoneIndex) {
  const spacing = 220;
  const numProps = Math.ceil(canvasW / spacing) + 2;

  for (let i = -1; i < numProps; i++) {
    const xRaw = i * spacing - scrollX;
    const x = ((xRaw % (canvasW + 500)) + canvasW + 500) % (canvasW + 500) - 250;

    let prop = null;
    let y = 320; // Default y position

    if (zoneIndex === 0) {
      // Parking Lot - cars and streetlights
      const choices = [tiles.carRed, tiles.carBlue, tiles.carYellow, tiles.carWhite, tiles.streetlight];
      prop = choices[Math.abs(Math.floor(i * 3)) % choices.length];
      y = prop === tiles.streetlight ? 260 : 340;
    } else if (zoneIndex === 1) {
      // Quad - benches, trees, hedges
      const choices = [tiles.bench, tiles.tree, tiles.hedge];
      prop = choices[Math.abs(Math.floor(i * 5)) % choices.length];
      if (prop === tiles.tree) y = 280;
      else if (prop === tiles.bench) y = 330;
      else y = 340;
    } else if (zoneIndex === 2) {
      // Lobby - reception desks (sparse)
      if (i % 3 === 0) {
        prop = tiles.receptionDesk;
        y = 300;
      }
    } else if (zoneIndex === 3) {
      // Elevators - server racks and elevator doors
      const choices = [tiles.serverRack, tiles.elevatorDoor];
      prop = choices[Math.abs(Math.floor(i * 7)) % choices.length];
      y = prop === tiles.elevatorDoor ? 240 : 270;
    }

    if (prop) {
      ctx.drawImage(prop, Math.floor(x), y);
    }
  }
}

/**
 * Helper: lighten a hex color (for gradient stops)
 */
function lightenHex(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.min(255, parseInt(c.substring(0, 2), 16) + Math.floor(255 * amount));
  const g = Math.min(255, parseInt(c.substring(2, 4), 16) + Math.floor(255 * amount));
  const b = Math.min(255, parseInt(c.substring(4, 6), 16) + Math.floor(255 * amount));
  return `rgb(${r},${g},${b})`;
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

  // Kill counter (top right - PROMINENT) - Show progress to boss
  if (gameState.debug) {
    const targetKills = gameState.totalEnemyTarget || 18; // From server config
    const killsRemaining = Math.max(0, targetKills - gameState.debug.totalKills);
    const bossActive = !!gameState.boss;
    ctx.fillStyle = bossActive ? '#ff00ff' : (killsRemaining === 0 ? '#00ff00' : '#ff3333');
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.textAlign = 'right';

    if (bossActive) {
      ctx.fillText(`BOSS FIGHT!`, canvasWidth - 10, 30);
    } else {
      ctx.fillText(`KILLS: ${gameState.debug.totalKills}/${targetKills}`, canvasWidth - 10, 30);
    }

    // Show progress text
    if (!bossActive) {
      if (killsRemaining > 0) {
        ctx.fillStyle = '#ffff00';
        ctx.font = 'bold 10px "Press Start 2P", monospace';
        ctx.fillText(`${killsRemaining} to boss`, canvasWidth - 10, 45);
      } else {
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 10px "Press Start 2P", monospace';
        ctx.fillText(`BOSS UNLOCKED!`, canvasWidth - 10, 45);
      }
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
