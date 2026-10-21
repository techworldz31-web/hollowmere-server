// The edges of the world, and the scenery that carries on past them.
//
// The overworld is closed in by things you can see but not cross: the sea along the west and
// south coasts, a mountain range along the north (the river comes down through a gorge in it),
// and deep forest along the east. The map generator builds the part of each that lies inside the
// map; buildRim() (client only) carries them on past the edge, so looking out from the shore,
// the foothills or the forest's edge you see more sea, rising peaks and trees rather than the
// end of the world.
import { fbm, hash2 } from './rng.js';
import { TERRAIN } from './constants.js';

export const RIM = 56;                 // tiles of scenery drawn past each edge
const RIVER_X = 78.5;                  // where the river comes in under the mountains

const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// signed distance (tiles) to the coast: below 0 is the sea
export function seaDist(x, y, seed) {
  const west = 6 + fbm(y / 13, 3.7, seed + 400, 3) * 5;          // the west shore wanders between about x 6 and 11
  const south = 184.5 + (fbm(x / 12, 8.1, seed + 401, 3) - 0.5) * 5;
  return Math.min(x - west, south - y);
}

// how much the mountains raise the ground at a corner (0 away from the north edge)
export function mountainH(x, y, seed) {
  const foot = 11 + (fbm(x / 14, 1.3, seed + 410, 2) - 0.5) * 6;  // where the foothills begin
  const t = foot - y;
  if (t <= 0) return 0;
  // they fall away towards the west coast and open into a gorge where the river comes through
  const mask = sm(14, 26, x) * sm(3.5, 9, Math.abs(x - RIVER_X));
  if (mask <= 0) return 0;
  const rise = 17 * (1 - Math.exp(-Math.pow(t / 15, 1.6)));
  const ridge = 1 - Math.abs(fbm(x / 7, y / 7, seed + 420, 3) * 2 - 1);   // knife-edge ridges and gullies
  return mask * rise * (0.75 + ridge * 0.5);
}

// ---------------------------------------------------------------- the scenery past the edge (client)
const TREE_KINDS = (x, y, seed) => {
  const p = fbm(x / 10, y / 10, seed + 21, 2);
  if (p > 0.5) return 'pine';
  const m = fbm(x / 8, y / 8, seed + 31, 2);
  return m > 0.63 ? 'maple' : m < 0.36 ? 'birch' : 'oak';
};

// -> { pad, w1, height (corner heights of the whole padded area), objects (decor past the edge) }
export function buildRim(map, OBJECTS) {
  const seed = map.seed, W = map.w, H = map.h, P = RIM, W1 = W + 1, w1 = W + 2 * P + 1, h1 = H + 2 * P + 1;
  const inner = map.height || new Float32Array(W1 * (H + 1));
  const height = new Float32Array(w1 * h1);
  for (let Y = -P; Y <= H + P; Y++) for (let X = -P; X <= W + P; X++) {
    const cx = Math.max(0, Math.min(W, X)), cy = Math.max(0, Math.min(H, Y));
    let h = inner[cy * W1 + cx];
    if (cx !== X || cy !== Y) {
      // past the edge: the edge's own ground, with the mountains carrying on rising
      h += mountainH(X, Y, seed) - mountainH(cx, cy, seed);
      // the sea floor dips a little further out (nothing shows it but the shoreline staying put)
    }
    height[(Y + P) * w1 + X + P] = h;
  }
  // trees and rocks past the edge, wherever the edge itself is land
  const objects = [], taken = new Set();
  const terr = (x, y) => map.terrain[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  for (let Y = -P; Y < H + P; Y++) for (let X = -P; X < W + P; X++) {
    if (X >= 0 && Y >= 0 && X < W && Y < H) continue;
    const t = terr(X, Y);
    if (t === TERRAIN.WATER || t === TERRAIN.SAND) continue;
    const r = hash2(X, Y, seed + 500), r2 = hash2(X, Y, seed + 501);
    const mh = mountainH(X, Y, seed) - mountainH(Math.max(0, Math.min(W, X)), Math.max(0, Math.min(H, Y)), seed) + (map.height ? inner[Math.max(0, Math.min(H, Y)) * W1 + Math.max(0, Math.min(W, X))] : 0);
    let kind = null;
    if (mh > 7.5) continue;                                         // bare rock and snow up high
    if (mh > 1.2) { if (r < 0.1 * (1 - mh / 8)) kind = 'pine'; else if (r < 0.14) kind = 'rock'; }
    else if (r < 0.62) kind = TREE_KINDS(X, Y, seed);
    else if (r < 0.66) kind = 'bush';
    if (!kind) continue;
    // trees keep a little room (the canopies still close over)
    if (kind !== 'rock' && kind !== 'bush' && (taken.has((Y - 1) * 4096 + X) || taken.has(Y * 4096 + X - 1) || taken.has((Y - 1) * 4096 + X - 1))) continue;
    taken.add(Y * 4096 + X);
    const def = OBJECTS[kind];
    objects.push({ kind, tx: X, ty: Y, x: X + 0.5, y: Y + 0.5, sprite: def.sprites[Math.floor(r2 * 6) % def.sprites.length], rim: true });
  }
  return { pad: P, w1, h1, height, objects };
}

// ground height anywhere, the padded area included (same triangle split as shared/ground.js)
export function rimGroundAt(map, x, y) {
  const R = map.rim, P = R.pad, w1 = R.w1, H = R.height;
  let gx = x + P, gy = y + P;
  gx = Math.max(0, Math.min(w1 - 1 - 1e-4, gx)); gy = Math.max(0, Math.min(R.h1 - 1 - 1e-4, gy));
  const tx = Math.floor(gx), ty = Math.floor(gy), fx = gx - tx, fy = gy - ty, i = ty * w1 + tx;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + w1], h11 = H[i + w1 + 1];
  return fx >= fy ? h00 + fx * (h10 - h00) + fy * (h11 - h10) : h00 + fy * (h01 - h00) + fx * (h11 - h01);
}
