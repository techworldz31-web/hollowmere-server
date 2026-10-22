// Deterministic world generation. Server and client both run this with the
// same seed, so the static map (terrain, trees, buildings, collision) never
// has to be sent over the network — only the seed and dynamic entities.
//
// Layout (192 x 192 tiles): the town of Hollowmere sits in the middle — a big
// cobbled plaza with the bank on its north side and shops all round, two
// blocks of houses to the north and two to the south, gates at both ends.
// The lake lies north-west, the goblin camp east in the forest, the slime
// meadow south.

import { MAP_W, MAP_H, TERRAIN, LEVEL_H, dirFromVector } from './constants.js';
import { OBJECTS } from './content.js';
import { mulberry32, fbm, hash2 } from './rng.js';
import { HOMES, hoursOf } from './town.js';
import { SPAWN_PLAN, QUEST_MOBS } from './questline.js';
import { seaDist, mountainH } from './outskirts.js';
import { SIGN_BOARDS, SIGN_KINDS, CAMP_BOARDS, CAMP_KINDS, CROSS_KINDS, crossTip } from './signs.js';

export const WORLD_SEED = 1337;
const MARBLE = TERRAIN.CRYPT;       // the bank floor (drawn as polished marble on the surface)

// the town, in tiles
export const TOWN = {
  x0: 72, x1: 121, y0: 55, y1: 146,
  center: { x: 96, y: 101 },
  bank: { x0: 88, y0: 78, w: 17, h: 14 },        // walls, columns and roof; you can walk in through the front
  clerks: [90, 93, 96, 99, 102],                  // teller windows (x), clerks stand behind the counter
};

// the places off the road (see "places off the road" below); x, y is roughly where each goes
export const POI_DEFS = [
  { id: 'poi_pilgrims', kind: 'camp', name: "Pilgrims' Rest", x: 70, y: 60, lv: 5 },
  { id: 'poi_trapper', kind: 'camp', name: "Abandoned Trapper's Camp", x: 22, y: 126, lv: 8 },
  { id: 'poi_patrol', kind: 'camp', name: 'Deserted Patrol Camp', x: 40, y: 78, lv: 12 },
  { id: 'poi_green_lady', kind: 'shrine', name: 'Shrine of the Green Lady', x: 120, y: 165, lv: 5 },
  { id: 'poi_mossy', kind: 'shrine', name: 'Mossy Shrine', x: 52, y: 132, lv: 8 },
  { id: 'poi_north_wind', kind: 'shrine', name: 'Shrine of the North Wind', x: 130, y: 22, lv: 15 },
  { id: 'poi_drowned', kind: 'shrine', name: 'Drowned Shrine', x: 176, y: 140, lv: 18 },
  { id: 'poi_hut', kind: 'hut', name: "Fisherman's Hut", x: 54, y: 46, lv: 5 },
  { id: 'poi_tower', kind: 'ruin', name: 'Collapsed Watchtower', x: 12, y: 104, lv: 12 },
  { id: 'poi_frozen_ruin', kind: 'ruin', name: 'Frozen Ruin', x: 172, y: 40, lv: 16 },
];

export function generateMap(seed = WORLD_SEED) {
  const W = MAP_W, H = MAP_H;
  const rand = mulberry32(seed);
  const terrain = new Uint8Array(W * H).fill(TERRAIN.GRASS);
  const solid = new Uint8Array(W * H);
  const reserved = new Uint8Array(W * H);   // tiles where scatter objects may not go
  const occupied = new Uint8Array(W * H);   // tiles covered by an object footprint
  const objects = [];
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  const T = TOWN.center;          // town square
  const L = { x: 40, y: 42 };     // lake
  const C = { x: 160, y: 76 };    // goblin camp
  const S = { x: 92, y: 170 };    // slime meadow
  const J = { x: 96, y: 46 };     // where the north road forks for the lake and the camp
  const inTown = (x, y, m = 0) => x >= TOWN.x0 - m && x <= TOWN.x1 + m && y >= TOWN.y0 - m && y <= TOWN.y1 + m;

  // --- base terrain: grass + forest floor ---------------------------------
  const forestness = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let f = fbm(x / 16, y / 16, seed + 7, 4);
    f += Math.max(0, (x - 124) / 50) * 0.6;                        // the eastern forest
    const east = W - 1 - x;
    if (east < 14) f += (14 - east) * 0.08;                        // the deep woods along the east edge
    // the town and its fields
    const dx = Math.max(0, TOWN.x0 - 10 - x, x - TOWN.x1 - 10), dy = Math.max(0, TOWN.y0 - 8 - y, y - TOWN.y1 - 8);
    f -= Math.max(0, 1 - Math.hypot(dx, dy) / 14) * 0.9;
    f -= Math.max(0, 1 - Math.hypot(x - S.x, y - S.y) / 20) * 0.6;  // meadow clearing
    f -= Math.max(0, 1 - Math.hypot(x - C.x, y - C.y) / 13) * 0.9;  // camp clearing
    forestness[idx(x, y)] = f;
    if (f > 0.62) terrain[idx(x, y)] = TERRAIN.FOREST;
  }

  // --- lake ---------------------------------------------------------------
  // signed distance to the shore (negative = in the water)
  const lakeR = (x, y) => 14 + Math.sin(Math.atan2(y - L.y, x - L.x) * 3 + 1) * 2.5 + fbm(x / 7, y / 7, seed + 3, 3) * 5;
  const lakeDist = (x, y) => Math.hypot((x - L.x) * 0.85, y - L.y) - lakeR(x, y);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = lakeDist(x, y);
    if (d < 0) { terrain[idx(x, y)] = TERRAIN.WATER; solid[idx(x, y)] = 1; reserved[idx(x, y)] = 1; }
    else if (d < 1.8) { terrain[idx(x, y)] = TERRAIN.SAND; reserved[idx(x, y)] = 1; }
  }

  // --- the river ---------------------------------------------------------------
  // from the northern hills, under the stone bridge on the lake road, down past the
  // town's west side to the southern woods
  const RIVER = [[79, -2], [77, 14], [75, 30], [76, 38], [76, 44], [76, 50], [72, 56], [68, 62], [67, 72], [66, 88], [67, 104], [68, 120], [70, 138], [68, 156], [63, 174], [60, 194]];
  const BRIDGE = { x0: 72, y0: 42, w: 9, h: 4 };              // the stone bridge: 9 tiles along the road; parapet, 2-wide deck, parapet
  const riverFlow = new Float32Array(W * H * 2);              // which way the water runs (for the shader)
  const riverD = new Float32Array(W * H).fill(99);            // distance to the river's middle
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, ay] = RIVER[i], [bx, by] = RIVER[i + 1], len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let y = Math.floor(Math.min(ay, by)) - 5; y <= Math.ceil(Math.max(ay, by)) + 5; y++) for (let x = Math.floor(Math.min(ax, bx)) - 5; x <= Math.ceil(Math.max(ax, bx)) + 5; x++) {
      if (!inside(x, y)) continue;
      const px = x + 0.5 - ax, py = y + 0.5 - ay, t = Math.max(0, Math.min(len, px * ux + py * uy));
      const wob = (fbm((ax + ux * t) / 9, (ay + uy * t) / 9, seed + 90, 2) - 0.5) * 3;  // meanders
      const d = Math.hypot(px - ux * t + uy * wob, py - uy * t - ux * wob);
      if (d < riverD[idx(x, y)]) { riverD[idx(x, y)] = d; riverFlow[idx(x, y) * 2] = ux; riverFlow[idx(x, y) * 2 + 1] = uy; }
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), d = riverD[i], half = 1.45 + fbm(x / 11, y / 11, seed + 93, 2) * 0.7;
    // straight and steady where the bridge crosses
    const atBridge = x >= BRIDGE.x0 && x < BRIDGE.x0 + BRIDGE.w && y >= BRIDGE.y0 - 2 && y < BRIDGE.y0 + BRIDGE.h + 2;
    const hw = atBridge ? 1.9 : half;
    if (d < hw) { terrain[i] = TERRAIN.WATER; solid[i] = 1; reserved[i] = 1; }
    else if (d < hw + 1.6) { reserved[i] = 1; if (terrain[i] !== TERRAIN.WATER && fbm(x / 3.5, y / 3.5, seed + 95, 2) > 0.47) terrain[i] = TERRAIN.SAND; }
  }

  // --- the sea: the west and south coasts, sandy beaches (the river runs out into it) ----------------
  const sea = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), d = seaDist(x, y, seed);
    sea[i] = d;
    if (d < 0) { terrain[i] = TERRAIN.WATER; solid[i] = 1; reserved[i] = 1; forestness[i] = 0; }
    else if (d < 2.4) { if (terrain[i] !== TERRAIN.WATER) terrain[i] = TERRAIN.SAND; reserved[i] = 1; forestness[i] = 0; }
    else if (d < 6) forestness[i] = Math.min(forestness[i], 0.45);      // open dunes and grass behind the beach
  }

  // --- roads ----------------------------------------------------------------
  function road(points, width = 1.4) {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i], [bx, by] = points[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        let px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        px += (fbm(px / 5, py / 5, seed + 11, 2) - 0.5) * 2;
        py += (fbm(px / 5, py / 5, seed + 12, 2) - 0.5) * 2;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
          const tx = Math.round(px + ox), ty = Math.round(py + oy);
          if (!inside(tx, ty) || terrain[idx(tx, ty)] === TERRAIN.WATER || inTown(tx, ty)) continue;
          if (Math.hypot(tx - px, ty - py) <= width) { terrain[idx(tx, ty)] = TERRAIN.DIRT; reserved[idx(tx, ty)] = 1; }
          if (Math.hypot(tx - px, ty - py) <= width + 1.5) reserved[idx(tx, ty)] = 1;
        }
      }
    }
  }
  road([[96, TOWN.y0], [J.x, J.y]]);                                                // north gate
  road([[J.x, J.y], [86, 43.5], [BRIDGE.x0 + BRIDGE.w + 1, 43.5], [BRIDGE.x0 - 2, 43.5], [62, 46], [L.x + 9, L.y + 15]]);   // to the lake, over the bridge
  road([[J.x, J.y], [114, 40], [132, 52], [148, 66], [C.x, C.y]]);                    // to the goblin camp
  road([[96, TOWN.y1], [95, 156], [S.x - 1, 163], [S.x, S.y]]);                       // south gate to the meadow
  road([[TOWN.x1, 128], [134, 130]]);                                                 // the mill lane

  // --- placement helpers -----------------------------------------------------
  function canPlace(kind, tx, ty, ignoreReserved = false) {
    const [fw, fh] = OBJECTS[kind].foot;
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
      if (!inside(x, y) || occupied[idx(x, y)] || solid[idx(x, y)]) return false;
      if (!ignoreReserved && reserved[idx(x, y)]) return false;
    }
    return true;
  }
  function place(kind, tx, ty, variant = 0) {
    const def = OBJECTS[kind];
    const [fw, fh] = def.foot;
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
      if (!inside(x, y)) continue;
      if (!def.flat && !def.roof) occupied[idx(x, y)] = 1;
      if (def.solid) solid[idx(x, y)] = 1;
    }
    objects.push({ kind, tx, ty, x: tx + fw / 2, y: ty + fh / 2, sprite: def.sprites[variant % def.sprites.length] });
    if (def.lights?.length || def.hours) objects[objects.length - 1].hid = objects.length - 1;   // its lights keep their own hours
  }
  const force = place;
  const fill = (x0, x1, y0, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) { terrain[idx(x, y)] = t; reserved[idx(x, y)] = 1; } };
  const free = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!inside(x, y) || occupied[idx(x, y)] || solid[idx(x, y)] || terrain[idx(x, y)] === TERRAIN.STONE) return false; return true; };

  // ======================================================================
  // THE TOWN
  // ======================================================================
  fill(TOWN.x0, TOWN.x1, TOWN.y0, TOWN.y1, TERRAIN.GRASS);              // keep trees out
  // streets (cobbles)
  const STONE = TERRAIN.STONE;
  fill(94, 97, TOWN.y0, 77, STONE);                // north avenue from the gate
  fill(94, 97, 112, TOWN.y1, STONE);               // south avenue to the gate
  for (const [y0, y1] of [[62, 64], [75, 77], [120, 122], [133, 135]]) fill(TOWN.x0, TOWN.x1, y0, y1, STONE);   // cross streets
  fill(84, 86, 77, 92, STONE); fill(106, 108, 77, 92, STONE);              // lanes either side of the bank
  fill(78, 110, 92, 112, STONE);                                           // the plaza
  fill(111, 120, 101, 102, STONE); fill(111, 121, 112, 112, STONE);        // lanes to the inn and chapel doors
  // the bank: marble floor inside, walls round three sides, columns along the open front
  const BK = TOWN.bank;
  fill(BK.x0, BK.x0 + BK.w - 1, BK.y0, BK.y0 + BK.h - 1, MARBLE);
  const bx1 = BK.x0 + BK.w - 1, by1 = BK.y0 + BK.h - 1;              // 104, 91
  force('bank_pier', BK.x0, BK.y0); force('bank_pier', bx1, BK.y0); force('bank_pier', BK.x0, by1); force('bank_pier', bx1, by1);
  const backVar = { 89: 'shelf', 90: 'pilaster', 91: 'shelf', 92: 'painting', 93: 'banner', 94: 'pilaster', 98: 'pilaster', 99: 'banner', 100: 'painting', 101: 'shelf', 102: 'pilaster', 103: 'shelf' };
  for (let x = BK.x0 + 1; x < bx1; x++) if (backVar[x]) force('bankwall_n', x, BK.y0, ['plain', 'pilaster', 'painting', 'shelf', 'window', 'banner', 'sconce'].indexOf(backVar[x]));
  force('bank_vault', 95, BK.y0);
  const westVar = ['plain', 'window', 'sconce', 'window', 'plain', 'pilaster', 'window', 'painting', 'window', 'pilaster', 'window', 'banner'];
  for (let y = BK.y0 + 1; y < by1; y++) {
    force('bankwall_w', BK.x0, y, ['plain', 'pilaster', 'painting', 'window', 'banner', 'sconce'].indexOf(westVar[y - BK.y0 - 1]));
    force('bankwall_e', bx1, y, (y - BK.y0) % 2);
  }
  for (const x of [91, 94, 98, 101]) force('bank_column', x, by1);
  // the teller counter wall to wall, with the five clerks behind it
  for (let x = BK.x0 + 1; x < bx1; x++) force('bank_counter', x, 83, TOWN.clerks.includes(x) ? 0 : x % 2 ? 1 : 2);
  force('bank_desk', 89, 80); force('bank_desk', 102, 80);
  force('bank_safe', 92, 79); force('bank_safe', 100, 79); force('bank_gold', 93, 79); force('bank_gold', 99, 79);
  // the hall
  force('bank_rug', 95, 84);
  force('bank_table', 90, 85); force('bank_table', 101, 85);
  force('bank_bench_w', 89, 88); force('bank_bench_e', 103, 88);
  force('bank_plant', 89, 84); force('bank_plant', 103, 84); force('bank_plant', 92, 90); force('bank_plant', 100, 90);
  force('bank_clock', 89, 86);
  for (const x of [92, 96, 100]) force('bank_chandelier', x, 87);
  force('bank_roof', BK.x0, BK.y0);
  for (const x of [87, 105]) for (const y of [79, 85, 90]) force(y === 85 ? 'lamp' : 'flowers', x, y, x + y);

  // --- around the plaza ------------------------------------------------------
  // Walk-in buildings: pieces of wall round a floor, a roof that lifts off while you're inside.
  // n / w lists give the inside of the back and west walls, e / s the outside of the front walls;
  // 'door' leaves an open doorway. Every piece remembers its building (for the cut-away walls and
  // for when its lights are on).
  const buildings = [];
  function building(type, x0, y0, w, h, o) {
    const bid = buildings.length, kit = type === 'chapel' ? 'cw' : 'tw';
    buildings.push({ type, x0, y0, w, h });
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = idx(x, y);
      terrain[i] = o.floor; reserved[i] = 1; occupied[i] = 1;
    }
    const tag = () => { const ob = objects[objects.length - 1]; ob.bld = [x0, y0, w, h]; ob.hid = 1000 + bid; ob.hk = type; };
    const piece = (kind, x, y, v) => { force(kind, x, y, v); tag(); };
    const SPR = (kind) => OBJECTS[kind].sprites.map((n) => n.slice(kind.length + 1));
    const put = (side, x, y, name) => {
      if (name === 'door') return piece(`${kit}_${side}_door`, x, y, 0);
      const v = SPR(`${kit}_${side}`).indexOf(name);
      piece(`${kit}_${side}`, x, y, Math.max(0, v));
    };
    for (const [x, y] of [[x0, y0], [x0 + w - 1, y0], [x0, y0 + h - 1], [x0 + w - 1, y0 + h - 1]]) piece(`${kit}_pier`, x, y, 0);
    o.n.forEach((v, k) => { if (v) put('n', x0 + 1 + k, y0, v); });
    o.s.forEach((v, k) => put('s', x0 + 1 + k, y0 + h - 1, v));
    o.w.forEach((v, k) => put('w', x0, y0 + 1 + k, v));
    o.e.forEach((v, k) => put('e', x0 + w - 1, y0 + 1 + k, v));
    for (const [kind, x, y, v] of o.inside || []) piece(kind, x, y, v || 0);
    piece(o.roof, x0, y0, 0);
    return bid;
  }
  // three shops down the west side, doors facing the square
  const SHOP_ROWS = [['general', 92, 'shelf_goods', 'shelf_goods', ['shop_crates', 'shop_crates']], ['armor', 99, 'rack_weapons', 'shields', ['armor_stand', 'weapon_rack']], ['apoth', 106, 'shelf_potions', 'herbs', ['cauldron', 'herb_table']]];
  for (const [k, y0, shelfA, shelfB, [d1, d2]] of SHOP_ROWS) {
    building('shop', 72, y0, 6, 6, {
      floor: TERRAIN.WOOD, roof: `shop_roof_${k}`,
      n: [shelfA, 'window', shelfB, 'sconce'],
      w: [shelfA, shelfB, 'painting', shelfA],
      e: ['window', `sign_${k}`, 'door', 'window'],
      s: ['window', 'plain', 'lantern', 'window'],
      inside: [['shop_counter', 74, y0 + 1, 0], ['shop_counter', 74, y0 + 2, { general: 1, armor: 2, apoth: 3 }[k]], ['shop_counter', 74, y0 + 3, 0], ['shop_counter', 74, y0 + 4, 0],
        [d1, 76, y0 + 1, 0], [d2, 76, y0 + 4, 0]],
    });
  }
  // the Sleeping Goat: bar and kegs, the hearth, tables, stairs up to the rooms
  building('inn', 111, 92, 10, 9, {
    floor: TERRAIN.WOOD, roof: 'inn_roof',
    n: ['bottles', 'bottles', 'window', null, null, 'antlers', 'sconce', 'window'],
    w: ['window', 'painting', 'sconce', 'window', 'plain', 'window', 'painting'],
    e: ['window', 'plain', 'window', 'lantern', 'window', 'plain', 'window'],
    s: ['window', 'sign_inn', 'door', 'window', 'lantern', 'window', 'plain', 'window'],
    inside: [['inn_fireplace', 115, 92], ['inn_rug', 115, 93], ['inn_bar', 112, 95, 1], ['inn_bar', 113, 95, 0], ['inn_bar', 114, 95, 1], ['inn_kegs', 112, 93],
      ['inn_table', 116, 96, 0], ['inn_table', 112, 97, 1], ['inn_table', 118, 98, 2], ['inn_stairs', 119, 93]],
  });
  // the chapel: altar under the rose window, pews either side of the aisle
  building('chapel', 112, 103, 9, 9, {
    floor: TERRAIN.TILE, roof: 'chapel_roof',
    n: ['plain', 'stained', 'candles', 'altar', 'candles', 'stained', 'plain'],
    w: ['stained', 'plain', 'stained', 'banner', 'stained', 'plain', 'stained'],
    e: ['stained', 'buttress', 'stained', 'buttress', 'stained', 'buttress', 'stained'],
    s: ['stained', 'buttress', 'plain', 'door', 'plain', 'buttress', 'stained'],
    inside: [['ch_altar', 115, 104], ['ch_candelabra', 114, 104], ['ch_candelabra', 118, 104],
      ['ch_pew', 113, 106], ['ch_pew', 113, 108], ['ch_pew', 118, 106], ['ch_pew', 118, 108]],
  });
  // the forge in the north-east corner of the square
  force('forge', 106, 94); force('anvil', 108, 95);
  // the square itself
  force('fountain', 94, 100);
  for (const [x, y] of [[91, 98], [100, 98], [91, 105], [100, 105]]) force('lamp', x, y);
  force('bench_x', 88, 104); force('bench_x', 102, 102);
  force('stall', 85, 108); force('stall', 104, 109);
  force('noticeboard', 103, 93);
  for (const [x, y, v] of [[83, 92, 0], [109, 92, 1], [92, 111, 0], [99, 111, 1]]) force('banner', x, y, v);
  force('maple', 82, 110, 0); force('oak', 110, 112, 1); force('birch', 81, 98, 2); force('birch', 81, 105, 0);
  force('crate', 84, 106); force('barrel', 84, 107); force('crate', 108, 101); force('barrel', 108, 100);
  force('flowers', 110, 104, 1); force('flowers', 110, 106, 2); force('tuft', 111, 112, 0);

  // --- houses on the north and south blocks --------------------------------------
  const HOUSES = [['townhouse', 3, 0], ['townhouse', 3, 1], ['house_small', 3, 0], ['townhouse', 3, 2], ['house_large', 4, 0]];
  const DECOR = ['barrel', 'crate', 'lamp', 'flowers', 'hay', 'tuft'];
  // a row of houses whose fronts stand on `front` (the street is just south of it)
  function houseRow(x0, x1, front, s) {
    let x = x0, k = s;
    while (x < x1) {
      const [kind, size, v] = HOUSES[k++ % HOUSES.length];
      const ty = front - size + 1;
      if (x + size - 1 > x1) break;
      if (free(x, x + size - 1, ty, front)) { force(kind, x, ty, v); x += size; }
      else { x++; continue; }
      // a tidy 3-tile garden gap between neighbours: flower beds either side of a clipped bush,
      // and a tree further back between the houses
      if (x + 2 > x1) break;
      const g = hash2(x, front, seed);
      if (free(x, x, front, front)) force('flowers', x, front, x);
      if (free(x + 1, x + 1, front, front)) force('bush', x + 1, front, x);
      if (free(x + 2, x + 2, front, front)) force('flowers', x + 2, front, x + 1);
      const ty2 = front - 2;
      if (g < 0.45 && free(x + 1, x + 1, ty2, ty2)) force('birch', x + 1, ty2, Math.floor(g * 9));   // a slim birch now and then
      x += 3;
    }
  }
  // gardens behind a row: fences, washing lines, trees, hay
  function gardens(x0, x1, y0, y1, s) {
    for (let x = x0; x <= x1; x += 4 + Math.floor(hash2(x, y0, seed + s) * 3)) {
      const h = hash2(x, y1, seed + s);
      const kind = h < 0.35 ? 'washing' : h < 0.55 ? 'bush' : h < 0.8 ? 'hay' : 'birch';      // low things: the street behind stays in view
      const tx = x, ty = y0 + Math.floor(hash2(x, y0 + 1, seed + s) * Math.max(1, y1 - y0 - 1));
      const [fw, fh] = OBJECTS[kind].foot;
      if (free(tx - 1, tx + fw, ty - 1, ty + fh)) force(kind, tx, ty, x);
    }
    for (let x = x0; x <= x1; x++) if (hash2(x, y1, seed + s + 9) < 0.3 && free(x, x, y1, y1)) force('fence_x', x, y1);
  }
  // --- Hollowmere Farms: the town's own farm quarter, out past the inn and the chapel -------------
  // Open grassland with two big fenced fields of tilled earth anyone may farm, a lane through the
  // middle from the inn lane, lamps, hay and a few trees. The gate guards watch it like the town.
  const FARMQ = { x0: 123, x1: 144, y0: 83, y1: 119 };
  const farms = [];
  for (let y = FARMQ.y0; y <= FARMQ.y1; y++) for (let x = FARMQ.x0; x <= FARMQ.x1; x++) { terrain[idx(x, y)] = TERRAIN.GRASS; reserved[idx(x, y)] = 1; }
  // the lane: on from the inn lane, two tiles wide, through the middle of the quarter
  for (let x = TOWN.x1; x <= FARMQ.x1; x++) for (const y of [101, 102]) { terrain[idx(x, y)] = TERRAIN.DIRT; reserved[idx(x, y)] = 1; }
  function field(fx0, fy0, fw, fh, gateX, gateSouth) {
    const fx1 = fx0 + fw - 1, fy1 = fy0 + fh - 1;
    for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) {
      const i = idx(x, y), edge = x === fx0 || x === fx1 || y === fy0 || y === fy1;
      reserved[i] = 1;
      if (!edge) { terrain[i] = TERRAIN.FARM; continue; }
      const gy = gateSouth ? fy1 : fy0;
      if (y === gy && (x === gateX || x === gateX + 1)) { terrain[i] = TERRAIN.DIRT; occupied[i] = 1; continue; }   // the way in
      if (y === gy && x === gateX + 2) { force('farm_sign', x, y); continue; }
      force(y === fy0 || y === fy1 ? 'fence_x' : 'fence_y', x, y);
    }
    const cx = fx0 + Math.floor(fw / 2), cy = fy0 + Math.floor(fh / 2);
    force('scarecrow', cx, cy);
    force('trough', fx1 - 2, gateSouth ? fy0 + 1 : fy1 - 1);
    farms.push({ x0: fx0 + 1, y0: fy0 + 1, w: fw - 2, h: fh - 2 });
  }
  field(125, 85, 18, 13, 132, true);     // the north field, its gate onto the lane
  field(125, 106, 18, 13, 132, false);   // the south field
  // between the fields: the farm sign at the lane's mouth, lamps, hay, a bench, trees round the edge
  force('farm_sign', TOWN.x1 + 2, 100);
  for (const x of [126, 134, 142]) { force('lamp', x, 100); force('lamp', x, 103); }
  force('hay', 129, 99, 0); force('hay', 130, 99, 1); force('hay', 139, 104, 1);
  force('bench_x', 137, 99);
  force('barrel', 140, 104); force('crate', 141, 104);
  for (const [x, y, k] of [[123, 84, 'oak'], [144, 84, 'maple'], [123, 118, 'birch'], [144, 118, 'oak'], [144, 101, 'birch'], [123, 104, 'maple']]) force(k, x, y, (x + y) % 3);
  for (let x = FARMQ.x0; x <= FARMQ.x1; x += 3) for (const y of [FARMQ.y0, FARMQ.y1]) if (free(x, x, y, y)) force('flowers', x, y, x * 3 + y);
  // the gate guards' posts: keep the verges clear there
  const GUARD_POSTS = [[93, TOWN.y0 + 1, 0, -1], [98, TOWN.y0 + 1, 0, -1], [93, TOWN.y1 - 1, 0, 1], [98, TOWN.y1 - 1, 0, 1]];
  for (const [x, y] of GUARD_POSTS) { occupied[idx(x, y)] = 1; reserved[idx(x, y)] = 1; }
  for (const [x0, x1] of [[TOWN.x0 + 1, 91], [100, TOWN.x1 - 1]]) {
    houseRow(x0, x1, 61, x0);            // north edge, facing cross street A
    houseRow(x0, x1, 74, x0 + 1);        // facing cross street B
    gardens(x0 + 1, x1 - 1, 66, 69, x0);
    houseRow(x0, x1, 119, x0 + 2);       // south of the plaza, facing cross street C
    houseRow(x0, x1, 132, x0 + 3);       // facing cross street D
    gardens(x0 + 1, x1 - 1, 124, 127, x0 + 5);
    houseRow(x0, x1, 140, x0 + 4);       // the last row before the south gate
  }
  // beside the bank lanes
  houseRow(TOWN.x0, 83, 90, 7); houseRow(TOWN.x0, 83, 82, 8);
  houseRow(109, TOWN.x1, 90, 9); houseRow(109, TOWN.x1, 82, 10);
  force('well', 79, 70);
  // street lamps along the cross streets and avenues
  for (const y of [61, 74, 119, 132]) for (let x = TOWN.x0 + 2; x < TOWN.x1; x += 7) if (free(x, x, y, y)) force('lamp', x, y);
  for (let y = TOWN.y0 + 2; y < TOWN.y1; y += 6) for (const x of [93, 98]) if (y < 75 || y > 113) if (free(x, x, y, y)) force('lamp', x, y);
  // --- landscaping ---------------------------------------------------------------------
  // tree-lined avenues: a slim birch every 8 tiles on the verges beside the north and south avenues
  for (let y = TOWN.y0 + 3; y < TOWN.y1 - 1; y += 8) for (const x of [92, 99]) {
    if (y > 76 && y < 114) continue;
    if (free(x, x, y - 1, y + 1) && terrain[idx(x, y)] === TERRAIN.GRASS) force('birch', x, y, (x + y) % 3);
  }
  // the square: flower beds at the fountain's corners, bushes in the corners of the plaza, more benches
  for (const [x, y] of [[93, 99], [98, 99], [93, 104], [98, 104]]) if (free(x, x, y, y)) force('flowers', x, y, x + y);
  for (const [x, y] of [[79, 93], [79, 111], [109, 111]]) if (free(x, x, y, y)) force('bush', x, y, x);
  if (free(88, 89, 97, 97)) force('bench_x', 88, 97);
  if (free(102, 103, 106, 106)) force('bench_x', 102, 106);
  // verges: neat bushes and flower beds along the street edges, never two solid things side by side
  for (let y = TOWN.y0 + 1; y < TOWN.y1; y++) for (let x = TOWN.x0 + 1; x < TOWN.x1; x++) {
    const i = idx(x, y);
    if (terrain[i] !== TERRAIN.GRASS || occupied[i] || solid[i]) continue;
    const onStreet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => terrain[idx(x + ox, y + oy)] === STONE);
    if (!onStreet) continue;
    let near = false;
    for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (solid[idx(x + ox, y + oy)]) { near = true; break; }
    if (!near && (x * 3 + y * 5) % 6 === 0) force('bush', x, y, x + y);
    else if (hash2(x, y, seed + 17) < 0.35) force('flowers', x, y, x * 7 + y);
  }
  // gateposts: banners either side of both gates
  force('banner', 93, TOWN.y0, 0); force('banner', 98, TOWN.y0, 1);
  force('banner', 93, TOWN.y1, 1); force('banner', 98, TOWN.y1, 0);

  // townsfolk wander the streets
  const streets = [];
  for (let y = TOWN.y0; y <= TOWN.y1; y++) for (let x = TOWN.x0; x <= TOWN.x1; x++) {
    const i = idx(x, y);
    if (terrain[i] === STONE && !solid[i] && !occupied[i] && (x + y) % 2 === 0) streets.push([x + 0.5, y + 0.5]);
  }

  // --- the stone bridge: walkable deck over the water, a parapet on each side ----------------
  for (let y = BRIDGE.y0; y < BRIDGE.y0 + BRIDGE.h; y++) for (let x = BRIDGE.x0; x < BRIDGE.x0 + BRIDGE.w; x++) {
    const i = idx(x, y), rail = y === BRIDGE.y0 || y === BRIDGE.y0 + BRIDGE.h - 1;
    solid[i] = rail ? 1 : 0; reserved[i] = 1; occupied[i] = 1;
    if (terrain[i] !== TERRAIN.WATER) terrain[i] = TERRAIN.DIRT;
  }
  force('bridge', BRIDGE.x0, BRIDGE.y0);
  // the near side wall in tile-wide pieces, so people on the deck are drawn behind it correctly
  for (let x = BRIDGE.x0; x < BRIDGE.x0 + BRIDGE.w; x++) force('bridge_wall', x, BRIDGE.y0 + BRIDGE.h - 1, x - BRIDGE.x0);

  // ======================================================================
  // THE WILDS
  // ======================================================================
  // --- outskirts: windmill farm east of the south blocks ------------------------
  function spot(kind, cx, cy, maxR = 12, variant = 0) {
    const [fw, fh] = OBJECTS[kind].foot;
    for (let r = 0; r <= maxR; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const tx = Math.round(cx + ox), ty = Math.round(cy + oy);
      let ok = true;
      for (let y = ty - 1; y < ty + fh + 1 && ok; y++) for (let x = tx - 1; x < tx + fw + 1; x++) {
        const t = inside(x, y) ? terrain[idx(x, y)] : -1;
        if (t < 0 || occupied[idx(x, y)] || solid[idx(x, y)] || t === TERRAIN.DIRT || t === TERRAIN.STONE || t === TERRAIN.WATER || t === TERRAIN.SAND || inTown(x, y)) { ok = false; break; }
      }
      if (ok) { place(kind, tx, ty, variant); for (let y = ty - 1; y < ty + fh + 1; y++) for (let x = tx - 1; x < tx + fw + 1; x++) if (inside(x, y)) reserved[idx(x, y)] = 1; return [tx, ty]; }
    }
    return null;
  }
  const mill = spot('windmill', 136, 124);
  if (mill) {
    const [mx, my] = mill;
    spot('haycart', mx - 3, my + 4, 6);
    for (let i = 0; i < 4; i++) spot('hay', mx + 4 + (i % 2) * 2, my + 1 + i, 6, i);
    for (let x = mx - 4; x <= mx + 7; x++) if (x !== mx + 1 && x !== mx + 2 && canPlace('stonewall_x', x, my + 7) && terrain[idx(x, my + 7)] === TERRAIN.GRASS) place('stonewall_x', x, my + 7);
    for (let y = my + 1; y <= my + 6; y++) if (canPlace('stonewall_y', mx + 8, y) && terrain[idx(mx + 8, y)] === TERRAIN.GRASS) place('stonewall_y', mx + 8, y);
  }
  spot('house_small', 60, 112); spot('washing', 64, 117); spot('hay', 58, 108, 6, 1);       // a farmstead west of town
  spot('house_large', 132, 146); spot('hay', 137, 150, 6, 0);
  spot('sign', 99, 50);

  // --- the road to level 20: Willow Ford, and a camp in each of the four new regions ----------------
  // Willow Ford: a shallow crossing of the river south-west of town, on the way to Whisperwood
  for (let y = 148; y <= 151; y++) for (let x = 58; x <= 76; x++) {
    const i = idx(x, y);
    if (terrain[i] === TERRAIN.WATER) { terrain[i] = TERRAIN.SAND; solid[i] = 0; }
    reserved[i] = 1;
  }
  road([[95, 152], [80, 150], [77, 149.5]]);
  road([[57, 149.5], [44, 148], [30, 146]]);                     // on to Thornwick Lodge
  road([[30, 144], [38, 126], [48, 112], [52, 100]]);            // north to Ridgewatch
  road([[62, 47], [57, 66], [54, 84], [52, 96]]);                // and down from the lake road
  road([[148, 64], [150, 47]]);                                  // up to the Frostridge hermitage
  road([[TOWN.x1, 128], [134, 131], [136, 148]]);                // past the mill to Fenwatch
  const spots = {};
  // a cleared camp: tents, a fire, crates, a banner and a lamp, with room for the quest-givers
  function camp(id, cx, cy, r = 6) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inside(x, y) || Math.hypot(x - cx, y - cy) > r + 0.5) continue;
      const i = idx(x, y);
      if (terrain[i] === TERRAIN.FOREST) terrain[i] = TERRAIN.GRASS;
      if (terrain[i] !== TERRAIN.WATER) reserved[i] = 1;
    }
    const put = (k, x, y, v = 0) => { if (canPlace(k, x, y, true)) force(k, x, y, v); };
    put('tent', cx - 4, cy - 4); put('tent', cx + 2, cy - 5); put('campfire', cx, cy);
    put('logs', cx - 2, cy + 2); put('crate', cx + 4, cy + 1); put('barrel', cx + 4, cy + 2); put('crate', cx - 5, cy + 1);
    put('banner', cx - 1, cy - 4, 1); put('lamp', cx + 3, cy - 2);
    put('anvil', cx - 3, cy + 3); put('crate', cx - 4, cy + 3);      // the workbench: craft here
    spots[id] = { x: cx + 0.5, y: cy + 0.5, r: r + 1 };
  }
  camp('thornwick', 30, 142);
  camp('ridgewatch', 52, 102);
  camp('hermitage', 150, 50, 5);
  camp('fenwatch', 136, 152);
  spots.willow_ford = { x: 67.5, y: 150, r: 4 };
  // the Blackmarsh: reed-fringed pools in the woods south-west of the bluff
  for (let y = 154; y <= 182; y++) for (let x = 128; x <= 158; x++) {
    const d = Math.hypot(x - 143, y - 168);
    if (d > 15) continue;
    const i = idx(x, y);
    if (reserved[i]) continue;
    terrain[i] = TERRAIN.GRASS;
    const n = fbm(x / 4, y / 4, seed + 140, 3);
    if (n > 0.6 && d < 13) { terrain[i] = TERRAIN.WATER; solid[i] = 1; reserved[i] = 1; }
    else if (n > 0.54) { terrain[i] = TERRAIN.SAND; reserved[i] = 1; }
  }

  // --- goblin camp --------------------------------------------------------
  force('campfire', C.x, C.y);
  force('tent', C.x - 5, C.y - 4); force('tent', C.x + 3, C.y - 5);
  force('tent', C.x - 6, C.y + 3); force('tent', C.x + 4, C.y + 3);
  force('logs', C.x - 2, C.y + 2); force('logs', C.x + 1, C.y - 2);
  force('crate', C.x + 6, C.y); force('barrel', C.x + 6, C.y + 1); force('crate', C.x - 7, C.y);
  force('cave_entrance', C.x - 2, C.y - 9);
  for (let y = C.y - 10; y <= C.y + 9; y++) for (let x = C.x - 10; x <= C.x + 9; x++) {
    if (!inside(x, y)) continue;
    const dc = Math.hypot(x - C.x, y - C.y);
    if (dc < 6 + fbm(x / 3, y / 3, seed + 5, 2) * 2) terrain[idx(x, y)] = TERRAIN.DIRT;
    if (dc < 9) reserved[idx(x, y)] = 1;
  }

  // --- highlands: plateaus with cliffs and stairs, and gentle hills ------------------------
  // tile levels (0 = the plain), then corner heights for the ground mesh
  const level = new Uint8Array(W * H);
  const cliff = new Uint8Array(W * H);       // 1 = cliff face (solid), 2 = stairs
  const W1 = W + 1, height = new Float32Array(W1 * (H + 1));
  const PLATEAUS = [
    { x: 24, y: 96, rx: 15, ry: 21, s: 1, ramp: 'e', inner: { rx: 0.45, ry: 0.4, ramp: 's' } },   // the west highlands
    { x: 44, y: 163, rx: 13, ry: 11, s: 2, ramp: 'n' },                                              // south-west hills
    { x: 150, y: 25, rx: 15, ry: 11, s: 3, ramp: 's', inner: { rx: 0.42, ry: 0.42, ramp: 'e' } },    // the north-east ridge
    { x: 160, y: 151, rx: 13, ry: 12, s: 4, ramp: 'w' },                                             // the south-east bluff
    { x: 55, y: 80, rx: 8, ry: 7, s: 5, ramp: 's' },                                                 // the lookout knoll west of the river
  ];
  const open = (x, y) => inside(x, y) && !reserved[idx(x, y)] && !occupied[idx(x, y)] && !solid[idx(x, y)] && !inTown(x, y, 6);
  for (const P of PLATEAUS) {
    const blob = (x, y, rx, ry, k) => ((x - P.x) / rx) ** 2 + ((y - P.y) / ry) ** 2 + (fbm(x / 6, y / 6, seed + 70 + P.s * 7 + k, 3) - 0.5) * 0.9;
    for (let y = P.y - P.ry - 4; y <= P.y + P.ry + 4; y++) for (let x = P.x - P.rx - 4; x <= P.x + P.rx + 4; x++) {
      if (open(x, y) && blob(x, y, P.rx, P.ry, 0) < 1) level[idx(x, y)] = 1;
    }
    if (P.inner) for (let y = P.y - P.ry; y <= P.y + P.ry; y++) for (let x = P.x - P.rx; x <= P.x + P.rx; x++) {
      // the upper tier keeps a walkable rim of the lower one all round
      let rim = true;
      for (let oy = -3; oy <= 3 && rim; oy++) for (let ox = -3; ox <= 3; ox++) if (!inside(x + ox, y + oy) || !level[idx(x + ox, y + oy)]) { rim = false; break; }
      if (rim && blob(x, y, P.rx * P.inner.rx, P.ry * P.inner.ry, 5) < 1) level[idx(x, y)] = 2;
    }
  }
  // tidy the outlines: no lone spurs or pits (they'd make needle-thin cliffs)
  for (let pass = 0; pass < 3; pass++) {
    const next = level.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const v = level[idx(x, y)];
      let up = 0, same = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = level[idx(x + ox, y + oy)]; if (n > v) up++; else if (n === v) same++; }
      if (v > 0 && same + up < 2) next[idx(x, y)] = v - 1;          // spur
      else if (up >= 3) next[idx(x, y)] = v + 1;                    // pit
    }
    level.set(next);
  }
  // corner heights: a corner is as low as its lowest tile, so cliff faces fall inside the higher tiles
  for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
    let lo = 9;
    for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) if (inside(tx, ty)) lo = Math.min(lo, level[idx(tx, ty)]);
    height[cy * W1 + cx] = lo * LEVEL_H;
  }
  // stairs: a 2-wide ramp cut through the cliff, 5 tiles long, in the given direction
  const stairs = [];
  function cutStairs(P, lv, dir) {
    const D = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }[dir], [dx, dy] = D;
    // walk out from the centre along the direction until we leave level lv, for a few lanes; pick the straightest
    let best = null;
    for (let lane = -4; lane <= 4; lane++) {
      const ax = dx ? 0 : lane, ay = dy ? 0 : lane;            // lane offset across the ramp
      const edge = (k) => { let t = 0; while (t < 40 && level[idx(P.x + ax + (dx ? 0 : k) + dx * t, P.y + ay + (dy ? 0 : k) + dy * t)] >= lv) t++; return t; };
      const e0 = edge(0), e1 = edge(1);
      if (e0 !== e1 || e0 < 3) continue;
      // the ground below must be open for the foot of the stairs
      let ok = true;
      for (let t = e0; t < e0 + 4 && ok; t++) for (let k = 0; k <= 1; k++) {
        const x = P.x + ax + (dx ? 0 : k) + dx * t, y = P.y + ay + (dy ? 0 : k) + dy * t;
        if (!inside(x, y) || level[idx(x, y)] !== lv - 1 || terrain[idx(x, y)] === TERRAIN.WATER || occupied[idx(x, y)]) ok = false;
      }
      if (ok && (!best || Math.abs(lane) < Math.abs(best.lane))) best = { lane, e: e0, ax, ay };
    }
    if (!best) return;
    // corner heights along the ramp: lv at the top corner line, lv-1 at the bottom one, five tiles apart
    const t0 = best.e - 2, t1 = best.e + 3;                     // tile steps covered by the ramp
    for (let t = t0; t <= t1 + 1; t++) for (let k = 0; k <= 2; k++) {
      const cxp = P.x + best.ax + (dx ? 0 : k) + (dx > 0 ? t : dx < 0 ? -t + 1 : 0);
      const cyp = P.y + best.ay + (dy ? 0 : k) + (dy > 0 ? t : dy < 0 ? -t + 1 : 0);
      const f = Math.max(0, Math.min(1, (t - t0) / (t1 + 1 - t0)));
      height[cyp * W1 + cxp] = (lv - f) * LEVEL_H;
    }
    for (let t = t0; t <= t1; t++) for (let k = 0; k <= 1; k++) {
      const x = P.x + best.ax + (dx ? 0 : k) + dx * t, y = P.y + best.ay + (dy ? 0 : k) + dy * t;
      cliff[idx(x, y)] = 2; reserved[idx(x, y)] = 1;
    }
    stairs.push({ x: P.x + best.ax + dx * (best.e + 0.5) + (dx ? 0 : 1), y: P.y + best.ay + dy * (best.e + 0.5) + (dy ? 0 : 1), dir, lv });
  }
  for (const P of PLATEAUS) { cutStairs(P, 1, P.ramp); if (P.inner) cutStairs(P, 2, P.inner.ramp); }
  // gentle rolling hills in the open country (never in town, by the lake or in the camp)
  const townD = (x, y) => Math.hypot(Math.max(0, TOWN.x0 - x, x - TOWN.x1), Math.max(0, TOWN.y0 - y, y - TOWN.y1));
  const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
    const n = fbm(cx / 17, cy / 17, seed + 61, 3);
    let g = Math.max(0, n - 0.42) * 1.9;
    const rd = riverD[idx(Math.min(W - 1, cx), Math.min(H - 1, cy))];
    g *= sm(2, 9, Math.hypot(Math.max(0, FARMQ.x0 - cx, cx - FARMQ.x1 - 1), Math.max(0, FARMQ.y0 - cy, cy - FARMQ.y1 - 1))) * sm(4, 16, townD(cx, cy)) * sm(1, 7, lakeDist(cx, cy)) * sm(8, 16, Math.hypot(cx - C.x, cy - C.y)) * sm(6, 14, Math.hypot(cx - S.x, cy - S.y)) * sm(3, 9, rd) * sm(1, 7, seaDist(cx, cy, seed));
    height[cy * W1 + cx] += g;
  }
  // the mountains along the north edge (they carry on rising past it: see shared/outskirts.js)
  const mtn = new Float32Array(W1 * (H + 1));
  for (let cy = 0; cy <= Math.min(H, 24); cy++) for (let cx = 0; cx <= W; cx++) { const m = mountainH(cx, cy, seed); mtn[cy * W1 + cx] = m; height[cy * W1 + cx] += m; }
  const mtnAt = (x, y) => Math.max(mtn[y * W1 + x], mtn[y * W1 + x + 1], mtn[(y + 1) * W1 + x], mtn[(y + 1) * W1 + x + 1]);
  for (let y = 0; y < Math.min(H, 24); y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), m = mtnAt(x, y);
    if (m > 1.0) { solid[i] = 1; reserved[i] = 1; if (terrain[i] === TERRAIN.FOREST) terrain[i] = TERRAIN.GRASS; }
    if (m > 0.05) forestness[i] = Math.min(forestness[i], 0.4);
  }
  // landmarks up on the plateaus (placed once the heights are known)
  function landmark(id, cx, cy, tier, build) {
    let best = null;
    for (let r = 0; r <= 8 && !best; r++) for (let oy = -r; oy <= r && !best; oy++) for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy; let ok = true;
      for (let yy = y - 2; yy <= y + 2 && ok; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (!inside(xx, yy) || level[idx(xx, yy)] !== tier || occupied[idx(xx, yy)] || solid[idx(xx, yy)] || terrain[idx(xx, yy)] === TERRAIN.WATER) { ok = false; break; }
      if (ok) { best = [x, y]; break; }
    }
    if (!best) best = [cx, cy];
    const [x, y] = best;
    for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) if (inside(xx, yy)) { reserved[idx(xx, yy)] = 1; if (terrain[idx(xx, yy)] === TERRAIN.FOREST) terrain[idx(xx, yy)] = TERRAIN.GRASS; }
    build(x, y);
    spots[id] = { x: x + 0.5, y: y + 0.5, r: 4 };
  }
  landmark('bandit_hideout', 44, 160, 1, (x, y) => { force('tent', x - 3, y - 2); force('tent', x + 2, y - 3); force('campfire', x, y); force('crate', x + 2, y + 1); force('barrel', x - 2, y + 1); force('banner', x - 1, y - 3, 0); });
  landmark('old_watchtower', 16, 86, 1, (x, y) => { for (const [ox, oy, k] of [[-1, -1, 'stonewall_x'], [0, -1, 'stonewall_x'], [1, -1, 'stonewall_x'], [-1, 0, 'stonewall_y'], [1, 0, 'stonewall_y'], [-1, 1, 'rockpile'], [2, 1, 'rockpile']]) force(k, x + ox, y + oy); force('pillar', x, y + 2); force('pillar', x - 2, y - 2); });
  landmark('frozen_shrine', 150, 22, 2, (x, y) => { force('shrine', x - 1, y - 1); force('pillar', x - 2, y + 1); force('pillar', x + 1, y + 1); });
  landmark('sunken_altar', 163, 153, 1, (x, y) => { force('shrine', x - 1, y - 1); force('candles', x - 2, y + 1); force('candles', x + 1, y + 1); force('bones', x + 2, y - 1, 0); force('bones', x - 3, y, 1); });

  // tiles whose corners differ a lot are cliff faces: impassable, nothing grows there
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (cliff[i] === 2) continue;
    const c = [height[y * W1 + x], height[y * W1 + x + 1], height[(y + 1) * W1 + x], height[(y + 1) * W1 + x + 1]];
    if (Math.max(...c) - Math.min(...c) > 0.8) { cliff[i] = 1; solid[i] = 1; reserved[i] = 1; }
  }

  // --- impassable border --------------------------------------------------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (Math.min(x, y, W - 1 - x, H - 1 - y) < 2 || W - 1 - x < 5) solid[idx(x, y)] = 1;

  // --- where people go: how far each tile is from a road, a camp, a hunting ground, a shore -----------
  // Trees stay sparse wherever you walk, fight or fish, and the woods only close in on the
  // land in between and along the edges. A tree also counts as "where you go" if it stands in
  // front of such a place (towards the camera), so it never hides the path behind it.
  const play = new Float32Array(W * H).fill(99);
  const ring = (cx, cy, r) => {
    for (let y = Math.max(0, Math.floor(cy - r - 16)); y < Math.min(H, cy + r + 16); y++) for (let x = Math.max(0, Math.floor(cx - r - 16)); x < Math.min(W, cx + r + 16); x++) {
      const d = Math.max(0, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
      if (d < play[idx(x, y)]) play[idx(x, y)] = d;
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), t = terrain[i];
    if (t === TERRAIN.DIRT || t === TERRAIN.STONE || inTown(x, y, 6)) play[i] = 0;
    else if (t === TERRAIN.SAND || (t === TERRAIN.WATER ? false : (lakeDist(x, y) < 3 || riverD[i] < 4 || sea[i] < 4))) play[i] = 0;   // shores: fishing
    else if (x >= FARMQ.x0 - 4 && x <= FARMQ.x1 + 4 && y >= FARMQ.y0 - 4 && y <= FARMQ.y1 + 4) play[i] = 0;
  }
  for (const s of Object.values(spots)) ring(s.x, s.y, (s.r || 4) + 3);
  ring(C.x, C.y, 13); ring(S.x, S.y, 16);
  for (const [gx, gy] of [[-29, -2], [-23, 3], [-17, -3], [-13, 6], [-8, -1], [-6, 6], [-4, -6], [5, -4], [6, 5], [-3, 9], [-26, -12], [-24, -14]]) ring(C.x + gx * 1.15, C.y + gy * 1.15, 4);
  for (const P of SPAWN_PLAN) ring(P.x, P.y, P.r + 3);
  for (const s of stairs) ring(s.x, s.y, 3);
  // spread: chamfer distance (1 straight, 1.4 diagonal), two passes
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y); let v = play[i];
    if (x > 0) v = Math.min(v, play[i - 1] + 1);
    if (y > 0) { v = Math.min(v, play[i - W] + 1); if (x > 0) v = Math.min(v, play[i - W - 1] + 1.4); if (x < W - 1) v = Math.min(v, play[i - W + 1] + 1.4); }
    play[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = idx(x, y); let v = play[i];
    if (x < W - 1) v = Math.min(v, play[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, play[i + W] + 1); if (x < W - 1) v = Math.min(v, play[i + W + 1] + 1.4); if (x > 0) v = Math.min(v, play[i + W - 1] + 1.4); }
    play[i] = v;
  }
  // in front of a place (larger x + y) counts as near it: tall trees there would stand in the way
  const near = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = play[idx(x, y)];
    for (let k = 1; k <= 5; k++) {
      if (x - k < 0 || y - k < 0) break;
      v = Math.min(v, play[idx(x - k, y - k)] + k * 0.6);
      if (x - k + 1 >= 0) v = Math.min(v, play[idx(x - k + 1, y - k)] + k * 0.6 + 0.4);
      if (y - k + 1 >= 0) v = Math.min(v, play[idx(x - k, y - k + 1)] + k * 0.6 + 0.4);
    }
    near[idx(x, y)] = v;
  }
  // forest floor only where the woods are actually thick
  for (let i = 0; i < W * H; i++) if (terrain[i] === TERRAIN.FOREST && near[i] < 5) terrain[i] = TERRAIN.GRASS;

  // --- trees, rocks, bushes, decor ----------------------------------------------
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (reserved[i] || occupied[i] || terrain[i] === TERRAIN.WATER) continue;
    const f = forestness[i], r = hash2(x, y, seed);
    const r2 = hash2(x, y, seed + 99);
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    // keep a 1-tile gap between trees so the forest stays walkable (except borders)
    let crowded = false;
    if (edge > 3) for (let oy = -1; oy <= 1 && !crowded; oy++) for (let ox = -1; ox <= 1; ox++)
      if (occupied[idx(x + ox, y + oy)]) { crowded = true; break; }
    const ld = lakeDist(x, y), pd = near[i], band = W - 1 - x < 11, foot = y < 26 && mtnAt(x, y) > 0.08;
    // the eastern edge is solid forest; in the open the woods thin out the closer you are to where people go
    let treeChance;
    if (band && !foot) { treeChance = 0.6; crowded = false; }
    else if (foot) treeChance = 0.06;                                         // a few pines on the foothills
    else if (pd < 2.5) treeChance = 0;
    else if (pd < 7) treeChance = ld < 9 ? 0.06 : f > 0.62 ? 0.06 : 0.018;
    else if (pd < 12) treeChance = f > 0.62 ? 0.2 : f > 0.5 ? 0.06 : ld < 9 ? 0.08 : 0.025;
    else treeChance = f > 0.62 ? 0.5 : f > 0.5 ? 0.14 : ld < 9 ? 0.1 : 0.03;
    if (!crowded && r < treeChance) {
      let kind = foot || (fbm(x / 10, y / 10, seed + 21, 2) + (x > 110 ? 0.15 : 0)) > 0.55 ? 'pine' : 'oak';
      if (kind === 'oak') {
        const m = fbm(x / 8, y / 8, seed + 31, 2);           // groves: autumn maples here, birches there
        if (m > 0.63) kind = 'maple'; else if (m < 0.36) kind = 'birch';
        if (ld < 9 && hash2(x, y, seed + 41) < 0.7) kind = 'willow';
      }
      place(kind, x, y, Math.floor(r2 * 3));
    } else if (!crowded && r < treeChance + (pd < 2.5 ? 0.006 : 0.012)) {
      place(r2 < 0.5 ? 'rock' : 'stump', x, y, Math.floor(r2 * 6));
    } else if (!crowded && r < treeChance + (pd < 2.5 ? 0.016 : 0.03)) {
      place('bush', x, y, Math.floor(r2 * 2));
    } else if (r2 < 0.07 && terrain[i] !== TERRAIN.SAND) {
      place(f > 0.6 ? (r < 0.6 ? 'fern' : 'tuft') : (r < 0.5 ? 'tuft' : 'flowers'), x, y, Math.floor(r * 3));
    }
  }
  // decor sprinkled on otherwise-empty grass (in town too, not on streets)
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y);
    if (occupied[i] || solid[i] || terrain[i] !== TERRAIN.GRASS || inTown(x, y)) continue;
    if (hash2(x, y, seed + 5) < 0.05) place(hash2(x, y, seed + 6) < 0.6 ? 'tuft' : 'flowers', x, y, x + y);
  }

  // roadside planting: bushes and the odd tree a couple of tiles off the country roads
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = idx(x, y);
    if (terrain[i] !== TERRAIN.GRASS || occupied[i] || solid[i] || inTown(x, y, 1) || riverD[i] < 4) continue;
    if (x >= FARMQ.x0 - 1 && x <= FARMQ.x1 + 1 && y >= FARMQ.y0 - 1 && y <= FARMQ.y1 + 1) continue;
    let road = false, busy = false;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const t = terrain[idx(x + ox, y + oy)];
      if (t === TERRAIN.DIRT && Math.max(Math.abs(ox), Math.abs(oy)) === 2) road = true;
      if (t === TERRAIN.DIRT && Math.max(Math.abs(ox), Math.abs(oy)) < 2) busy = true;
      if (occupied[idx(x + ox, y + oy)] && Math.abs(ox) <= 1 && Math.abs(oy) <= 1) busy = true;
    }
    if (!road || busy || Math.hypot(x - C.x, y - C.y) < 11) continue;
    // a tree only on the far side of the road, where it can't stand between you and the way ahead
    let behind = false;
    for (const [ox, oy] of [[1, 1], [2, 2], [2, 1], [1, 2]]) if (terrain[idx(x + ox, y + oy)] === TERRAIN.DIRT) behind = true;
    const h = hash2(x, y, seed + 61);
    if (h < 0.07) place('bush', x, y, x + y);
    else if (h < 0.1 && behind && W - 1 - x > 12) place(fbm(x / 10, y / 10, seed + 21, 2) > 0.55 ? 'pine' : 'oak', x, y, (x * 3 + y) % 3);
    else if (h < 0.16) place('flowers', x, y, x + y);
  }

  // reeds along the lake shore, lily pads on the shallows
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y), h = hash2(x, y, seed + 51);
    if (occupied[i]) continue;
    let wet = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (terrain[idx(x + ox, y + oy)] === TERRAIN.WATER) wet++;
    if (terrain[i] === TERRAIN.SAND && wet >= 2 && h < 0.4) place('reeds', x, y, x * 3 + y);
    else if (terrain[i] === TERRAIN.WATER && h < 0.12 && lakeDist(x, y) > -4 && sea[i] > 3) objects.push({ kind: 'lily', tx: x, ty: y, x: x + 0.5, y: y + 0.5, sprite: OBJECTS.lily.sprites[(x + y * 2) % 3] });
  }

  // --- gathering spots: herbs, ore veins and trees you can chop (entities on the server) ------
  const nodes = [];
  const lvl = (x, y) => level[idx(x, y)];
  const nearCliff = (x, y, r = 1) => { for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (inside(x + ox, y + oy) && cliff[idx(x + ox, y + oy)] === 1) return true; return false; };
  const nearWater = (x, y, r = 2) => { for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (inside(x + ox, y + oy) && terrain[idx(x + ox, y + oy)] === TERRAIN.WATER) return true; return false; };
  const roomy = (x, y) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!inside(x + ox, y + oy) || occupied[idx(x + ox, y + oy)] || solid[idx(x + ox, y + oy)]) return false; return true; };
  const ore = (k) => k === 'copper' || k === 'iron' || k === 'silver';
  // ore sits against a cliff: no objects round it, and no more than three blocked neighbours
  const openish = (x, y) => {
    let blocked = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!inside(x + ox, y + oy) || occupied[idx(x + ox, y + oy)]) return false;
      if (solid[idx(x + ox, y + oy)]) blocked++;
    }
    return blocked <= 3;
  };
  const NODE_RULES = [
    ['sunleaf', 45, (x, y, t, f) => t === TERRAIN.GRASS && f < 0.5 && !lvl(x, y)],
    ['mint', 30, (x, y, t) => (t === TERRAIN.GRASS || t === TERRAIN.SAND) && nearWater(x, y, 2)],
    ['bloodmoss', 30, (x, y, t, f) => f > 0.6],
    ['frostcap', 24, (x, y, t) => t !== TERRAIN.SAND && lvl(x, y) >= 1],
    ['nightbloom', 18, (x, y, t, f) => t === TERRAIN.GRASS && f < 0.4],
    ['copper', 22, (x, y) => nearCliff(x, y, 1) && townD(x, y) > 14],
    ['iron', 14, (x, y) => nearCliff(x, y, 1) && townD(x, y) > 30],
    ['silver', 8, (x, y) => nearCliff(x, y, 1) && (lvl(x, y) >= 2 || townD(x, y) > 42)],
    ['oak_tree', 26, (x, y, t, f) => t === TERRAIN.GRASS && f > 0.3 && f < 0.62],
    ['pine_tree', 22, (x, y, t, f) => f > 0.58],
    ['elder_tree', 10, (x, y, t, f) => (f > 0.58 && x > 150) || (lvl(x, y) >= 1 && f > 0.3)],
  ];
  for (const [kind, count, ok] of NODE_RULES) {
    const solidKind = ['copper', 'iron', 'silver', 'oak_tree', 'pine_tree', 'elder_tree'].includes(kind);
    const cands = [];
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const i = idx(x, y), t = terrain[i];
      if (reserved[i] || occupied[i] || solid[i] || cliff[i] || t === TERRAIN.WATER || t === TERRAIN.DIRT || t === TERRAIN.STONE) continue;
      if (inTown(x, y, 4) || Math.hypot(x - C.x, y - C.y) < 12 || Math.hypot(x - S.x, y - S.y) < 5) continue;
      if (play[i] > 12 || W - 1 - x < 12) continue;                          // gathering stays within reach of the paths
      if (solidKind && !(ore(kind) ? openish(x, y) : roomy(x, y))) continue;
      if (!ok(x, y, t, forestness[i])) continue;
      cands.push([hash2(x, y, seed + 300 + kind.length * 17), x, y]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, x, y] of cands) {
      if (n >= count) break;
      if (nodes.some((o) => Math.hypot(o.x - x - 0.5, o.y - y - 0.5) < (o.kind === kind ? 6 : 2.5))) continue;
      nodes.push({ kind, x: x + 0.5, y: y + 0.5 });
      if (solidKind) { solid[idx(x, y)] = 1; occupied[idx(x, y)] = 1; }
      n++;
    }
  }

  // buildings sit level: flatten the ground under anything bigger than a tile
  for (const o of objects) {
    const [fw, fh] = OBJECTS[o.kind].foot;
    if (fw < 2 && fh < 2) continue;
    const ccx = Math.round(o.x), ccy = Math.round(o.y), hc = height[ccy * W1 + ccx];
    for (let cy = o.ty - 1; cy <= o.ty + fh + 1; cy++) for (let cx = o.tx - 1; cx <= o.tx + fw + 1; cx++)
      if (cx >= 0 && cy >= 0 && cx <= W && cy <= H) height[cy * W1 + cx] = hc;
  }

  // --- spawns ---------------------------------------------------------------
  const walkable = (x, y) => inside(Math.floor(x), Math.floor(y)) && !solid[idx(Math.floor(x), Math.floor(y))];
  function freeNear(x, y) {
    for (let r = 0; r < 8; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++)
      if (walkable(x + ox, y + oy)) return { x: Math.floor(x + ox) + 0.5, y: Math.floor(y + oy) + 0.5 };
    return { x, y };
  }
  const spawns = [];
  // spread out like a classic MMO: monsters stand alone or in pairs, several tiles apart, so you
  // can pull one or two at a time instead of the whole field
  const GAP = 6;
  const mobGap = (x, y, gap = GAP) => !spawns.some((o) => Math.hypot(o.x - x, o.y - y) < gap);
  // dry, open ground at least a tile from any water (no monsters standing in the lake or at its very edge)
  const dry = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = tx + ox, Y = ty + oy; if (!inside(X, Y) || terrain[idx(X, Y)] === TERRAIN.WATER) return false; } return true; };
  // every monster area keeps to its own ground: a spot closer to another area's centre belongs to that area
  const AREA_HOMES = [{ x: S.x, y: S.y, id: 'slime' }, { x: C.x, y: C.y, id: 'goblin' }, ...SPAWN_PLAN.filter((P) => P.r > 1).map((P, i) => ({ x: P.x, y: P.y, id: 'p' + i }))];
  const ownGround = (x, y, id) => { const mine = AREA_HOMES.find((h) => h.id === id); const d0 = Math.hypot(mine.x - x, mine.y - y); return !AREA_HOMES.some((h) => h.id !== id && Math.hypot(h.x - x, h.y - y) < d0 - 2 && Math.hypot(h.x - mine.x, h.y - mine.y) > 4); };
  for (let i = 0; i < 23; i++) {
    let got = null;
    for (let t = 0; t < 40 && !got; t++) { const a = rand() * Math.PI * 2, d = 5 + rand() * 30; const c = freeNear(S.x + Math.cos(a) * d, S.y + Math.sin(a) * d); if (dry(c.x, c.y) && ownGround(c.x, c.y, 'slime') && mobGap(c.x, c.y, 5)) got = c; }
    if (got) spawns.push({ kind: 'slime', ...got });
  }
  const goblinSpots = [[-29, -2], [-23, 3], [-17, -3], [-13, 6], [-8, -1], [-6, 6], [-4, -6], [5, -4], [6, 5], [-3, 9], [-26, -12], [-24, -14]];
  for (const [gx, gy] of goblinSpots) { const c = freeNear(C.x + gx * 1.5, C.y + gy * 1.5); if (dry(c.x, c.y) && mobGap(c.x, c.y, 5)) spawns.push({ kind: 'goblin', ...c }); }
  spawns.push({ kind: 'goblin_chief', ...freeNear(C.x + 2, C.y + 1) });
  // the four new regions: monsters on the right tier of their plateau, never on a stair or in a camp
  let planI = -1;
  const plans = SPAWN_PLAN.map((P) => { if (P.r > 1) planI++; const boss = P.r <= 1; return { P, pid: 'p' + planI, boss, n: boss ? P.n : Math.max(3, Math.round(P.n * 2.9)), R: boss ? 0 : Math.min(P.r * 4, 34), left: 0, miss: 0 }; });
  // bosses first (their ground is kept clear), then every kind takes turns, one monster each,
  // so two kinds sharing a region both get their share of the room
  // quiet ground: no monsters near Tobin's fishing spot by the lake (a level 5 quest giver)
  const QUIET = [{ ...freeNear(L.x + 9, L.y + 14), r: 22 }];
  const placeMob = (pl) => {
    const { P, pid, boss, R } = pl;
    let got = null;
    for (let t = 0; t < 400 && !got; t++) {
      const a = rand() * Math.PI * 2, d = boss ? 0 : 1 + Math.sqrt(rand()) * R;
      const x = Math.floor(P.x + Math.cos(a) * d), y = Math.floor(P.y + Math.sin(a) * d);
      if (!inside(x, y) || solid[idx(x, y)] || cliff[idx(x, y)] || (level[idx(x, y)] || 0) !== (P.tier || 0) || terrain[idx(x, y)] === TERRAIN.WATER) continue;
      if (Object.values(spots).some((s) => Math.hypot(s.x - x, s.y - y) < (s.r || 4) + 2)) continue;
      if (x >= TOWN.x0 - 6 && x <= TOWN.x1 + 6 && y >= TOWN.y0 - 6 && y <= TOWN.y1 + 6) continue;   // never in or right beside town
      if (!boss && QUIET.some((q) => Math.hypot(q.x - x, q.y - y) < q.r)) continue;
      if (!boss && (!dry(x + 0.5, y + 0.5) || !ownGround(x + 0.5, y + 0.5, pid))) continue;
      // the same rule everywhere: no two monsters closer than the distance at which one notices you,
      // so walking up to one wakes one (two at most), never the whole pack
      if (!boss && !mobGap(x + 0.5, y + 0.5, GAP + 0.5)) continue;
      got = { x: x + 0.5, y: y + 0.5 };
    }
    if (got || boss) { spawns.push({ kind: P.kind, ...(got || freeNear(P.x, P.y)) }); return true; }
    return false;
  };
  for (const pl of plans) if (pl.boss) for (let k = 0; k < pl.n; k++) placeMob(pl);
  const herds = plans.filter((pl) => !pl.boss);
  for (const pl of herds) pl.left = pl.n;
  while (herds.some((pl) => pl.left > 0)) for (const pl of herds) if (pl.left > 0) { pl.left--; if (!placeMob(pl) && ++pl.miss >= 3) pl.left = 0; }

  const npcs = [
    { kind: 'elder', x: 99.5, y: 99.2, dir: 1 },
    { kind: 'pip', x: 92.3, y: 104.6, dir: 1 },
    // shopkeepers behind their counters, Bess behind the bar, Wren before the altar
    { kind: 'merchant', x: 73.5, y: 95.5, dir: 0 },
    { kind: 'armorer', x: 73.5, y: 102.5, dir: 0 },
    { kind: 'apothecary', x: 73.5, y: 109.5, dir: 0 },
    { kind: 'smith', x: 107.6, y: 96.6, dir: 1 },
    { kind: 'innkeeper', x: 113.5, y: 94.1, dir: 2 },
    { kind: 'wren', x: 116.5, y: 105.6, dir: 2 },
    { kind: 'tobin', ...freeNear(L.x + 9, L.y + 14), dir: 5 },
    ...TOWN.clerks.map((x, i) => ({ kind: `clerk_${i + 1}`, x: x + 0.5, y: 82.4, dir: 2 })),
  ];
  // --- town life ---------------------------------------------------------------
  // every lived-in house: its front door (the street tile before it) and its hours
  const homes = [];
  for (const o of objects) {
    if (!HOMES.has(o.kind) || o.hid === undefined || !inTown(o.tx, o.ty) || !hoursOf(o.kind, o.hid)) continue;
    const [fw, fh] = OBJECTS[o.kind].foot;
    const dx = Math.floor(o.tx + fw / 2 - 0.45), dy = o.ty + fh;
    if (!walkable(dx, dy)) continue;
    homes.push({ hid: o.hid, kind: o.kind, x: dx + 0.5, y: dy + 0.5 });
  }
  // townsfolk each live in one of them, spread around the town
  const homeOrder = homes.map((h, i) => [hash2(i, 13, seed), h]).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
  for (let i = 0; i < 10; i++) {
    const h = homeOrder[i % homeOrder.length];
    npcs.push({ kind: `folk_${i + 1}`, x: h.x, y: h.y, dir: 2, home: h });
  }
  // places to sit: [x, y, facing, the walkable tile you sit down from]
  const seats = [];
  for (const o of objects) {
    if (o.kind === 'bench_x') for (const sx of [0.5, 1.5]) seats.push({ x: o.tx + sx, y: o.ty + 0.45, dir: 2, fx: o.tx + sx, fy: o.ty + 1.5 });
    if (o.kind === 'bank_bench_w') for (const sy of [0.5, 1.5]) seats.push({ x: o.tx + 0.55, y: o.ty + sy, dir: 0, fx: o.tx + 1.5, fy: o.ty + sy });
    if (o.kind === 'bank_bench_e') for (const sy of [0.5, 1.5]) seats.push({ x: o.tx + 0.45, y: o.ty + sy, dir: 4, fx: o.tx - 0.5, fy: o.ty + sy });
  }
  // animals: cats about the square and the lanes, a dog on the streets, hens at the farms
  const critter = (kind, x, y, roam) => { const p = freeNear(x, y); npcs.push({ kind, ...p, dir: Math.floor(hash2(x, y, seed) * 8), roam }); };
  critter('cat_1', 90, 101, 9); critter('cat_2', 84, 72, 8); critter('cat_3', 106, 128, 8);
  critter('dog_1', 96, 108, 16);
  for (const [i, [x, y]] of [[62, 115], [64, 114], [61, 111], [mill ? mill[0] - 2 : 134, mill ? mill[1] + 2 : 126], [mill ? mill[0] + 4 : 140, mill ? mill[1] + 5 : 129],
    [mill ? mill[0] : 136, mill ? mill[1] + 5 : 129]].entries()) critter(`hen_${i + 1}`, x, y, 4);
  // the carter's round: in by the north road, along every cross street, out by the south road and back
  const leg = [[96, 50], [96, 63], [119.5, 63], [73.5, 63], [96, 63], [96, 76], [73.5, 76], [119.5, 76], [96, 76], [96, 92.5], [110, 92.5], [110, 112.5],
    [96, 112.5], [96, 121], [119.5, 121], [73.5, 121], [96, 121], [96, 134], [119.5, 134], [73.5, 134], [96, 134], [96, 152]];
  const cartRoute = [...leg, ...leg.slice(1, -1).reverse()].map(([x, y]) => freeNear(x, y));
  npcs.push({ kind: 'carter', ...cartRoute[0], dir: 2, route: cartRoute });
  // the watch: by the north gate all day, round the streets with a lantern all night
  const watchRoute = [[96, 57], [96, 63], [73.5, 63], [119.5, 63], [96, 63], [96, 76], [119.5, 76], [73.5, 76], [96, 76], [96, 92.5], [84, 92.5], [84, 112.5],
    [96, 112.5], [96, 121], [73.5, 121], [119.5, 121], [96, 121], [96, 134], [73.5, 134], [119.5, 134], [96, 134], [96, 144], [96, 112.5], [108, 112.5], [108, 92.5], [96, 92.5]]
    .map(([x, y]) => freeNear(x, y));
  npcs.push({ kind: 'watchman', x: 94.5, y: 56.5, dir: 2, post: { x: 94.5, y: 56.5, dir: 2 }, route: watchRoute });
  // quest-givers at the camps, trainers on the square
  const atSpot = (id, ox, oy) => freeNear(spots[id].x + ox, spots[id].y + oy);
  npcs.push({ kind: 'warden_elsa', ...atSpot('thornwick', -1.5, 1.5), dir: 2 }, { kind: 'trapper_odo', ...atSpot('thornwick', 2, 2.5), dir: 3 });
  npcs.push({ kind: 'captain_rourke', ...atSpot('ridgewatch', -1.5, 1.5), dir: 2 }, { kind: 'scout_tamsin', ...atSpot('ridgewatch', 2, 2.5), dir: 3 });
  npcs.push({ kind: 'hermit_ysolde', ...atSpot('hermitage', -1.5, 1.5), dir: 2 });
  npcs.push({ kind: 'witch_corda', ...atSpot('fenwatch', -1.5, 1.5), dir: 2 }, { kind: 'ferryman_gil', ...atSpot('fenwatch', 2, 2.5), dir: 3 });
  npcs.push({ kind: 'trainer_warrior', ...freeNear(86.5, 95.5), dir: 1 }, { kind: 'trainer_ranger', ...freeNear(86.5, 109.5), dir: 7 }, { kind: 'trainer_mage', ...freeNear(105.5, 109.5), dir: 5 });
  // the four gate guards
  GUARD_POSTS.forEach(([x, y, dx, dy], i) => npcs.push({ kind: `guard_${i + 1}`, x: x + 0.5, y: y + 0.5, dir: dirFromVector(dx, dy), post: { x: x + 0.5, y: y + 0.5, dir: dirFromVector(dx, dy) } }));
  // Farmer Oswin keeps the produce stall on the square every day
  npcs.push({ kind: 'farmer', x: 84.5, y: 108.5, dir: 0 });

  // waystones: one by the town square and one at each camp. A clear ring round each,
  // so a stone never closes a path.
  const placeStone = (id, x, y) => {
    for (let r = 0; r <= 6; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const tx = Math.floor(x) + ox, ty = Math.floor(y) + oy;
      let ok = canPlace('waystone', tx, ty, true);
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1 && ok; i++) {
        const k = idx(tx + i, ty + j);
        if (!inside(tx + i, ty + j) || occupied[k] || solid[k] || terrain[k] === TERRAIN.WATER) ok = false;
      }
      if (!ok) continue;
      place('waystone', tx, ty);
      objects[objects.length - 1].stone = id;
      return;
    }
  };
  placeStone('town', 92, 107);   // on the square, by where heroes arrive
  placeStone('thornwick', spots.thornwick.x - 4, spots.thornwick.y + 2);
  placeStone('ridgewatch', spots.ridgewatch.x - 4, spots.ridgewatch.y + 2);
  placeStone('hermitage', spots.hermitage.x + 3, spots.hermitage.y + 2);
  placeStone('fenwatch', spots.fenwatch.x + 3, spots.fenwatch.y - 3);
  // mailboxes (the post, see world_mail.js): on the square, by the bank, by the inn, and one at each
  // camp beside its waystone. Same clear ring round each, so none ever blocks a way through.
  const placeMailbox = (x, y) => {
    for (let r = 0; r <= 6; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const tx = Math.floor(x) + ox, ty = Math.floor(y) + oy;
      let ok = canPlace('mailbox', tx, ty, true);
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1 && ok; i++) {
        const k = idx(tx + i, ty + j);
        if (!inside(tx + i, ty + j) || occupied[k] || solid[k] || terrain[k] === TERRAIN.WATER) ok = false;
      }
      if (!ok) continue;
      place('mailbox', tx, ty);
      return;
    }
  };
  placeMailbox(98, 107); placeMailbox(96, 95); placeMailbox(112, 98);
  for (const id of ['thornwick', 'ridgewatch', 'hermitage', 'fenwatch']) { const st = objects.find((o) => o.kind === 'waystone' && o.stone === id); if (st) placeMailbox(st.x + 2.5, st.y + 0.5); }

  // ---- places off the road: abandoned camps with a note left behind, wayside shrines that
  // bless whoever kneels, a fisherman's hut on the lake, ruins with something still in them.
  // Each goes in the nearest open clearing to its spot. (World, server and client all build the
  // same ones from the seed.)
  const pois = [];
  const clearAt = (tx, ty, r) => {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      const k = idx(x, y);
      if (!inside(x, y) || occupied[k] || solid[k] || reserved[k] || terrain[k] === TERRAIN.WATER || terrain[k] === TERRAIN.STONE) return false;
    }
    return true;
  };
  const findClear = (ax, ay, r, wet) => {
    for (let d = 0; d <= 18; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== d) continue;
      const tx = Math.floor(ax) + ox, ty = Math.floor(ay) + oy;
      if (!clearAt(tx, ty, r)) continue;
      if (wet) { let near = false; for (let dy = -6; dy <= 6 && !near; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.hypot(dx, dy) > r + 1 && inside(tx + dx, ty + dy) && terrain[idx(tx + dx, ty + dy)] === TERRAIN.WATER) { near = true; break; } if (!near) continue; }
      return { x: tx, y: ty };
    }
    return null;
  };
  const put1 = (k, x, y, v = 0) => { if (canPlace(k, x, y, true)) place(k, x, y, v); };
  for (const P of POI_DEFS) {
    const at = findClear(P.x, P.y, 2, P.kind === 'hut');
    if (!at) continue;
    const { x, y } = at, poi = { id: P.id, kind: P.kind, name: P.name, x: x + 0.5, y: y + 0.5 };
    if (P.kind === 'camp') {
      put1('tent', x - 2, y - 2); put1('logs', x + 1, y + 1); put1('rockpile', x - 2, y + 1); put1('crate', x + 2, y - 1); put1('bones', x - 1, y + 2, 1);
      put1('campboard', x, y - 1, (x + y) % 4); poi.at = { x: x + 0.5, y: y - 0.5 };
    } else if (P.kind === 'shrine') {
      put1('shrine', x, y - 1); put1('candles', x - 1, y + 1); put1('candles', x + 2, y + 1); put1('flowers', x + 2, y - 1, 1); put1('flowers', x - 1, y - 1, 2);
      poi.at = { x: x + 1, y: y + 0.6 };
    } else if (P.kind === 'hut') {
      put1('house_small', x - 1, y - 2); put1('crate', x + 2, y + 1); put1('barrel', x + 2, y + 2); put1('logs', x - 2, y + 2);
      poi.npc = { x: x + 0.5, y: y + 2.5 };
    } else if (P.kind === 'ruin') {
      put1('pillar', x - 2, y - 2); put1('pillar', x + 2, y - 2); put1('stonewall_x', x - 1, y - 2); put1('rockpile', x + 1, y - 2); put1('rockpile', x - 2, y + 1);
      put1('pillar', x + 2, y + 1); put1('bones', x + 1, y + 2, 0); put1('stonewall_y', x - 2, y);
      poi.at = { x: x + 0.5, y: y + 0.5 };
    }
    pois.push(poi);
  }
  for (const P of pois) if (P.npc) npcs.push({ kind: 'fisher_hesk', ...P.npc, dir: 2 });

  // places to cook: the inn hearth and the goblins' camp fire
  const stations = [];
  for (const P of pois) if (P.at) stations.push({ kind: P.kind === 'camp' ? 'poi_note' : P.kind === 'shrine' ? 'poi_shrine' : 'poi_cache', x: P.at.x, y: P.at.y, poi: P.id });
  for (const o of objects) {
    if (o.kind === 'inn_fireplace') stations.push({ kind: 'hearth', x: o.x, y: o.y });
    if (o.kind === 'campfire' && Math.hypot(o.x - C.x, o.y - C.y) < 3) stations.push({ kind: 'campfire', x: o.x, y: o.y });
    if (o.kind === 'windmill') stations.push({ kind: 'mill', x: o.x, y: o.y + 0.6 });
    if (o.kind === 'waystone') stations.push({ kind: 'waystone', x: o.x, y: o.y, stone: o.stone });
    if (o.kind === 'mailbox') stations.push({ kind: 'mailbox', x: o.x, y: o.y });
    if (o.kind === 'campfire' && Object.values(spots).some((sp) => Math.hypot(sp.x - o.x, sp.y - o.y) < 2)) stations.push({ kind: 'campfire', x: o.x, y: o.y });
    if (o.kind === 'anvil' && Object.values(spots).some((sp) => Math.hypot(sp.x - o.x, sp.y - o.y) < 6)) stations.push({ kind: 'workbench', x: o.x, y: o.y });
  }

  // market days and the harvest festival: where the stalls, strings of flags and lanterns go up.
  // Only open cobbles on the square; the tiles stay walkable on other days.
  const square = (x, y) => x >= 78 && x <= 110 && y >= 92 && y <= 112;
  const freeT = (x, y) => inside(x, y) && !solid[idx(x, y)] && !occupied[idx(x, y)] && terrain[idx(x, y)] === STONE;
  const taken = new Set();
  const claim = (x0, y0, w, h, pad) => {
    for (let y = y0 - pad; y < y0 + h + pad; y++) for (let x = x0 - pad; x < x0 + w + pad; x++) if (!freeT(x, y) || taken.has(idx(x, y))) return false;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) taken.add(idx(x, y));
    return true;
  };
  const spotNear = (ax, ay, w, h, pad, r = 6) => {
    for (let d = 0; d <= r; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== d) continue;
      const x = ax + ox, y = ay + oy;
      if (square(x, y) && square(x + w - 1, y + h - 1) && claim(x, y, w, h, pad)) return [x, y];
    }
    return null;
  };
  const events = { market: [], festival: [] };
  // a post with a hanging picture board beside a stall (on its east side, or west if that's taken)
  const stallSign = (list, kind, s) => {
    for (const [ox, oy] of [[2, 0], [-1, 0], [2, 1], [-1, 1]]) {
      const x = s[0] + ox, y = s[1] + oy;
      if (!claim(x, y, 1, 1, 0)) continue;
      list.push({ prop: 'signpost', x: x + 0.5, y: y + 0.5, tx: x, ty: y });
      list.push({ prop: 'hsign', v: SIGN_KINDS.indexOf(kind), x: x + 0.5, y: y + 0.52 });
      return;
    }
  };
  // three traders' stalls with the trader behind the counter (north side), customers in front
  for (const [v, [ax, ay, k]] of [[85, 96, 'trader_spice'], [104, 97, 'trader_tackle'], [87, 100, 'trader_curio']].entries()) {
    const s = spotNear(ax, ay, 2, 2, 1);
    if (!s) continue;
    events.market.push({ prop: 'market_stall', v, x: s[0] + 1, y: s[1] + 1, tx: s[0], ty: s[1] });
    events.market.push({ npc: k, x: s[0] + 1, y: s[1] - 0.35, dir: 2, front: [0, 2.7] });
    stallSign(events.market, { trader_spice: 'spice', trader_tackle: 'tackle', trader_curio: 'curio' }[k], s);
  }
  // flags strung across the square (5 tiles of string between two poles)
  for (const [ax, ay] of [[90, 94], [101, 94], [90, 109], [101, 109]]) {
    const s = spotNear(ax, ay, 5, 1, 0, 4);
    if (s) events.market.push({ prop: 'bunting', x: s[0] + 2.5, y: s[1] + 0.5 });
  }
  // the festival: lantern strings, the harvest stall with pumpkins round it, dancers round the fountain
  for (const [ax, ay] of [[89, 97], [100, 97], [89, 107], [100, 107], [94, 95], [94, 109]]) {
    const s = spotNear(ax, ay, 5, 1, 0, 4);
    if (s) events.festival.push({ prop: 'lanterns', x: s[0] + 2.5, y: s[1] + 0.5 });
  }
  {
    const s = spotNear(83, 101, 2, 2, 1);
    if (s) {
      events.festival.push({ prop: 'harvest_stall', x: s[0] + 1, y: s[1] + 1, tx: s[0], ty: s[1] });
      events.festival.push({ npc: 'harvest_trader', x: s[0] + 1, y: s[1] - 0.35, dir: 2, front: [0, 2.7] });
      stallSign(events.festival, 'harvest', s);
      for (const [ox, oy, v] of [[-1, 0, 0], [2, 1, 1], [-1, 2, 1], [2, -1, 0]]) if (claim(s[0] + ox, s[1] + oy, 1, 1, 0)) events.festival.push({ prop: 'pumpkins', v, x: s[0] + ox + 0.5, y: s[1] + oy + 0.5, tx: s[0] + ox, ty: s[1] + oy });
    }
  }
  events.dance = [];
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, x = Math.floor(95.5 + Math.cos(a) * 4.6), y = Math.floor(101.5 + Math.sin(a) * 4.6);
    if (freeT(x, y) && !taken.has(idx(x, y))) events.dance.push({ x: x + 0.5, y: y + 0.5 });
  }
  // the raid comes in from the east, along the cross streets
  events.raidFrom = [[124.5, 63.5], [124.5, 76.5], [124.5, 121.5], [124.5, 134.5]].map(([x, y]) => freeNear(x, y));
  events.raidTo = [[96.5, 92.5], [96.5, 112.5], [88.5, 101.5], [104.5, 101.5]].map(([x, y]) => freeNear(x, y));

  // --- signs -------------------------------------------------------------------------------
  // Picture boards on every shop and trainer, at the stables, the fishing spot and the camps'
  // fires and workbenches; name boards at the outposts; signposts at the crossroads (shared/signs.js).
  // Placed last so nothing above moves. `signs` is where each one's board is, for hover names.
  const signs = [];
  {
  const keep = new Set();             // tiles people need: where everyone stands, sits and comes home
  for (const n of npcs) keep.add(idx(Math.floor(n.x), Math.floor(n.y)));
  for (const st of seats) keep.add(idx(Math.floor(st.fx), Math.floor(st.fy)));
  for (const hm of homes) keep.add(idx(Math.floor(hm.x), Math.floor(hm.y)));
  for (const st of stations) keep.add(idx(Math.floor(st.x), Math.floor(st.y)));
  for (const t of taken) keep.add(t);
  const signRoom = (x, y) => {       // a free tile with nothing solid all round, off the roads
    if (!inside(x, y) || occupied[idx(x, y)] || solid[idx(x, y)] || keep.has(idx(x, y))) return false;
    const t = terrain[idx(x, y)];
    if (t === TERRAIN.WATER || t === TERRAIN.DIRT || cliff[idx(x, y)]) return false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!inside(x + ox, y + oy) || solid[idx(x + ox, y + oy)] || terrain[idx(x + ox, y + oy)] === TERRAIN.WATER) return false;
    return true;
  };
  const near = (ax, ay, ok = signRoom, maxR = 6) => {
    for (let r = 0; r <= maxR; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      if (ok(ax + ox, ay + oy)) return [ax + ox, ay + oy];
    }
    return null;
  };
  const unStreet = (x, y) => { const k = streets.findIndex(([sx, sy]) => sx === x + 0.5 && sy === y + 0.5); if (k >= 0) streets.splice(k, 1); };
  const tip = (x, y, z, title, sub) => signs.push({ x, y, z, title, sub });
  // a picture board: on a wall bracket at a given tile, or on a post near a spot
  function hangSign(kind, tx, ty) {
    const st = SIGN_BOARDS[kind].style;
    if (st === 'p') { const t = near(tx, ty); if (!t) return null; [tx, ty] = t; unStreet(tx, ty); }
    force(st === 'p' ? 'signpost' : `hbracket_${st}`, tx, ty);
    objects.push({ kind: 'hsign', tx, ty, x: tx + 0.5, y: ty + 0.52, sprite: `hsign_${kind}` });
    const c = st === 'e' ? [tx + 0.46, ty + 0.5, 2.35] : st === 's' ? [tx + 0.5, ty + 0.46, 2.35] : [tx + 0.95, ty + 0.05, 2.3];
    tip(...c, SIGN_BOARDS[kind].title, SIGN_BOARDS[kind].sub);
    return [tx, ty];
  }
  // the shops down the west side: over the window beside each door
  for (const [k, y0] of [['general', 92], ['armor', 99], ['apoth', 106]]) hangSign(k, 78, y0 + 4);
  hangSign('inn', 112, 101);             // the Sleeping Goat, by its door
  hangSign('chapel', 114, 112);
  hangSign('bank', TOWN.bank.x0 + TOWN.bank.w - 1, TOWN.bank.y0 + TOWN.bank.h);
  hangSign('smith', 105, 96);
  hangSign('farmer', 87, 106);
  const npcAt = (k) => npcs.find((n) => n.kind === k);
  for (const [k, ox, oy] of [['warrior', -1, -1], ['ranger', 1, 1], ['mage', 1, -1]]) { const n = npcAt(`trainer_${k}`); if (n) hangSign(k, Math.floor(n.x) + ox, Math.floor(n.y) + oy); }
  { const t = npcAt('tobin'); if (t) hangSign('fish', Math.floor(t.x) + 2, Math.floor(t.y) - 1); }
  // the camps: a name board by the way in, picture boards by the fire and the workbench
  for (const id of CAMP_KINDS) {
    const sp = spots[id]; if (!sp) continue;
    const cx = Math.floor(sp.x), cy = Math.floor(sp.y);
    const b = near(cx + 1, cy + 5);
    if (b) { force('campboard', b[0], b[1], CAMP_KINDS.indexOf(id)); tip(b[0] + 0.5, b[1] + 0.5, 1.3, CAMP_BOARDS[id].title, CAMP_BOARDS[id].sub); }
    hangSign('cook', cx + 2, cy - 1);
    hangSign('saw', cx - 2, cy + 4);
  }
  // the stables: just outside the south gate, east of the road, with a horseshoe sign
  {
    const decoAt = (x, y) => objects.find((o) => o.tx === x && o.ty === y);
    const fits = (x, y) => {
      for (let j = -1; j <= 2; j++) for (let i = -1; i <= 3; i++) {
        if (!inside(x + i, y + j)) return false;
        const k = idx(x + i, y + j), t = terrain[k];
        if (solid[k] || keep.has(k) || t === TERRAIN.WATER || (cliff[k])) return false;
        const inFoot = j >= 0 && j <= 1 && i >= 0 && i <= 2;
        if (inFoot && (t === TERRAIN.DIRT || t === TERRAIN.STONE)) return false;
        if (inFoot && occupied[k] && (!decoAt(x + i, y + j) || OBJECTS[decoAt(x + i, y + j).kind].solid)) return false;
      }
      return true;
    };
    const pos = near(101, 148, fits, 8);
    if (pos) {
      // clear the odd flower or tuft out of its way
      for (let k = objects.length - 1; k >= 0; k--) { const o = objects[k]; if (o.tx >= pos[0] && o.tx <= pos[0] + 2 && o.ty >= pos[1] && o.ty <= pos[1] + 1 && !OBJECTS[o.kind].solid) { objects.splice(k, 1); } }
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) occupied[idx(pos[0] + i, pos[1] + j)] = 0;
      force('stable', pos[0], pos[1]);
      tip(pos[0] + 1.5, pos[1] + 1, 1.6, 'Stables', 'Rest your horse here');
      hangSign('stable', pos[0] - 1, pos[1] + 2);
    }
  }
  // crossroads: the old waymarker north of town becomes a proper signpost; two more, south and east
  {
    const old = objects.find((o) => o.kind === 'sign');
    const put = (k, t) => { if (!t) return; force('crossroads', t[0], t[1], CROSS_KINDS.indexOf(k)); const T2 = crossTip(k); tip(t[0] + 0.5, t[1] + 0.5, 2.0, T2.title, T2.sub); };
    if (old) { old.kind = 'crossroads'; old.sprite = 'crossroads_north'; const T2 = crossTip('north'); tip(old.x, old.y, 2.0, T2.title, T2.sub); }
    put('south', near(92, 147));
    put('east', near(123, 126));
  }
  // the notice board on the square
  for (const o of objects) if (o.kind === 'noticeboard') tip(o.x, o.y, 1.4, 'Notice Board', 'Town news. Bounties will be posted here soon.');

  }

  return {
    signs,
    seed, w: W, h: H, terrain, solid, objects, spawns, npcs, streets, homes, seats, nodes, stations, events, farms, town: { x0: TOWN.x0, x1: TOWN.x1, y0: TOWN.y0, y1: TOWN.y1 }, farmArea: FARMQ, spots, height, cliff, stairs, riverFlow,
    bridges: [{ ...BRIDGE, axis: 'x', deck: 0.9 }],
    playerSpawn: { x: T.x + 0.5, y: T.y + 5.5 },
    landmarks: { village: T, lake: L, camp: C, meadow: S, cave: freeNear(C.x - 0.5, C.y - 6.5), bank: TOWN.bank },
    buildings, pois,
  };
}
