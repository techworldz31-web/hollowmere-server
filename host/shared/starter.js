// Tutorial Island: the starting island (levels 1-5). Every new hero gets their own copy (an
// instance, like the Hollow Deep): nobody else can see them, or be seen, until they take the
// ferry to Hollowmere. Like the other maps it is built from a seed, so the server sends one
// number and every client rebuilds the same island.
//
// The story: the hero's ship ran onto the rocks in a storm. They wake on the beach by the
// wreck; the survivors have made camp inland under Captain Harlan. The isle has tide-pool
// slimes, young wolves in the pinewood and a goblin scouting party camped on the north bluff.
// The ferryman's boat at the jetty takes the hero across to Hollowmere.
import { TERRAIN } from './constants.js';
import { OBJECTS } from './content.js';
import { mulberry32 } from './rng.js';

export const STARTER_SIZE = 60;
export const STARTER_NAME = 'Tutorial Island';

export function generateStarter(seed = 1) {
  const W = STARTER_SIZE, H = STARTER_SIZE;
  const rand = mulberry32((seed | 0) * 2654435761 + 977);
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const terrain = new Uint8Array(W * H).fill(TERRAIN.WATER);
  const solid = new Uint8Array(W * H).fill(1);
  const occupied = new Uint8Array(W * H);
  const pathMask = new Uint8Array(W * H);          // walkways stay clear of props
  const objects = [];

  // ---- the island's shape: a lumpy disc, wobbling a little with the seed -------------------
  const C = { x: 30, y: 29 };
  const lumps = Array.from({ length: 6 }, (_, k) => ({ a: rand() * Math.PI * 2, f: k + 2, amp: 0.8 + rand() * 1.4 }));
  const radius = (a) => 22 + lumps.reduce((s, l) => s + Math.sin(a * l.f + l.a) * l.amp, 0) * 0.55;
  const edgeDist = (x, y) => radius(Math.atan2(y - C.y, x - C.x)) - Math.hypot(x - C.x, y - C.y);   // > 0 on land
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = edgeDist(x + 0.5, y + 0.5), i = idx(x, y);
    if (d <= 0) continue;
    terrain[i] = d < 3.2 ? TERRAIN.SAND : TERRAIN.GRASS;
    solid[i] = 0;
  }

  // ---- places ------------------------------------------------------------------------------
  // (iso view: +x and +y both run down the screen, so the south-east beach is at the bottom)
  // every place is put relative to the coast, so it lands right whatever shape the seed gave
  const along = (ang, fromEdge) => { const r = radius(ang) - fromEdge; return { x: C.x + Math.cos(ang) * r, y: C.y + Math.sin(ang) * r }; };
  const SE = Math.PI / 4, SW = Math.PI * 0.72, E = 0.05, N = -Math.PI / 2 - 0.25, Wd = Math.PI + 0.1;
  const A = {
    spawn: along(SE, 4.2),               // the beach by the wreck
    wreck: along(SE, 2.0),
    camp: { x: C.x + 1, y: C.y + 3 },     // the survivors' camp
    captain: { x: C.x + 1.5, y: C.y + 1.5 },
    pools: along(E, 4.5),                // tide pools on the east shore: slimes
    woods: along(Wd, 9),                 // the pinewood, west: young wolves
    goblins: along(N, 7),                // the goblin scouts' camp on the north bluff
    jetty: along(SW, 1.2),               // the ferry jetty on the south-west shore
    ferry: along(SW, -5.2),
    ferryman: along(SW + 0.12, 3.2),
    cook: { x: C.x - 1.5, y: C.y + 2 },  // Mira the ship's cook, across the fire from the captain
    cove: along(SE + 0.62, 3.6),         // the south beach where the ship's stores washed up: skitterers
    den: along(Wd - 0.42, 6.5),          // the wolves' den at the far edge of the pinewood
  };
  A.sailor1 = { x: A.camp.x - 1.5, y: A.camp.y + 2.5 }; A.sailor2 = { x: A.camp.x + 1.5, y: A.camp.y + 0.5 };   // the wounded, by the fire
  A.lookout = { x: A.camp.x + (A.goblins.x - A.camp.x) * 0.55, y: A.camp.y + (A.goblins.y - A.camp.y) * 0.55 };
  for (const k of Object.keys(A)) { A[k].x = Math.floor(A[k].x) + 0.5; A[k].y = Math.floor(A[k].y) + 0.5; }
  const near = (p, r) => (x, y) => Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < r;

  // the pinewood: forest ground
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (terrain[i] === TERRAIN.GRASS && Math.hypot(x - A.woods.x, (y - A.woods.y) * 0.8) < 10 + rand() * 1.5) terrain[i] = TERRAIN.FOREST;
  }
  // the goblins' bluff: trampled dirt
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (!solid[i] && Math.hypot(x - A.goblins.x, y - A.goblins.y) < 6.5) terrain[i] = TERRAIN.DIRT;
  }

  // ---- the jetty: planks out over the water ---------------------------------------------------
  {
    const n = Math.ceil(Math.hypot(A.ferry.x - A.jetty.x, A.ferry.y - A.jetty.y) * 2);
    for (let k = 0; k <= n; k++) {
      const t = k / n, X = A.jetty.x + (A.ferry.x - A.jetty.x) * t, Y = A.jetty.y + (A.ferry.y - A.jetty.y) * t;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const x = Math.floor(X) + ox, y = Math.floor(Y) + oy;
        if (inside(x, y) && terrain[idx(x, y)] === TERRAIN.WATER) { terrain[idx(x, y)] = TERRAIN.WOOD; solid[idx(x, y)] = 0; }
      }
    }
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = Math.floor(A.ferry.x) + dx, y = Math.floor(A.ferry.y) + dy;
    if (inside(x, y) && terrain[idx(x, y)] === TERRAIN.WATER) { terrain[idx(x, y)] = TERRAIN.WOOD; solid[idx(x, y)] = 0; }
  }

  // ---- paths between the places (dirt, two tiles wide) ----------------------------------------
  const path = (a, b) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    const bend = (rand() - 0.5) * 6;
    for (let s = 0; s <= n; s++) {
      const t = s / n, mx = a.x + (b.x - a.x) * t + Math.sin(t * Math.PI) * bend * 0.5, my = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * bend * 0.3;
      for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
        const x = Math.floor(mx) + ox, y = Math.floor(my) + oy;
        if (!inside(x, y) || solid[idx(x, y)] && terrain[idx(x, y)] === TERRAIN.WATER) continue;
        pathMask[idx(x, y)] = 1;
        if (terrain[idx(x, y)] !== TERRAIN.WOOD) terrain[idx(x, y)] = terrain[idx(x, y)] === TERRAIN.SAND ? TERRAIN.SAND : TERRAIN.DIRT;
      }
    }
  };
  path(A.spawn, A.camp); path(A.camp, A.pools); path(A.camp, A.woods); path(A.woods, A.goblins); path(A.camp, A.goblins); path(A.camp, A.jetty); path(A.camp, A.cove); path(A.woods, A.den);
  // the camps themselves are open ground round the fire, not a crossroads
  for (const c of [A.camp, A.goblins]) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) < 2.6) pathMask[idx(x, y)] = 0;
  const onPath = (x, y) => pathMask[idx(x, y)] === 1 || terrain[idx(x, y)] === TERRAIN.WOOD;

  // ---- placing things ------------------------------------------------------------------------
  let force = false;     // camp furniture may stand on the trampled ground the walkways start from
  const free = (x, y, fw = 1, fh = 1) => {
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      const X = x + i, Y = y + j;
      if (!inside(X, Y) || solid[idx(X, Y)] || occupied[idx(X, Y)] || (!force && onPath(X, Y))) return false;
    }
    return true;
  };
  const place = (kind, tx, ty, variant) => {
    const def = OBJECTS[kind], [fw, fh] = def.foot || [1, 1];
    if (!free(tx, ty, fw, fh)) return false;
    objects.push({ kind, tx, ty, x: tx + fw / 2, y: ty + fh / 2, sprite: def.sprites[(variant ?? Math.floor(rand() * def.sprites.length)) % def.sprites.length] });
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      occupied[idx(tx + i, ty + j)] = 1;
      if (def.solid) solid[idx(tx + i, ty + j)] = 1;
    }
    return true;
  };
  const keepClear = (p, r) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < r) occupied[idx(x, y)] = 1; };
  const release = (p, r) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < r && !solid[idx(x, y)]) occupied[idx(x, y)] = 0; };

  // the survivors' camp: three tents round a fire, stores, lamps, the captain's banner
  keepClear(A.spawn, 2.2); keepClear(A.captain, 1.6); keepClear(A.ferryman, 1.2); keepClear(A.ferry, 1.6); keepClear(A.cook, 1.2); keepClear(A.lookout, 1.4); keepClear(A.sailor1, 0.9); keepClear(A.sailor2, 0.9);
  force = true;
  const cx = Math.floor(A.camp.x), cy = Math.floor(A.camp.y);
  place('campfire', cx, cy + 1);
  place('tent', cx - 5, cy - 3); place('tent', cx + 3, cy - 4); place('tent', cx - 4, cy + 3);
  place('logs', cx - 2, cy + 3); place('logs', cx + 2, cy + 2);
  for (const [x, y, k] of [[cx + 4, cy, 'crate'], [cx + 5, cy, 'crate'], [cx + 4, cy + 1, 'barrel'], [cx - 6, cy, 'barrel'], [cx - 6, cy + 1, 'crate'], [cx + 1, cy - 4, 'banner'], [cx - 2, cy - 3, 'lamp'], [cx + 3, cy + 4, 'lamp'], [cx - 1, cy + 6, 'signpost'], [cx + 6, cy - 2, 'cart']]) place(k, x, y);
  // the wreck on the beach: broken beams, spilled cargo
  const wx = Math.floor(A.wreck.x), wy = Math.floor(A.wreck.y);
  // the ship itself lies broken at the water's edge (its hull blocks the way; the rigging doesn't)
  const ship = along(SE, 0.3);
  objects.push({ kind: 'shipwreck', tx: Math.floor(ship.x), ty: Math.floor(ship.y), x: Math.floor(ship.x) + 0.5, y: Math.floor(ship.y) + 0.5, sprite: 'shipwreck' });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x + 0.5 - ship.x, y + 0.5 - ship.y); if (d < 2.5) solid[idx(x, y)] = 1; if (d < 4.2) occupied[idx(x, y)] = 1; }
  // timbers torn off it still burn on the sand; cargo is strewn up the beach
  // what the sea is still giving back: crates and barrels bobbing in the shallows along the shore
  { let n = 0;
    for (let t = 0; t < 600 && n < 7; t++) {
      const x = Math.floor(ship.x + (rand() - 0.5) * 22), y = Math.floor(ship.y + (rand() - 0.5) * 22);
      if (!inside(x, y) || terrain[idx(x, y)] !== TERRAIN.WATER) continue;
      const d = edgeDist(x + 0.5, y + 0.5);
      if (d > -0.9 || d < -3.2 || objects.some((o) => o.kind.startsWith('flot_') && Math.hypot(o.x - x, o.y - y) < 2.5)) continue;
      const k = rand() < 0.5 ? 'flot_crate' : 'flot_barrel';
      objects.push({ kind: k, tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: k === 'flot_crate' ? 'crate' : 'barrel' }); n++;
    } }
  // (round the hull at a few steps' distance, never on the way up from the beach)
  const debris = ['burning_beam', 'crate', 'barrel', 'burning_beam', 'crate', 'barrel', 'beam', 'rockpile'];
  let di = 0;
  for (let t = 0; t < 400 && di < debris.length; t++) {
    const a = rand() * Math.PI * 2, d = 4.4 + rand() * 2.2;
    const x = Math.floor(ship.x + Math.cos(a) * d), y = Math.floor(ship.y + Math.sin(a) * d);
    if (!inside(x, y) || terrain[idx(x, y)] === TERRAIN.WATER || Math.hypot(x + 0.5 - A.spawn.x, y + 0.5 - A.spawn.y) < 2.4) continue;
    if (objects.some((o) => (o.kind === 'burning_beam' || o.kind === 'crate' || o.kind === 'barrel') && Math.hypot(o.x - x, o.y - y) < 1.8)) continue;
    if (place(debris[di], x, y)) di++;
  }
  // the goblin scouts' camp
  const gx = Math.floor(A.goblins.x), gy = Math.floor(A.goblins.y);
  place('campfire', gx, gy); place('tent', gx - 4, gy - 3); place('tent', gx + 2, gy - 4);
  for (const [x, y, k] of [[gx + 3, gy + 1, 'crate'], [gx + 4, gy + 1, 'crate'], [gx - 3, gy + 2, 'cart'], [gx - 4, gy, 'rockpile'], [gx + 1, gy + 3, 'logs'], [gx - 1, gy - 4, 'banner']]) place(k, x, y);
  // the jetty: the ferryman's lamp and his crates
  place('lamp', Math.floor(A.jetty.x) + 2, Math.floor(A.jetty.y) - 1); place('crate', Math.floor(A.jetty.x) + 3, Math.floor(A.jetty.y));
  place('barrel', Math.floor(A.jetty.x) + 3, Math.floor(A.jetty.y) + 1);

  force = false;
  // trees: thick in the pinewood, scattered elsewhere; rocks and shells on the beach; flowers
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y); if (solid[i]) continue;
    const t = terrain[i], r = rand();
    if (Math.hypot(x - A.camp.x, y - A.camp.y) < 7.5 || Math.hypot(x - A.goblins.x, y - A.goblins.y) < 6 || Math.hypot(x - A.pools.x, y - A.pools.y) < 5) {
      if (t === TERRAIN.GRASS && r < 0.05) place(rand() < 0.5 ? 'tuft' : 'flowers', x, y);
      continue;
    }
    if (t === TERRAIN.FOREST) {
      if (r < 0.2) place(rand() < 0.65 ? 'pine' : 'oak', x, y);
      else if (r < 0.28) place('fern', x, y);
      else if (r < 0.31) place('bush', x, y);
      else if (r < 0.32) place('stump', x, y);
    } else if (t === TERRAIN.GRASS) {
      if (r < 0.055) place(rand() < 0.5 ? 'oak' : 'birch', x, y);
      else if (r < 0.075) place('bush', x, y);
      else if (r < 0.14) place('tuft', x, y);
      else if (r < 0.2) place('flowers', x, y);
      else if (r < 0.215) place('rock', x, y);
    } else if (t === TERRAIN.SAND) {
      if (r < 0.03) place('rock', x, y);
    }
  }
  // reeds and lilies where the sea is shallow
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y); if (terrain[i] !== TERRAIN.WATER) continue;
    const d = edgeDist(x + 0.5, y + 0.5);
    if (d > -1.6 && rand() < 0.18) objects.push({ kind: 'reeds', tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: OBJECTS.reeds.sprites[Math.floor(rand() * 2)] });
    else if (d > -3 && d < -1.4 && rand() < 0.06) objects.push({ kind: 'lily', tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: OBJECTS.lily.sprites[Math.floor(rand() * 3)] });
  }
  release(A.spawn, 2.2);

  // ---- monsters (the island's own: weaker cousins of the mainland's) ----------------------------
  // monsters stand apart, like on the mainland, so a fight pulls one or two rather than a crowd
  const placed = [];
  const spot = (p, r, gap = 3.4) => {
    for (let t = 0; t < 400; t++) {
      const g = t < 300 ? gap : gap * 0.6;          // squeeze a little only if there's no room
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!inside(tx, ty) || solid[idx(tx, ty)]) continue;
      const c = { x: tx + 0.5, y: ty + 0.5 };
      if (placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < g)) continue;
      placed.push(c); return c;
    }
    return { x: p.x, y: p.y };
  };
  const spawns = {
    alpha: [{ kind: 'pinewood_alpha', ...spot(A.den, 1.5, 0) }, ...Array.from({ length: 2 }, () => ({ kind: 'young_wolf', ...spot(A.den, 5, 4.5) }))],
    goblins: [{ kind: 'scout_leader', ...(placed.push({ x: A.goblins.x + 0.5, y: A.goblins.y - 1.5 }), placed[placed.length - 1]) }, ...Array.from({ length: 6 }, () => ({ kind: 'goblin_scout', ...spot(A.goblins, 8, 4) }))],
    slimes: Array.from({ length: 7 }, () => ({ kind: 'tide_slime', ...spot(A.pools, 7) })),
    crabs: Array.from({ length: 6 }, () => ({ kind: 'sand_skitterer', ...spot(A.cove, 7) })),
    wolves: Array.from({ length: 7 }, () => ({ kind: 'young_wolf', ...spot(A.woods, 9, 4) })),
  };

  return {
    seed, w: W, h: H, terrain, solid, objects, spawns: [], npcs: [], playerSpawn: A.spawn, slow: null,
    landmarks: {}, indoor: false, starter: { name: STARTER_NAME, areas: A, mobs: spawns },
  };
}

// the named parts of the isle, for the place name over the minimap
export const STARTER_AREAS = [
  ['The Wreck', 'spawn', 6], ["Survivors' Camp", 'camp', 8], ['The Tide Pools', 'pools', 6], ['The Pinewood', 'woods', 10],
  ["Goblin Scouts' Bluff", 'goblins', 8], ['Skitterer Cove', 'cove', 5], ["The Wolves' Den", 'den', 5], ["Ferryman's Jetty", 'jetty', 6],
];
