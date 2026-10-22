// How the wild animals get about. Like the wildlife in most open-world games, they don't use the
// same blocky tile grid as people do:
//  - bushes, stumps, small rocks, logs, fences and hay are things a deer hops over or pushes
//    through, so they don't block an animal at all;
//  - a tree is only its trunk (a small circle in the middle of its tile), so animals weave between
//    the trees of a wood instead of treating the forest as a wall;
//  - water, cliffs, buildings and walls still stop them.
// They steer rather than march tile by tile: each step they look along a fan of "whiskers" and take
// the clearest way toward where they want to go, keeping to one side round an obstacle so they don't
// dither. When something big is in the way (a lake, a cliff) they plan a route round it first (A*
// over the animal's own grid). A fleeing animal scores sixteen headings by how far it can run that
// way and how far it takes it from you, and bolts down the best.
import { OBJECTS } from './content.js';
import { findPath, lineClear } from './pathfind.js';
import { dirFromVector, TICK_RATE } from './constants.js';

const SOFT = new Set(['bush', 'stump', 'rock', 'rockpile', 'logs', 'fence_x', 'fence_y', 'hay', 'beam', 'crate', 'barrel', 'scarecrow']);
const TREES = new Set(['oak', 'pine', 'birch', 'maple', 'willow']);
const BODY = 0.3, TRUNK = 0.28;

// the animals' map: .solid has only what really stops them (so findPath and lineClear work on it),
// .trunk marks the tiles with a tree trunk in the middle
export function buildWildNav(map) {
  const W = map.w, H = map.h, solid = new Uint8Array(map.solid), trunk = new Uint8Array(W * H);
  for (const o of map.objects || []) {
    const d = OBJECTS[o.kind]; if (!d?.solid) continue;
    const tree = TREES.has(o.kind); if (!tree && !SOFT.has(o.kind)) continue;
    const [fw, fh] = d.foot;
    for (let y = o.ty; y < o.ty + fh; y++) for (let x = o.tx; x < o.tx + fw; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      solid[y * W + x] = 0; if (tree) trunk[y * W + x] = 1;
    }
  }
  return { w: W, h: H, solid, trunk };
}

// can an animal stand here?
export function wildFree(nav, x, y) {
  const W = nav.w;
  for (const ox of [-BODY, BODY]) for (const oy of [-BODY, BODY]) {
    const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
    if (tx < 0 || ty < 0 || tx >= W || ty >= nav.h || nav.solid[ty * W + tx]) return false;
  }
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
    if (xx < 0 || yy < 0 || xx >= W || yy >= nav.h || !nav.trunk[yy * W + xx]) continue;
    if (Math.hypot(x - xx - 0.5, y - yy - 0.5) < TRUNK + BODY) return false;
  }
  return true;
}

// how far straight ahead is clear (up to max)
export function wildRay(nav, x, y, ux, uy, max) {
  for (let d = 0.25; d <= max + 1e-6; d += 0.25) if (!wildFree(nav, x + ux * d, y + uy * d)) return d - 0.25;
  return max;
}

const TURNS = [0.35, 0.7, 1.05, 1.4, 1.75, 2.2];
// one step of `dist` toward (gx, gy): straight on if the way is clear, else the nearest clear whisker,
// turning the same way as last time so it rounds an obstacle instead of swinging back and forth
export function wildStep(nav, e, gx, gy, dist) {
  const dx = gx - e.x, dy = gy - e.y, d = Math.hypot(dx, dy);
  if (d < 1e-3) return false;
  const step = Math.min(dist, d), base = Math.atan2(dy, dx), side = e.side || 1;
  const look = Math.min(0.9, d);
  const go = (a, need) => {
    const ux = Math.cos(a), uy = Math.sin(a);
    if (wildRay(nav, e.x, e.y, ux, uy, need) < need - 1e-6 || !wildFree(nav, e.x + ux * step, e.y + uy * step)) return false;
    e.x += ux * step; e.y += uy * step; e.dir = dirFromVector(ux, uy); return true;
  };
  if (go(base, look)) { e.side = side; return true; }
  for (const t of TURNS) for (const s of [side, -side]) if (go(base + t * s, Math.min(0.6, look))) { e.side = s; return true; }
  return false;
}

// walk toward a goal, planning round big obstacles: -> 'walk', 'done' or 'stuck'
export function wildGo(w, nav, e, gx, gy, dist) {
  if (Math.hypot(gx - e.x, gy - e.y) < 0.35) { e.wpath = null; return 'done'; }
  if (!e.wpath || e.wgoalKey !== `${gx},${gy}`) {
    e.wgoalKey = `${gx},${gy}`; e.wpath = null; e.wprog = { d: Infinity, at: w.tick };
    if (!lineClear(nav, e.x, e.y, gx, gy, BODY)) { e.wpath = findPath(nav, e.x, e.y, gx, gy, 2500); if (!e.wpath) return 'stuck'; }
    else e.wpath = [{ x: gx, y: gy }];
  }
  let wp = e.wpath[0];
  if (Math.hypot(wp.x - e.x, wp.y - e.y) < 0.4 && e.wpath.length > 1) { e.wpath.shift(); wp = e.wpath[0]; e.wprog = { d: Infinity, at: w.tick }; }
  const moved = wildStep(nav, e, wp.x, wp.y, dist);
  // no headway for a couple of seconds: give up on this goal
  const dd = Math.hypot(wp.x - e.x, wp.y - e.y);
  if (dd < e.wprog.d - 0.3) e.wprog = { d: dd, at: w.tick };
  else if (w.tick - e.wprog.at > TICK_RATE * 2.5) { e.wpath = null; return 'stuck'; }
  return moved ? 'walk' : 'stuck';
}
