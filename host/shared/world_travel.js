// Getting around: mounts, the hearthstone, the waystones, and long walks to a map point.
// Installed onto World's prototype (see the bottom of world.js).
//
// Casting a mount, the hearthstone or a waystone is a short channel (p.travel): moving,
// attacking or being hurt breaks it. Riding (p.mounted) is faster, ends when you fight,
// fish, farm, gather or go underground, and isn't possible while in combat.
import { TICK_RATE } from './constants.js';
import { S2C } from './protocol.js';
import { MOUNTS, NPCS, ITEMS } from './content.js';
import { findPath, isBlocked } from './pathfind.js';
import { TERRAIN } from './constants.js';

const T = (s) => Math.round(s * TICK_RATE);
const round2 = (v) => Math.round(v * 100) / 100;
export const TRAVEL = {
  mountCast: 1.5,          // seconds to call your mount
  combatLock: 5,           // can't mount within this many seconds of being hurt
  hearthCast: 8, hearthCd: 15 * 60,
  stoneCast: 4, attuneR: 9,
  stoneCost: (d) => Math.round(8 + d / 4),   // gold, by distance in tiles
};
const STONE_NAMES = { town: 'Hollowmere', thornwick: 'Thornwick', ridgewatch: 'Ridgewatch', hermitage: 'Frostridge Hermitage', fenwatch: 'Fenwatch' };

export const travelMethods = {
  // ---------------------------------------------------------------- the travel channel
  startTravel(p, kind, sec, data = {}) {
    if (p.anim === 'die') return false;
    this.stopWork(p);
    p.path = null; p.moveDir = null; p.target = null; p.pending = null; p.swingAt = 0;
    p.travel = { kind, start: this.tick, until: this.tick + T(sec), ...data };
    p.selfDirty = true;
    this.evAt(p, { e: 'fx', k: kind === 'mount' ? 'callmount' : 'channel', x: round2(p.x), y: round2(p.y), t: sec });
    return true;
  },
  cancelTravel(p, why) {
    if (!p.travel) return;
    const was = p.travel.kind;
    p.travel = null; p.selfDirty = true;
    if (why) this.privateEvent(p, { e: 'sys', text: `${was === 'mount' ? 'Calling your mount' : was === 'hearth' ? 'Hearthstone' : 'Waystone'} interrupted: ${why}.` });
  },
  updateTravel(p) {
    const tr = p.travel;
    if (!tr) return;
    if (p.lastHurt > tr.start) return this.cancelTravel(p, 'you were hit');
    if (this.tick < tr.until) return;
    p.travel = null; p.selfDirty = true;
    if (tr.kind === 'mount') return this.mountUp(p);
    if (tr.kind === 'hearth') {
      p.hearthReady = this.tick + T(TRAVEL.hearthCd);
      // home is the waystone in the town square (the inn's floor has counters and tables to get caught on)
      const st = this.stoneById('town'), spot = st ? { x: st.x + 1.2, y: st.y + 1.2 } : this.innSpot();
      if (p.zone !== 'world') { this.movePlayer(p, 'world', spot.x, spot.y); this.unstick(p); }
      else this.teleport(p, spot.x, spot.y);
      return this.privateEvent(p, { e: 'sys', text: 'You are back in the town square.' });
    }
    if (tr.kind === 'stone') {
      const st = this.stoneById(tr.to);
      if (!st) return;
      if (p.gold < tr.cost) return this.privateEvent(p, { e: 'sys', text: 'You can no longer afford the waystone.' });
      p.gold -= tr.cost;
      this.teleport(p, st.x + 1.2, st.y + 1.2);
      this.privateEvent(p, { e: 'gold', v: -tr.cost });
      return this.privateEvent(p, { e: 'sys', text: `The waystone carries you to ${STONE_NAMES[st.stone] || 'the stone'}.` });
    }
  },
  // within the overworld: vanish here, appear there
  teleport(p, x, y) {
    this.evAt(p, { e: 'fx', k: 'tpout', x: round2(p.x), y: round2(p.y) });
    p.x = x; p.y = y; p.path = null; p.target = null; p.moveDir = null; p.pending = null;
    this.unstick(p);
    const pet = this.petOf?.(p);
    if (pet) { pet.x = p.x - 0.6; pet.y = p.y - 0.6; }
    p.selfDirty = true;
    this.evAt(p, { e: 'fx', k: 'tpin', x: round2(p.x), y: round2(p.y) });
    this.evAt(p, { e: 'sfx', s: 'teleport', x: p.x, y: p.y });
  },
  innSpot() {
    const n = [...this.ents.values()].find((e) => e.type === 'npc' && e.kind === 'innkeeper');
    const f = NPCS.innkeeper.front || [0, 1.9];
    const s = n ? { x: n.origin?.x ?? n.x, y: n.origin?.y ?? n.y } : this.map.playerSpawn;
    let x = s.x + f[0], y = s.y + f[1];
    if (isBlocked(this.map, Math.floor(x), Math.floor(y))) ({ x, y } = this.map.playerSpawn);
    return { x, y };
  },

  // ---------------------------------------------------------------- mounts
  inCombat(p) { return this.tick - p.lastHurt < T(TRAVEL.combatLock) || (p.target != null && this.ents.get(p.target)?.type === 'mob'); },
  toggleMount(p) {
    if (p.anim === 'die') return;
    if (p.mounted) return this.dismount(p);
    if (p.travel?.kind === 'mount') return this.cancelTravel(p);
    if (!p.mounts?.length) return this.privateEvent(p, { e: 'sys', text: 'You have no mount yet. Your trainer has one waiting for whoever passes the level 10 trial.' });
    if (p.zone !== 'world') return this.privateEvent(p, { e: 'sys', text: 'There is no room for a horse down here.' });
    if (this.inCombat(p)) return this.privateEvent(p, { e: 'sys', text: 'You can\'t call your mount in the middle of a fight.' });
    this.startTravel(p, 'mount', TRAVEL.mountCast);
  },
  mountUp(p) {
    const kind = p.mount && p.mounts.includes(p.mount) ? p.mount : p.mounts[0];
    p.mounted = kind;
    p.selfDirty = true;
    this.evAt(p, { e: 'fx', k: 'mountup', x: round2(p.x), y: round2(p.y) });
    this.evAt(p, { e: 'sfx', s: 'neigh', x: p.x, y: p.y });
  },
  dismount(p, quiet = false) {
    if (!p.mounted) return;
    p.mounted = null; p.selfDirty = true;
    if (!quiet) this.evAt(p, { e: 'fx', k: 'dismount', x: round2(p.x), y: round2(p.y) });
  },
  mountSpeed(p) { return p.mounted ? (MOUNTS[p.mounted]?.speed || 1.7) : 1; },
  learnMount(p, slot) {
    const it = p.inv[slot], def = ITEMS[it.item];
    if (p.mounts.includes(def.mount)) return this.privateEvent(p, { e: 'sys', text: 'You already have that mount.' });
    p.mounts.push(def.mount);
    if (!p.mount) p.mount = def.mount;
    if (--it.qty <= 0) p.inv[slot] = null;
    p.selfDirty = true;
    this.privateEvent(p, { e: 'quest', text: `New mount: ${MOUNTS[def.mount].name}! Press G to ride.` });
  },

  // ---------------------------------------------------------------- hearthstone
  useHearth(p) {
    if (p.travel?.kind === 'hearth') return this.cancelTravel(p);
    if (this.zones.get(p.zone)?.kind === 'starter') return this.privateEvent(p, { e: 'sys', text: 'Your hearthstone is tuned to Hollowmere\'s waystone, and it is too far across the water. Take the ferry, or skip the guide.' });
    const left = (p.hearthReady || 0) - this.tick;
    if (left > 0) {
      const s = Math.ceil(left / TICK_RATE);
      return this.privateEvent(p, { e: 'sys', text: `Your hearthstone is still cooling: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.` });
    }
    if (this.inCombat(p)) return this.privateEvent(p, { e: 'sys', text: 'You can\'t concentrate on the hearthstone in a fight.' });
    this.dismount(p, true);
    this.startTravel(p, 'hearth', TRAVEL.hearthCast);
    this.privateEvent(p, { e: 'sys', text: 'You think of the waystone in the town square…' });
  },

  // ---------------------------------------------------------------- waystones
  stones() { return [...this.ents.values()].filter((e) => e.type === 'station' && e.kind === 'waystone'); },
  stoneById(id) { return this.stones().find((s) => s.stone === id); },
  // walking near a waystone attunes you to it (checked twice a second with the quest tick)
  attuneStones(p) {
    if (p.zone !== 'world') return;
    for (const st of this.stones()) {
      if (p.stones.includes(st.stone) || Math.hypot(st.x - p.x, st.y - p.y) > TRAVEL.attuneR) continue;
      p.stones.push(st.stone); p.selfDirty = true;
      this.privateEvent(p, { e: 'quest', text: `Waystone attuned: ${STONE_NAMES[st.stone]}. Touch any waystone to travel here.` });
      this.evAt(p, { e: 'fx', k: 'attune', x: round2(st.x), y: round2(st.y) });
    }
  },
  stoneMenu(p, t) {
    if (!p.stones.includes(t.stone)) { p.stones.push(t.stone); p.selfDirty = true; }
    const opts = [];
    for (const st of this.stones()) {
      if (st.stone === t.stone || !p.stones.includes(st.stone)) continue;
      const cost = TRAVEL.stoneCost(Math.hypot(st.x - t.x, st.y - t.y));
      opts.push({ id: 'stone:' + st.stone, label: `${STONE_NAMES[st.stone]} · ${cost} gold` });
    }
    opts.push({ id: 'bye', label: 'Step away' });
    const known = this.stones().length - 1, have = p.stones.length - 1;
    const text = opts.length > 1
      ? `The runes hum under your hand. Where shall the stone carry you?${have < known ? `\n(Walk near the other waystones to attune to them: ${have} of ${known} found.)` : ''}`
      : 'The runes hum under your hand, but you know no other waystone yet. Walk near one at a camp to attune to it.';
    this.send(p.clientId, { t: S2C.DIALOG, npc: t.id, name: `${STONE_NAMES[t.stone]} Waystone`, text, options: opts });
  },
  stoneChoice(p, stationId, choice) {
    const t = this.ents.get(stationId);
    if (!t || t.type !== 'station' || t.kind !== 'waystone' || Math.hypot(t.x - p.x, t.y - p.y) > 3.5) return false;
    const to = choice.slice(6), st = this.stoneById(to);
    if (!st || !p.stones.includes(to) || st === t) return true;
    const cost = TRAVEL.stoneCost(Math.hypot(st.x - t.x, st.y - t.y));
    if (p.gold < cost) { this.privateEvent(p, { e: 'sys', text: `The stone asks ${cost} gold, and you have ${p.gold}.` }); return true; }
    if (this.inCombat(p)) { this.privateEvent(p, { e: 'sys', text: 'The stone won\'t answer you in the middle of a fight.' }); return true; }
    this.dismount(p, true);
    this.startTravel(p, 'stone', TRAVEL.stoneCast, { to, cost });
    return true;
  },

  // ---------------------------------------------------------------- long walks (world map, quest tracker)
  // a full-map path search that prefers roads and bridges, for clicking far-away places
  travelTo(p, x, y) {
    if (p.anim === 'die') return;
    if ((p.travelPathAt || 0) > this.tick) return;
    p.travelPathAt = this.tick + T(0.5);
    const map = this.mapOf(p), W = map.w;
    const road = (tx, ty) => { const t = map.terrain[ty * W + tx]; return t === TERRAIN.DIRT || t === TERRAIN.STONE || t === TERRAIN.WOOD ? 1 : t === TERRAIN.FOREST ? 1.9 : 1.45; };
    this.stopWork(p);
    p.target = null; p.pending = null; p.moveDir = null;
    p.path = findPath(map, p.x, p.y, x, y, 60000, road) || null;
    if (!p.path) this.privateEvent(p, { e: 'sys', text: 'You can\'t find a way there from here.' });
  },
};
