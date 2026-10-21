// Grid A* (8-way, no corner cutting) + line-of-sight smoothing.

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function isBlocked(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
  return map.solid[y * map.w + x] === 1;
}

// Walkable straight line between two world points (samples along the segment
// with a small body radius).
export function lineClear(map, ax, ay, bx, by, radius = 0.25) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (isBlocked(map, Math.floor(x - radius), Math.floor(y - radius)) ||
        isBlocked(map, Math.floor(x + radius), Math.floor(y - radius)) ||
        isBlocked(map, Math.floor(x - radius), Math.floor(y + radius)) ||
        isBlocked(map, Math.floor(x + radius), Math.floor(y + radius))) return false;
  }
  return true;
}

// Returns an array of world-space waypoints (tile centers), or null.
// cost (optional): (x, y) -> step cost multiplier >= 1 (long walks use it to keep to the roads)
export function findPath(map, sx, sy, gx, gy, maxNodes = 6000, cost = null) {
  let tx = Math.floor(gx), ty = Math.floor(gy);
  const ox = Math.floor(sx), oy = Math.floor(sy);
  if (isBlocked(map, tx, ty)) {
    // retarget to the nearest open tile around the goal
    let best = null, bd = Infinity;
    for (let r = 1; r <= 3 && !best; r++) for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (isBlocked(map, x, y)) continue;
      const d = Math.hypot(x - ox, y - oy) * 0.1 + Math.hypot(x - tx, y - ty);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) return null;
    [tx, ty] = best; gx = tx + 0.5; gy = ty + 0.5;
  }
  if (ox === tx && oy === ty) return [{ x: gx, y: gy }];

  const W = map.w;
  const key = (x, y) => y * W + x;
  const open = new MinHeap();
  const g = new Map(), came = new Map(), closed = new Set();
  const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  g.set(key(ox, oy), 0);
  open.push({ x: ox, y: oy, f: h(ox, oy) });
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.x === tx && cur.y === ty) {
      const tiles = [];
      let k = ck;
      while (k !== undefined) { tiles.push({ x: (k % W) + 0.5, y: Math.floor(k / W) + 0.5 }); k = came.get(k); }
      tiles.reverse();
      tiles[tiles.length - 1] = { x: gx, y: gy };
      return smoothPath(map, sx, sy, tiles, cost ? 5 : Infinity);
    }
    if (++expanded > maxNodes) return null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cur.x + dx, ny = cur.y + dy;
      if (isBlocked(map, nx, ny)) continue;
      if (dx && dy && (isBlocked(map, cur.x + dx, cur.y) || isBlocked(map, cur.x, cur.y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = g.get(ck) + (dx && dy ? 1.414 : 1) * (cost ? cost(nx, ny) : 1);
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); open.push({ x: nx, y: ny, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}

function smoothPath(map, sx, sy, pts, reach = Infinity) {
  const out = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + reach);
    // shortcuts must clear walls by more than the walker's body (0.28), or it snags on corners
    while (j > i && !lineClear(map, ax, ay, pts[j].x, pts[j].y, 0.34)) j--;
    out.push(pts[j]);
    ax = pts[j].x; ay = pts[j].y; i = j + 1;
  }
  return out;
}
