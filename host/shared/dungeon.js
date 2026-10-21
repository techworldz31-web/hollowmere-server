// The Hollow Deep: a three-floor dungeon built fresh from a seed on every run.
// Like the overworld, the layout is deterministic from (seed, floor), so the
// server only sends those two numbers and each client rebuilds the same map.

import { TERRAIN } from './constants.js';
import { OBJECTS, FLOORS } from './content.js';
import { mulberry32 } from './rng.js';

export const DUNGEON_SIZE = 60;

export function generateDungeon(seed, floor) {
  const F = FLOORS[floor];
  const W = DUNGEON_SIZE, H = DUNGEON_SIZE;
  const rand = mulberry32(seed * 7919 + floor * 104729);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const floorType = F.theme === 'crypt' ? TERRAIN.CRYPT : TERRAIN.CAVE;
  const terrain = new Uint8Array(W * H).fill(TERRAIN.VOID);
  const solid = new Uint8Array(W * H).fill(1);
  const room = new Int16Array(W * H).fill(-1);     // which room a tile belongs to
  const slow = new Uint8Array(W * H);              // webs
  const occupied = new Uint8Array(W * H);
  const objects = [];

  // ---- rooms -------------------------------------------------------------
  const rooms = [];
  for (let t = 0; t < 400 && rooms.length < 10; t++) {
    const w = ri(7, 12), h = ri(7, 12), x = ri(3, W - w - 4), y = ri(3, H - h - 4);
    if (rooms.some((r) => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
  }
  const carve = (x, y, rid = -1) => {
    if (!inside(x, y) || x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    terrain[idx(x, y)] = floorType; solid[idx(x, y)] = 0;
    if (rid >= 0) room[idx(x, y)] = rid;
  };
  rooms.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y, i); });

  // connect rooms with a minimum spanning tree of L-shaped corridors, plus one loop
  const corridor = (a, b) => {
    const width = F.webs ? 3 : 2;
    const horizFirst = rand() < 0.5;
    const pts = horizFirst ? [[a.cx, a.cy], [b.cx, a.cy], [b.cx, b.cy]] : [[a.cx, a.cy], [a.cx, b.cy], [b.cx, b.cy]];
    for (let s = 0; s < 2; s++) {
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let o = 0; o < width; o++) carve(x0 === x1 ? x + o : x, x0 === x1 ? y : y + o);
    }
  };
  const linked = [0], todo = rooms.map((_, i) => i).slice(1);
  while (todo.length) {
    let best = null;
    for (const a of linked) for (const b of todo) {
      const d = Math.hypot(rooms[a].cx - rooms[b].cx, rooms[a].cy - rooms[b].cy);
      if (!best || d < best.d) best = { a, b, d };
    }
    corridor(rooms[best.a], rooms[best.b]);
    linked.push(best.b); todo.splice(todo.indexOf(best.b), 1);
  }
  if (rooms.length > 4) corridor(rooms[1], rooms[rooms.length - 1]);

  // start = room 0, boss = farthest from start
  const start = rooms[0];
  let bossI = 1;
  rooms.forEach((r, i) => { if (Math.hypot(r.cx - start.cx, r.cy - start.cy) > Math.hypot(rooms[bossI].cx - start.cx, rooms[bossI].cy - start.cy)) bossI = i; });
  const boss = rooms[bossI];

  // ---- walls: back walls (behind a floor, as seen by the camera) are tall, front walls low
  const isFloor = (x, y) => inside(x, y) && terrain[idx(x, y)] !== TERRAIN.VOID;
  const wallKind = F.theme === 'crypt' ? 'wall_crypt' : 'wall_cave';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isFloor(x, y)) continue;
    let near = false;
    for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (isFloor(x + ox, y + oy)) { near = true; break; }
    if (!near) continue;
    const back = isFloor(x + 1, y) || isFloor(x, y + 1) || isFloor(x + 1, y + 1);
    const kind = back ? wallKind : wallKind + '_low';
    objects.push({ kind, tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: OBJECTS[kind].sprites[Math.floor(rand() * OBJECTS[kind].sprites.length)] });
    occupied[idx(x, y)] = 1;
  }

  const free = (x, y) => isFloor(x, y) && !occupied[idx(x, y)] && !solid[idx(x, y)];
  const place = (kind, x, y, variant) => {
    const def = OBJECTS[kind];
    objects.push({ kind, tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: def.sprites[(variant ?? Math.floor(rand() * def.sprites.length)) % def.sprites.length] });
    if (!def.flat) occupied[idx(x, y)] = 1;
    if (def.solid) solid[idx(x, y)] = 1;
  };
  // a room-edge tile is a doorway if a floor tile outside the room touches it
  const isDoor = (x, y, rid) => {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = x + ox, ny = y + oy;
      if (isFloor(nx, ny) && room[idx(nx, ny)] !== rid) return true;
    }
    return false;
  };

  // ---- lights and decor -----------------------------------------------------
  rooms.forEach((r, i) => {
    const corners = [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + r.h - 2], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2]];
    const nLights = i === bossI ? 4 : 2;
    for (const [x, y] of corners.slice(0, nLights)) if (free(x, y) && !isDoor(x, y, i)) place(F.theme === 'crypt' && rand() < 0.4 ? 'candles' : 'brazier', x, y);
    if (i === 0) return;
    // edge decor
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (!edge || !free(x, y) || isDoor(x, y, i) || rand() > 0.16) continue;
      const kind = F.decor[Math.floor(rand() * F.decor.length)];
      if (OBJECTS[kind].solid || OBJECTS[kind].flat) place(kind, x, y);
    }
    if (F.theme === 'crypt' && r.w >= 9 && r.h >= 9 && i !== bossI) {   // a row of pillars
      for (const [x, y] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) if (free(x, y)) place('pillar', x, y);
    }
  });
  // flat clutter and webs everywhere on the floor
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!free(x, y) || room[idx(x, y)] === 0) continue;
    if (F.webs && rand() < 0.08) { place('web', x, y); slow[idx(x, y)] = 1; }
    else if (rand() < 0.025) place('bones', x, y);
  }

  // ---- gameplay spots ---------------------------------------------------------
  const pick = (r, avoidEdge = 1) => {
    for (let t = 0; t < 60; t++) {
      const x = ri(r.x + avoidEdge, r.x + r.w - 1 - avoidEdge), y = ri(r.y + avoidEdge, r.y + r.h - 1 - avoidEdge);
      if (free(x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: r.cx + 0.5, y: r.cy + 0.5 };
  };
  const exit = { x: start.x + 1.5, y: start.y + 1.5 };
  if (!free(Math.floor(exit.x), Math.floor(exit.y))) Object.assign(exit, pick(start));
  occupied[idx(Math.floor(exit.x), Math.floor(exit.y))] = 1;
  const playerSpawn = { x: exit.x + 1.5, y: exit.y + 1.5 };
  if (!free(Math.floor(playerSpawn.x), Math.floor(playerSpawn.y))) Object.assign(playerSpawn, pick(start));

  const stairs = { x: boss.x + boss.w - 2.5, y: boss.y + boss.h - 2.5 };
  occupied[idx(Math.floor(stairs.x), Math.floor(stairs.y))] = 1;

  const spawns = [];
  rooms.forEach((r, i) => {
    if (i === 0) return;
    if (i === bossI) {
      spawns.push({ kind: F.boss, x: r.cx + 0.5, y: r.cy + 0.5, boss: true });
      for (let k = 0; k < 2; k++) spawns.push({ kind: F.mobs[0], ...pick(r) });
      return;
    }
    const n = 2 + Math.floor(rand() * 3) + (floor > 0 ? 1 : 0);
    for (let k = 0; k < n; k++) spawns.push({ kind: F.mobs[Math.floor(rand() * F.mobs.length)], ...pick(r) });
  });

  const chests = [];
  const chestRooms = rooms.map((_, i) => i).filter((i) => i !== 0 && i !== bossI).sort(() => rand() - 0.5).slice(0, 3);
  for (const i of chestRooms) {
    const r = rooms[i];
    for (const [x, y] of [[r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.cx, r.y + 1]]) {
      if (free(x, y) && !isDoor(x, y, i)) { chests.push({ x: x + 0.5, y: y + 0.5 }); occupied[idx(x, y)] = 1; break; }
    }
  }

  const traps = [];
  if (F.traps) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!free(x, y) || room[idx(x, y)] !== -1 || rand() > 0.06) continue;   // corridors only
    traps.push({ x: x + 0.5, y: y + 0.5 }); occupied[idx(x, y)] = 1;
  }

  return {
    seed, w: W, h: H, terrain, solid, objects, spawns, npcs: [], playerSpawn, slow,
    landmarks: {}, indoor: true, ambient: F.ambient,
    dungeon: { floor, name: F.name, theme: F.theme, exit, stairs, chests, traps, bossRoom: boss, rooms: rooms.length },
  };
}
