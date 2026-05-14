/**
 * 16-bit SNES-style tile set for corporate technology campus
 * Tiles are pre-rendered to offscreen canvases for performance
 * Each tile is 32x32 pixels
 */

const TILE_SIZE = 32;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.ctx = c.getContext('2d');
  c.ctx.imageSmoothingEnabled = false; // Crisp pixel art
  return c;
}

function tile(drawFn, size = TILE_SIZE) {
  const c = makeCanvas(size, size);
  drawFn(c.ctx);
  return c;
}

// ============ GROUND TILES ============

function makeAsphalt(ctx) {
  // Dark asphalt base
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, 0, 32, 32);
  // Texture flecks (lighter)
  ctx.fillStyle = '#3a3a40';
  const lightFlecks = [[3, 5], [12, 8], [22, 14], [6, 20], [18, 25], [27, 6], [10, 28]];
  lightFlecks.forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
  // Darker spots
  ctx.fillStyle = '#1a1a1e';
  const darkSpots = [[8, 3], [25, 18], [4, 14], [16, 22], [29, 26], [20, 8]];
  darkSpots.forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
  // Subtle crack
  ctx.fillStyle = '#1f1f23';
  ctx.fillRect(15, 0, 1, 8);
  ctx.fillRect(15, 8, 2, 1);
}

function makeAsphaltStripe(ctx) {
  makeAsphalt(ctx);
  // Yellow parking line
  ctx.fillStyle = '#e8c200';
  ctx.fillRect(0, 14, 32, 4);
  // Highlight
  ctx.fillStyle = '#ffd83a';
  ctx.fillRect(0, 14, 32, 1);
  // Shadow
  ctx.fillStyle = '#a88e00';
  ctx.fillRect(0, 17, 32, 1);
}

function makeGrass(ctx) {
  // Base
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(0, 0, 32, 32);
  // Lighter blades
  ctx.fillStyle = '#5aa05a';
  const blades = [[2, 4], [7, 8], [14, 3], [22, 9], [28, 6], [4, 16], [11, 22], [19, 18], [26, 24], [3, 28], [16, 27], [24, 14]];
  blades.forEach(([x, y]) => ctx.fillRect(x, y, 1, 2));
  // Darker shadow
  ctx.fillStyle = '#3a6a3a';
  const shadows = [[6, 5], [13, 11], [20, 7], [26, 13], [9, 19], [17, 21], [25, 27], [2, 11]];
  shadows.forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
}

function makeGrassFlower(ctx) {
  makeGrass(ctx);
  // Yellow flower at random spot
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(15, 15, 2, 2);
  ctx.fillStyle = '#ff9800';
  ctx.fillRect(15, 15, 1, 1);
  // Petals
  ctx.fillStyle = '#fff9c4';
  ctx.fillRect(14, 15, 1, 1);
  ctx.fillRect(17, 15, 1, 1);
  ctx.fillRect(15, 14, 1, 1);
  ctx.fillRect(15, 17, 1, 1);
}

function makeConcrete(ctx) {
  // Light gray concrete
  ctx.fillStyle = '#a0a0a8';
  ctx.fillRect(0, 0, 32, 32);
  // Pebble texture
  ctx.fillStyle = '#909098';
  const pebbles = [[4, 6], [11, 14], [19, 8], [25, 20], [7, 24], [15, 26], [22, 14], [3, 18]];
  pebbles.forEach(([x, y]) => ctx.fillRect(x, y, 2, 2));
  ctx.fillStyle = '#b0b0b8';
  const highlights = [[5, 7], [12, 15], [20, 9], [26, 21]];
  highlights.forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
  // Subtle grid lines
  ctx.fillStyle = '#808088';
  ctx.fillRect(0, 0, 32, 1);
  ctx.fillRect(0, 0, 1, 32);
}

function makeMarble(ctx) {
  // White marble base
  ctx.fillStyle = '#e8e8f0';
  ctx.fillRect(0, 0, 32, 32);
  // Subtle veins (gray streaks)
  ctx.fillStyle = '#c8c8d0';
  ctx.fillRect(2, 6, 8, 1);
  ctx.fillRect(10, 7, 4, 1);
  ctx.fillRect(18, 14, 6, 1);
  ctx.fillRect(24, 22, 5, 1);
  // Lighter highlights
  ctx.fillStyle = '#f8f8ff';
  ctx.fillRect(5, 11, 6, 1);
  ctx.fillRect(15, 20, 5, 1);
  // Tile borders
  ctx.fillStyle = '#a0a0a8';
  ctx.fillRect(0, 31, 32, 1);
  ctx.fillRect(31, 0, 1, 32);
}

function makeMarbleAccent(ctx) {
  makeMarble(ctx);
  // Decorative inset pattern
  ctx.fillStyle = '#b8b8c8';
  ctx.fillRect(8, 8, 16, 1);
  ctx.fillRect(8, 23, 16, 1);
  ctx.fillRect(8, 8, 1, 16);
  ctx.fillRect(23, 8, 1, 16);
  // Center accent
  ctx.fillStyle = '#9090a8';
  ctx.fillRect(14, 14, 4, 4);
  ctx.fillStyle = '#c8c8e0';
  ctx.fillRect(15, 15, 2, 2);
}

function makeMetalGrate(ctx) {
  // Dark base
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, 0, 32, 32);
  // Metal mesh pattern
  ctx.fillStyle = '#5a5a65';
  for (let i = 0; i < 32; i += 8) {
    ctx.fillRect(i, 0, 1, 32);
    ctx.fillRect(0, i, 32, 1);
  }
  // Highlight on mesh
  ctx.fillStyle = '#7a7a85';
  for (let i = 0; i < 32; i += 8) {
    ctx.fillRect(i, 0, 1, 1);
    ctx.fillRect(i + 1, 0, 1, 1);
  }
  // Rivets at corners
  ctx.fillStyle = '#9090a0';
  ctx.fillRect(1, 1, 2, 2);
  ctx.fillRect(28, 1, 2, 2);
  ctx.fillRect(1, 28, 2, 2);
  ctx.fillRect(28, 28, 2, 2);
  ctx.fillStyle = '#c0c0d0';
  ctx.fillRect(1, 1, 1, 1);
  ctx.fillRect(28, 1, 1, 1);
  ctx.fillRect(1, 28, 1, 1);
  ctx.fillRect(28, 28, 1, 1);
}

// ============ BUILDING / WALL TILES (64x64 for larger structures) ============

function makeOfficeBuilding() {
  return tile((ctx) => {
    // Dark base color
    ctx.fillStyle = '#3a4a5a';
    ctx.fillRect(0, 0, 96, 200);
    // Building outline
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(0, 0, 96, 2);
    ctx.fillRect(0, 0, 2, 200);
    ctx.fillRect(94, 0, 2, 200);
    // Window rows (8 windows wide, multiple rows)
    const winW = 8, winH = 10;
    const gapX = 4, gapY = 6;
    const winColors = ['#fff388', '#88ddff', '#ffd97a', '#bbeeff', '#ccddff'];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 7; col++) {
        const x = 8 + col * (winW + gapX);
        const y = 10 + row * (winH + gapY);
        if (y + winH > 195) break;
        // Window frame
        ctx.fillStyle = '#2a3545';
        ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);
        // Window glass
        const color = winColors[(row + col * 3) % winColors.length];
        ctx.fillStyle = color;
        ctx.fillRect(x, y, winW, winH);
        // Window reflection
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 1, y + 1, 2, 2);
      }
    }
    // Roof line
    ctx.fillStyle = '#252535';
    ctx.fillRect(0, 0, 96, 8);
  }, 96);
}

function makeOfficeBuildingTall() {
  const c = makeCanvas(96, 250);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Dark base
  ctx.fillStyle = '#4a5a6a';
  ctx.fillRect(0, 0, 96, 250);
  // Building edge shadow
  ctx.fillStyle = '#2a3a4a';
  ctx.fillRect(0, 0, 2, 250);
  ctx.fillStyle = '#5a6a7a';
  ctx.fillRect(94, 0, 2, 250);
  // Window rows
  const winW = 6, winH = 8;
  const gapX = 4, gapY = 4;
  const winColors = ['#fff388', '#88ddff', '#ffd97a', '#bbeeff'];
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 9; col++) {
      const x = 6 + col * (winW + gapX);
      const y = 12 + row * (winH + gapY);
      if (y + winH > 245) break;
      ctx.fillStyle = '#1a2a3a';
      ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);
      // Some windows are dark (off)
      const isDark = (row * 7 + col * 13) % 11 < 3;
      const color = isDark ? '#2a3a4a' : winColors[(row + col * 3) % winColors.length];
      ctx.fillStyle = color;
      ctx.fillRect(x, y, winW, winH);
    }
  }
  // Roof crown
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, 96, 6);
  // Antenna
  ctx.fillStyle = '#888';
  ctx.fillRect(46, -8, 2, 14);
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(45, -10, 4, 2);
  return c;
}

function makeBuildingShort() {
  const c = makeCanvas(120, 150);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Modern glass facade - blue/cyan
  ctx.fillStyle = '#5a7a9a';
  ctx.fillRect(0, 0, 120, 150);
  // Glass panel grid - large windows
  ctx.fillStyle = '#1a2a3a';
  // Vertical mullions
  for (let i = 0; i <= 6; i++) {
    ctx.fillRect(i * 20, 0, 2, 150);
  }
  // Horizontal mullions
  for (let i = 0; i <= 5; i++) {
    ctx.fillRect(0, i * 30, 120, 2);
  }
  // Glass panes with reflections
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      const x = col * 20 + 2;
      const y = row * 30 + 2;
      // Glass color varies
      ctx.fillStyle = (row + col) % 2 === 0 ? '#8ac0e0' : '#a0d0e8';
      ctx.fillRect(x, y, 18, 28);
      // Reflection streak
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x + 2, y + 2, 3, 24);
      ctx.globalAlpha = 1;
    }
  }
  // Top trim
  ctx.fillStyle = '#3a4a5a';
  ctx.fillRect(0, 0, 120, 4);
  return c;
}

// ============ MID-GROUND PROPS ============

function makeCar(color) {
  const c = makeCanvas(60, 36);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(2, 32, 56, 3);
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(6, 26, 10, 8);
  ctx.fillRect(44, 26, 10, 8);
  // Wheel rims
  ctx.fillStyle = '#666';
  ctx.fillRect(8, 28, 6, 4);
  ctx.fillRect(46, 28, 6, 4);
  // Car body
  ctx.fillStyle = color;
  ctx.fillRect(2, 16, 56, 12);
  // Cabin
  ctx.fillRect(14, 6, 32, 12);
  // Body outline/shadow
  ctx.fillStyle = darken(color, 0.6);
  ctx.fillRect(2, 26, 56, 2);
  ctx.fillRect(2, 16, 1, 10);
  // Highlight
  ctx.fillStyle = lighten(color, 0.3);
  ctx.fillRect(2, 16, 56, 1);
  // Window (cyan/blue glass)
  ctx.fillStyle = '#88ccee';
  ctx.fillRect(16, 8, 28, 8);
  // Window reflection
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.6;
  ctx.fillRect(18, 9, 4, 1);
  ctx.fillRect(36, 9, 6, 1);
  ctx.globalAlpha = 1;
  // Headlight
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(56, 18, 3, 4);
  // Door handle
  ctx.fillStyle = darken(color, 0.5);
  ctx.fillRect(30, 22, 4, 1);
  return c;
}

function makeBench() {
  const c = makeCanvas(70, 40);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(4, 36, 62, 3);
  // Legs (cast iron)
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(6, 22, 4, 14);
  ctx.fillRect(60, 22, 4, 14);
  // Wooden slats - back
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(4, 4, 62, 6);
  ctx.fillStyle = '#a0703a';
  ctx.fillRect(4, 4, 62, 1);
  // Wooden slats - seat
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(4, 16, 62, 8);
  ctx.fillStyle = '#a0703a';
  ctx.fillRect(4, 16, 62, 1);
  // Slat lines (wood grain)
  ctx.fillStyle = '#603e1e';
  ctx.fillRect(4, 9, 62, 1);
  ctx.fillRect(4, 23, 62, 1);
  return c;
}

function makeHedge() {
  const c = makeCanvas(50, 40);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(2, 36, 46, 3);
  // Hedge body (dark green)
  ctx.fillStyle = '#2a5a2a';
  ctx.fillRect(0, 8, 50, 28);
  // Lighter top texture
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(0, 4, 50, 8);
  // Leaf details
  ctx.fillStyle = '#5aa05a';
  const leaves = [[3, 6], [10, 4], [17, 6], [25, 3], [33, 5], [40, 7], [46, 5]];
  leaves.forEach(([x, y]) => {
    ctx.fillRect(x, y, 3, 3);
    ctx.fillRect(x + 1, y - 1, 1, 1);
  });
  // Dark spots
  ctx.fillStyle = '#1a3a1a';
  ctx.fillRect(8, 18, 2, 2);
  ctx.fillRect(20, 22, 2, 2);
  ctx.fillRect(34, 20, 2, 2);
  ctx.fillRect(42, 26, 2, 2);
  return c;
}

function makeServerRack() {
  const c = makeCanvas(50, 110);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(2, 106, 46, 4);
  // Main rack body (black metal)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, 50, 108);
  // Rack frame highlight
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, 50, 2);
  ctx.fillRect(0, 0, 2, 108);
  ctx.fillRect(48, 0, 2, 108);
  // Server units (each is ~14px tall)
  const unitColors = ['#1a1a24', '#2a2a34', '#1a1a24'];
  for (let i = 0; i < 7; i++) {
    const y = 4 + i * 14;
    // Server panel
    ctx.fillStyle = unitColors[i % unitColors.length];
    ctx.fillRect(4, y, 42, 12);
    // Panel border
    ctx.fillStyle = '#4a4a54';
    ctx.fillRect(4, y, 42, 1);
    // LEDs
    const ledColors = ['#ff3333', '#33ff66', '#33ff66', '#ffcc00'];
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = ledColors[(i + j) % ledColors.length];
      ctx.fillRect(8 + j * 4, y + 4, 2, 2);
    }
    // Display panel
    ctx.fillStyle = '#1a3344';
    ctx.fillRect(28, y + 3, 14, 5);
    // Display text (tiny)
    ctx.fillStyle = '#33ccff';
    ctx.fillRect(30, y + 4, 1, 1);
    ctx.fillRect(32, y + 4, 1, 1);
    ctx.fillRect(34, y + 4, 1, 1);
    ctx.fillRect(36, y + 6, 1, 1);
    ctx.fillRect(38, y + 6, 1, 1);
  }
  return c;
}

function makeStreetlight() {
  const c = makeCanvas(20, 100);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Pole
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(8, 12, 4, 88);
  // Pole highlight
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(8, 12, 1, 88);
  // Base
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(4, 92, 12, 8);
  // Lamp head
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(2, 6, 16, 8);
  ctx.fillStyle = '#5a5a64';
  ctx.fillRect(2, 6, 16, 1);
  // Light source (glowing yellow)
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(4, 8, 12, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(7, 9, 6, 1);
  // Light glow
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(0, 4, 20, 12);
  ctx.globalAlpha = 1;
  return c;
}

function makeReceptionDesk() {
  const c = makeCanvas(140, 80);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(4, 76, 132, 4);
  // Desk base (modern wood/marble)
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(0, 20, 140, 60);
  // Desk top
  ctx.fillStyle = '#e0d0c0';
  ctx.fillRect(0, 0, 140, 22);
  // Top edge
  ctx.fillStyle = '#c0a890';
  ctx.fillRect(0, 20, 140, 2);
  // Top reflection
  ctx.fillStyle = '#fff8e0';
  ctx.fillRect(0, 0, 140, 2);
  // Panel details
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(10, 30, 30, 40);
  ctx.fillRect(55, 30, 30, 40);
  ctx.fillRect(100, 30, 30, 40);
  // Panel highlights
  ctx.fillStyle = '#7a6a5a';
  ctx.fillRect(10, 30, 30, 1);
  ctx.fillRect(55, 30, 30, 1);
  ctx.fillRect(100, 30, 30, 1);
  // Company logo on desk
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(60, 8, 20, 8);
  ctx.fillStyle = '#33ccff';
  ctx.fillRect(62, 10, 2, 4);
  ctx.fillRect(66, 10, 2, 4);
  ctx.fillRect(70, 10, 2, 4);
  ctx.fillRect(74, 10, 2, 4);
  return c;
}

function makeElevatorDoor() {
  const c = makeCanvas(80, 140);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Frame
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, 80, 140);
  // Inner panel (door)
  ctx.fillStyle = '#9090a0';
  ctx.fillRect(6, 6, 68, 128);
  // Door split
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(39, 6, 2, 128);
  // Highlights
  ctx.fillStyle = '#b0b0c0';
  ctx.fillRect(6, 6, 68, 2);
  ctx.fillRect(6, 6, 2, 128);
  ctx.fillRect(39, 6, 2, 2);
  ctx.fillRect(41, 6, 2, 2);
  // Button panel
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(75, 50, 10, 20);
  ctx.fillStyle = '#33ff66';
  ctx.fillRect(78, 54, 3, 3);
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(78, 60, 3, 3);
  // Floor indicator
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(28, 0, 24, 6);
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(34, 2, 12, 2);
  return c;
}

function makeCloud() {
  const c = makeCanvas(80, 30);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Cloud body (lots of overlapping rectangles for pixelated cloud)
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.fillRect(10, 10, 60, 14);
  ctx.fillRect(20, 4, 30, 22);
  ctx.fillRect(5, 14, 70, 8);
  ctx.fillRect(15, 8, 50, 18);
  // Shadow
  ctx.fillStyle = '#e0e0e8';
  ctx.fillRect(10, 22, 60, 2);
  ctx.fillRect(5, 20, 70, 2);
  ctx.globalAlpha = 1;
  return c;
}

function makeTree() {
  const c = makeCanvas(60, 100);
  const ctx = c.ctx;
  ctx.imageSmoothingEnabled = false;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(8, 95, 44, 4);
  // Trunk
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(26, 60, 10, 36);
  // Trunk highlight
  ctx.fillStyle = '#7a5a2a';
  ctx.fillRect(26, 60, 2, 36);
  // Foliage - bottom layer
  ctx.fillStyle = '#2a5a2a';
  ctx.fillRect(0, 40, 60, 30);
  // Foliage - middle layer
  ctx.fillStyle = '#3a7a3a';
  ctx.fillRect(6, 20, 48, 28);
  // Foliage - top layer
  ctx.fillStyle = '#4a8a4a';
  ctx.fillRect(14, 4, 32, 20);
  // Light reflections
  ctx.fillStyle = '#5aa05a';
  ctx.fillRect(16, 4, 8, 4);
  ctx.fillRect(20, 22, 6, 4);
  ctx.fillRect(8, 42, 10, 4);
  return c;
}

// ============ HELPERS ============

function darken(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.floor(parseInt(c.substring(0, 2), 16) * amount);
  const g = Math.floor(parseInt(c.substring(2, 4), 16) * amount);
  const b = Math.floor(parseInt(c.substring(4, 6), 16) * amount);
  return `rgb(${r},${g},${b})`;
}

function lighten(hex, amount) {
  const c = hex.replace('#', '');
  const r = Math.min(255, parseInt(c.substring(0, 2), 16) + Math.floor(255 * amount));
  const g = Math.min(255, parseInt(c.substring(2, 4), 16) + Math.floor(255 * amount));
  const b = Math.min(255, parseInt(c.substring(4, 6), 16) + Math.floor(255 * amount));
  return `rgb(${r},${g},${b})`;
}

// ============ TILESET EXPORT ============

let _tileset = null;

export function getTileset() {
  if (_tileset) return _tileset;

  _tileset = {
    // Ground tiles (32x32)
    asphalt: tile(makeAsphalt),
    asphaltStripe: tile(makeAsphaltStripe),
    grass: tile(makeGrass),
    grassFlower: tile(makeGrassFlower),
    concrete: tile(makeConcrete),
    marble: tile(makeMarble),
    marbleAccent: tile(makeMarbleAccent),
    metalGrate: tile(makeMetalGrate),
    // Buildings (various sizes)
    officeBuilding: makeOfficeBuilding(),
    officeBuildingTall: makeOfficeBuildingTall(),
    buildingShort: makeBuildingShort(),
    // Props
    carRed: makeCar('#cc3333'),
    carBlue: makeCar('#3344cc'),
    carYellow: makeCar('#ccaa33'),
    carWhite: makeCar('#ddddee'),
    bench: makeBench(),
    hedge: makeHedge(),
    serverRack: makeServerRack(),
    streetlight: makeStreetlight(),
    receptionDesk: makeReceptionDesk(),
    elevatorDoor: makeElevatorDoor(),
    cloud: makeCloud(),
    tree: makeTree()
  };

  return _tileset;
}

// Helper to fill an area with a tile (for ground rendering)
export function fillTiled(ctx, tile, x, y, w, h, scrollX = 0) {
  if (!tile) return;
  const tw = tile.width;
  const th = tile.height;
  // Offset for seamless scrolling
  const startX = x - ((scrollX % tw) + tw) % tw;
  for (let tx = startX; tx < x + w; tx += tw) {
    for (let ty = y; ty < y + h; ty += th) {
      ctx.drawImage(tile, Math.floor(tx), Math.floor(ty));
    }
  }
}

export default { getTileset, fillTiled };
