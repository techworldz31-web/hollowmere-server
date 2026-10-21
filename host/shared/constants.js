// Values shared by the simulation (client + server) and the sprite baker.
// Changing projection numbers here requires re-baking sprites (npm run bake).

export const PROTOCOL_VERSION = 7;

// ---- Isometric projection -------------------------------------------------
// The baker's orthographic camera is pitched 30° down and yawed 45°, which
// projects a 1x1 ground tile to an exact 2:1 diamond (64 x 32 px).
export const TILE_W = 64;
export const TILE_H = 32;
export const CAMERA_PITCH_DEG = 30;
export const PX_PER_UNIT = TILE_W / Math.SQRT2;                                // ground units -> px along the camera's right axis
export const PX_PER_HEIGHT = PX_PER_UNIT * Math.cos(CAMERA_PITCH_DEG * Math.PI / 180); // 1 unit of height -> px on screen

// World (x east/down-right, y south/down-left, z up) -> screen pixels
export function worldToScreen(x, y, z = 0) {
  return {
    x: (x - y) * (TILE_W / 2),
    y: (x + y) * (TILE_H / 2) - z * PX_PER_HEIGHT,
  };
}
export function screenToWorld(sx, sy) {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

// Directions: dir d faces world vector (cos(d*45°), sin(d*45°)).
export const DIRS = 8;
export function dirFromVector(dx, dy) {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

// ---- Simulation -----------------------------------------------------------
export const TICK_RATE = 20;              // authoritative simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 1;          // send a snapshot every N ticks
export const VIEW_RADIUS = 26;            // interest management radius (tiles)
export const MAP_W = 192;
export const MAP_H = 192;
export const MAP_VERSION = 5;          // bump when the overworld layout changes (saved positions are then reset to town)

export const MAX_PLAYERS = 32;

export const TERRAIN = { WATER: 0, SAND: 1, DIRT: 2, GRASS: 3, FOREST: 4, STONE: 5, CAVE: 6, CRYPT: 7, VOID: 8, WOOD: 9, TILE: 10, FARM: 11 };
// ground heights: a plateau step is this many height units (1 unit = one tile's width of height)
export const LEVEL_H = 1.5;
