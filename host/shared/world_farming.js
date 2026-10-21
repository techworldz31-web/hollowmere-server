// Farming and foraging on the server (see shared/farming.js for the rules and data), and
// the gate guards. Installed onto World's prototype (see the bottom of world.js).
import { TICK_RATE, TERRAIN, dirFromVector } from './constants.js';
import { findPath, lineClear, isBlocked } from './pathfind.js';
import { ITEMS, NPCS, MOBS } from './content.js';
import { CROPS, CROP_ORDER, CROP_STAGES, FARM, FORAGE, FORAGE_KINDS } from './farming.js';

const T = (s) => Math.round(s * TICK_RATE);
const round2 = (v) => Math.round(v * 100) / 100;
const STAGE = (name) => CROP_STAGES.indexOf(name);

export const farmMethods = {
  // ---------------------------------------------------------------- setup
  initFarming() {
    // map decorations you can forage, by tile
    this.forageAt = new Map();
    for (const o of this.map.objects) if (FORAGE_KINDS.has(o.kind)) this.forageAt.set(o.ty * this.map.w + o.tx, o);
    this.foraged = new Map();        // tile -> tick it has seeds again
  },

  isField(x, y) { const m = this.map; return x >= 0 && y >= 0 && x < m.w && y < m.h && m.terrain[Math.floor(y) * m.w + Math.floor(x)] === TERRAIN.FARM; },
  inTownBounds(x, y, m = 0) {
    for (const t of [this.map.town, this.map.farmArea]) if (t && x >= t.x0 - m && x <= t.x1 + 1 + m && y >= t.y0 - m && y <= t.y1 + 1 + m) return true;
    return false;
  },
  cropAt(tx, ty) { for (const e of this.ents.values()) if (e.type === 'crop' && Math.floor(e.x) === tx && Math.floor(e.y) === ty) return e; return null; },
  plotsOf(p) { let n = 0; for (const e of this.ents.values()) if (e.type === 'crop' && e.owner === p.name && !e.withered) n++; return n; },
  say(p, text) { this.privateEvent(p, { e: 'sys', text }); },

  // ---------------------------------------------------------------- commands
  // dig: walk to a field tile and dig a hole there. forage: walk to a wild flower patch and search it.
  farmCommand(p, m) {
    if (p.anim === 'die' || p.zone !== 'world') return;
    const tx = Math.floor(m.x), ty = Math.floor(m.y);
    if (m.op === 'dig') {
      if (!this.isField(tx, ty)) return;
      if (!this.hasTool(p, 'shovel')) return this.say(p, 'You need a shovel to dig. Farmer Oswin on the square sells them.');
      const c = this.cropAt(tx, ty);
      if (c) return this.farmInteract(p, c);
      if (this.plotsOf(p) >= FARM.maxPlots) return this.say(p, `You already have ${FARM.maxPlots} plots on the go. Harvest some first.`);
    } else {
      const o = this.forageAt.get(ty * this.map.w + tx);
      if (!o) return;
      if (this.inTownBounds(tx, ty)) return this.say(p, 'The townsfolk would not thank you for digging up their flower beds. Try the wild country.');
      if (!this.hasTool(p, 'foraging_stick')) return this.say(p, 'You need a foraging stick to search for seeds. Oswin sells them.');
    }
    this.stopWork(p);
    p.target = null; p.pending = null; p.moveDir = null;
    p.farmGo = { op: m.op, x: tx, y: ty };
    const near = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
    if (near <= 1.4) { p.path = null; return this.arriveFarm(p); }
    // stand on the tile (fields are walkable) or next to the flowers
    let goal = { x: tx + 0.5, y: ty + 0.5 };
    if (isBlocked(this.map, tx, ty)) {
      let bd = Infinity;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (isBlocked(this.map, tx + ox, ty + oy)) continue;
        const d = Math.hypot(tx + ox + 0.5 - p.x, ty + oy + 0.5 - p.y);
        if (d < bd) { bd = d; goal = { x: tx + ox + 0.5, y: ty + oy + 0.5 }; }
      }
    }
    p.path = findPath(this.map, p.x, p.y, goal.x, goal.y, 4000);
    if (!p.path) { p.farmGo = null; this.say(p, 'You cannot get there.'); }
  },

  arriveFarm(p) {
    const g = p.farmGo; p.farmGo = null;
    if (!g || Math.hypot(g.x + 0.5 - p.x, g.y + 0.5 - p.y) > 1.6) return;
    p.dir = dirFromVector(g.x + 0.5 - p.x, g.y + 0.5 - p.y);
    if (g.op === 'dig') {
      if (this.cropAt(g.x, g.y)) return;
      return this.beginWork(p, { op: 'dig', x: g.x, y: g.y }, Math.max(1.4, 2.6 - this.tradeLv(p, 'farming') * 0.05), 'dig', 'farming');
    }
    const key = g.y * this.map.w + g.x;
    if ((this.foraged.get(key) || 0) > this.tick) return this.say(p, 'Someone has searched this patch already. Try another.');
    this.beginWork(p, { op: 'forage', x: g.x, y: g.y }, 2.0, 'gather', 'foraging');
  },

  beginWork(p, job, sec, anim, trade) {
    p.farm = { ...job, done: this.tick + T(sec), anim };
    p.act = { k: trade, at: this.tick, dur: T(sec) };
    p.selfDirty = true;
  },

  // clicking a crop (hole, growing, ripe, withered)
  farmInteract(p, c) {
    const C = CROPS[c.kind];
    if (c.owner !== p.name) {
      return this.say(p, c.stage === 0 ? `${c.owner} dug this hole.` : `${c.owner}'s ${C ? C.name.toLowerCase() : 'crop'}${c.withered ? ' (withered)' : ''}. Hands off.`);
    }
    p.dir = dirFromVector(c.x - p.x, c.y - p.y);
    if (c.withered) return this.beginWork(p, { op: 'clear', id: c.id }, 1.2, 'gather', 'farming');
    if (c.stage === 0) {
      const seed = this.pickSeed(p, p.seedPick);
      p.seedPick = null;
      if (!seed) return this.say(p, 'Your hole is ready. You have no seeds you can plant yet: buy some from Oswin, or forage in the wild.');
      return this.beginWork(p, { op: 'plant', id: c.id, seed }, 1.6, 'gather', 'farming');
    }
    if (c.stage >= STAGE('ripe')) {
      if (C.scythe && !this.hasTool(p, 'scythe')) return this.say(p, `${C.name} is grain: you need a scythe to cut it. Oswin sells them.`);
      return this.beginWork(p, { op: 'harvest', id: c.id }, C.scythe ? 2.2 : 1.8, C.scythe ? 'reap' : 'gather', 'farming');
    }
    const left = Math.max(1, Math.round((c.need - c.g) / TICK_RATE / 60));
    const how = { seeded: 'planted', sprout: 'just sprouting', young: 'coming along', grown: 'nearly ready' }[CROP_STAGES[c.stage]];
    this.say(p, `${C.name}: ${how}. Ripe in about ${left} minute${left > 1 ? 's' : ''}${c.fert ? ' (fertilized)' : ''}.`);
  },

  // the seed to plant: the one you clicked in your pack, else the highest-level seed you can plant
  pickSeed(p, want) {
    const lv = this.tradeLv(p, 'farming');
    if (want && this.countItem(p, 'seed_' + want)) return want;
    let best = null;
    for (const k of CROP_ORDER) if (CROPS[k].lv <= lv && this.countItem(p, 'seed_' + k)) best = k;
    if (!best) for (const k of CROP_ORDER) if (this.countItem(p, 'seed_' + k)) return k;      // too hard for you, but you may try
    return best;
  },

  // using a seed or bone meal from the pack
  useFarmItem(p, slot) {
    const it = p.inv[slot], def = ITEMS[it.item];
    const mine = [...this.ents.values()].filter((e) => e.type === 'crop' && e.owner === p.name && !e.withered && Math.hypot(e.x - p.x, e.y - p.y) < 6)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    if (def.type === 'seed') {
      const hole = mine.find((e) => e.stage === 0);
      if (!hole) return this.say(p, 'Dig a hole in the fields at Hollowmere Farms first (click the tilled earth with a shovel in your pack), then plant.');
      p.seedPick = def.crop;
      this.stopWork(p);
      p.pending = hole.id; p.target = null; p.moveDir = null;
      p.path = findPath(this.map, p.x, p.y, hole.x, hole.y, 3000);
      return;
    }
    // fertilizer: on a crop planted but not yet sprouted much
    const c = mine.find((e) => e.stage >= 1 && e.stage <= 2 && !e.fert && Math.hypot(e.x - p.x, e.y - p.y) < 2.6);
    if (!c) return this.say(p, 'Stand by a crop you have just planted (before it grows much) and use the bone meal then.');
    c.fert = 1;
    if (--it.qty <= 0) p.inv[slot] = null;
    p.selfDirty = true;
    this.evAt(c, { e: 'fx', k: 'sparkle', x: round2(c.x), y: round2(c.y) });
    this.say(p, `You work the bone meal in round your ${CROPS[c.kind].name.toLowerCase()}. A bigger harvest, and a better chance of something special.`);
  },

  updateFarmWork(p, moving) {
    const f = p.farm;
    if (p.path || p.moveDir || p.target != null) { p.farm = null; p.act = null; p.selfDirty = true; return; }
    if (this.tick < f.done) return;
    p.farm = null; p.act = null; p.selfDirty = true;
    const lv = this.tradeLv(p, 'farming');
    if (f.op === 'dig') {
      if (this.cropAt(f.x, f.y) || !this.isField(f.x, f.y)) return;
      if (this.rng() > Math.min(0.97, 0.72 + lv * 0.03)) { this.gainTrade(p, 'farming', 1); return this.say(p, 'You hit a stone. Try again.'); }
      this.newEnt({ type: 'crop', kind: 'none', x: f.x + 0.5, y: f.y + 0.5, owner: p.name, stage: 0, g: 0, need: 1, fert: 0, until: this.tick + T(FARM.holeKeep) });
      this.gainTrade(p, 'farming', 3);
      this.evAt(p, { e: 'sfx', s: 'dig', x: round2(p.x), y: round2(p.y) });
      const seed = this.pickSeed(p);
      this.say(p, seed ? `You dig a hole. Click it to plant your ${CROPS[seed].name.toLowerCase()} seeds.` : 'You dig a hole. Now you need seeds: Oswin sells a few, and the wild flowers out in the country hide the rest.');
      return;
    }
    if (f.op === 'forage') {
      const key = f.y * this.map.w + f.x;
      const flv = this.tradeLv(p, 'foraging');
      if ((this.foraged.get(key) || 0) > this.tick) return;
      if (this.rng() > Math.min(0.85, 0.35 + flv * 0.025)) { this.gainTrade(p, 'foraging', 2); return this.say(p, 'Nothing here but roots and beetles.'); }
      const pool = FORAGE.filter(([, , l]) => l <= flv + 2);
      let r = this.rng() * pool.reduce((a, [, w]) => a + w, 0), seed = pool[0][0];
      for (const [k, w] of pool) { r -= w; if (r <= 0) { seed = k; break; } }
      const q = 1 + (this.rng() < 0.25 + flv * 0.01 ? 1 : 0);
      if (!this.addItem(p, seed, q)) return this.say(p, 'Your pack is full.');
      const [a, b] = FARM.forageRespawn;
      this.foraged.set(key, this.tick + T(a + this.rng() * (b - a)));
      this.privateEvent(p, { e: 'got', item: seed, q });
      this.gainTrade(p, 'foraging', 6 + Math.round(FORAGE.find(([k]) => k === seed)[2] * 1.5));
      return;
    }
    const c = this.ents.get(f.id);
    if (!c || c.type !== 'crop' || c.owner !== p.name) return;
    if (f.op === 'clear') { this.ents.delete(c.id); return this.say(p, 'You pull up the dead stalks. The plot is free again.'); }
    if (f.op === 'plant') {
      if (c.stage !== 0) return;
      const C = CROPS[f.seed];
      if (!this.countItem(p, 'seed_' + f.seed)) return;
      this.removeItem(p, 'seed_' + f.seed, 1);
      const chance = Math.max(0.35, Math.min(0.97, 0.66 + 0.04 * (lv - C.lv)));
      if (this.rng() > chance) {
        this.gainTrade(p, 'farming', 2);
        return this.say(p, lv < C.lv ? `The ${C.name.toLowerCase()} seed did not take. (${C.name} needs Farming ${C.lv}; you are ${lv}.)` : 'The seed did not take. The hole is still there: try another.');
      }
      Object.assign(c, { kind: f.seed, stage: 1, g: 0, need: T(C.grow * 60), until: 0 });
      this.gainTrade(p, 'farming', Math.round(C.xp * 0.4));
      this.say(p, `You plant the ${C.name.toLowerCase()}. Ripe in about ${C.grow} minutes. Bone meal now would help it along.`);
      return;
    }
    if (f.op === 'harvest') {
      if (c.stage < STAGE('ripe') || c.withered) return;
      const C = CROPS[c.kind];
      let n = C.yield[0] + Math.floor(this.rng() * (C.yield[1] - C.yield[0] + 1)) + Math.floor(lv / 8) + (c.fert ? 1 : 0);
      if (this.rng() < Math.max(0.03, 0.22 - lv * 0.01)) n = Math.max(1, n - 1);              // a bit bruised
      const got = [];
      if (C.prize && this.rng() < 0.025 + (c.fert ? 0.05 : 0) + lv * 0.0015) {
        const prize = Array.isArray(C.prize) ? (this.rng() < 0.3 ? C.prize[1] : C.prize[0]) : C.prize;
        if (this.addItem(p, prize, 1)) { n--; got.push(prize); this.broadcastEvent({ e: 'town', k: 'prize', text: `${p.name} has grown a ${ITEMS[prize].name}!` }); }
      }
      if (n > 0 && !this.addItem(p, C.item, n)) return this.say(p, 'Your pack is full.');
      if (n > 0) this.privateEvent(p, { e: 'got', item: C.item, q: n });
      // seeds back: grain cut with a scythe always, the rest now and then
      const seeds = C.scythe ? 1 + (this.rng() < 0.5 ? 1 : 0) : this.rng() < 0.35 ? 1 : 0;
      if (seeds && this.addItem(p, 'seed_' + c.kind, seeds)) this.privateEvent(p, { e: 'got', item: 'seed_' + c.kind, q: seeds });
      this.gainTrade(p, 'farming', C.xp + n * 2);
      this.ents.delete(c.id);
      this.evAt(p, { e: 'sfx', s: 'harvest', x: round2(p.x), y: round2(p.y) });
    }
  },

  // every second: crops grow, ripe ones wither if nobody picks them, holes fill in
  updateCrops() {
    for (const c of this.ents.values()) {
      if (c.type !== 'crop') continue;
      if (c.stage === 0) { if (this.tick > c.until) this.ents.delete(c.id); continue; }
      if (c.withered) { if (this.tick > c.until) this.ents.delete(c.id); continue; }
      if (c.stage < STAGE('ripe')) {
        c.g = Math.min(c.need, c.g + TICK_RATE);
        const st = Math.min(STAGE('ripe'), 1 + Math.floor((c.g / c.need) * 4 + 1e-6));
        if (st !== c.stage) { c.stage = st; if (st === STAGE('ripe')) c.until = this.tick + T(FARM.ripeKeep); }
      } else if (this.tick > c.until) { c.withered = 1; c.until = this.tick + T(FARM.witherKeep); }
    }
  },

  // ---------------------------------------------------------------- saving your crops with you
  farmSave(p) {
    const out = [];
    for (const c of this.ents.values()) if (c.type === 'crop' && c.owner === p.name && c.stage > 0 && !c.withered)
      out.push({ x: Math.floor(c.x), y: Math.floor(c.y), k: c.kind, g: Math.round(c.g / TICK_RATE), f: c.fert ? 1 : 0, r: c.stage >= STAGE('ripe') ? Math.max(0, Math.round((c.until - this.tick) / TICK_RATE)) : 0 });
    return out;
  },
  farmRestore(p, list) {
    if (!Array.isArray(list)) return;
    for (const s of list.slice(0, FARM.maxPlots)) {
      if (!s || !CROPS[s.k] || !Number.isInteger(s.x) || !Number.isInteger(s.y) || !this.isField(s.x, s.y)) continue;
      if (this.cropAt(s.x, s.y)) continue;          // still here (the server kept it), or someone else has the plot now
      const C = CROPS[s.k], need = T(C.grow * 60), g = Math.max(0, Math.min(need, Math.round((Number(s.g) || 0) * TICK_RATE)));
      const stage = g >= need ? STAGE('ripe') : Math.min(STAGE('ripe'), 1 + Math.floor((g / need) * 4));
      this.newEnt({ type: 'crop', kind: s.k, x: s.x + 0.5, y: s.y + 0.5, owner: p.name, stage, g, need, fert: s.f ? 1 : 0,
        until: stage >= STAGE('ripe') ? this.tick + T(Math.max(60, Math.min(FARM.ripeKeep, Number(s.r) || FARM.ripeKeep))) : 0 });
    }
  },

  // ---------------------------------------------------------------- the gate guards
  // At their posts by the gates; the moment anything hostile is inside the town (or at
  // the gates), the nearest guards run it down. Nothing can hurt them, and they never
  // touch a player.
  guardZone(m) {
    const t = this.map.town;
    if (this.inTownBounds(m.x, m.y, 1)) return true;
    // the roads just outside both gates
    return Math.abs(m.x - 96) < 9 && ((m.y > t.y0 - 10 && m.y < t.y0) || (m.y > t.y1 && m.y < t.y1 + 10));
  },

  updateGuard(n, def) {
    const map = this.map;
    // look for trouble twice a second
    if (this.tick % 10 === n.id % 10) {
      const cur = n.target && this.ents.get(n.target);
      if (!cur || cur.hp <= 0 || cur.zone !== 'world' || !this.guardZone(cur)) {
        n.target = null;
        let best = null, bd = Infinity;
        for (const m of this.ents.values()) {
          // the guided start's practice slimes are the new hero's to fight: the guards leave those alone
          if (m.type !== 'mob' || m.tutFor || m.zone !== 'world' || m.hp <= 0 || !this.guardZone(m)) continue;
          // two guards on any one foe at most, so the others keep watch
          let on = 0; for (const g of this.ents.values()) if (g !== n && g.type === 'npc' && g.target === m.id) on++;
          if (on >= 2) continue;
          const d = Math.hypot(m.x - n.x, m.y - n.y);
          if (d < bd) { bd = d; best = m; }
        }
        if (best) { n.target = best.id; n.path = null; n.goal = null; n.facingUntil = 0; if (!n.shouted || this.tick - n.shouted > T(20)) { n.shouted = this.tick; this.evAt(n, { e: 'say', id: n.id, text: ['To arms!', 'Intruder!', 'Not in my town!', 'Halt!'][Math.floor(this.rng() * 4)] }); } }
      }
    }
    const t = n.target && this.ents.get(n.target);
    if (t && t.hp > 0) {
      const d = Math.hypot(t.x - n.x, t.y - n.y);
      if (d > def.reach) {
        // run, not walk
        if (lineClear(map, n.x, n.y, t.x, t.y, 0.28)) {
          n.path = null; n.goal = null;
          const s = def.run / TICK_RATE;
          this.moveBy(n, (t.x - n.x) / d * s, (t.y - n.y) / d * s);
          n.dir = dirFromVector(t.x - n.x, t.y - n.y);
        } else {
          if (!n.path || this.tick >= (n.repathAt || 0)) { n.path = findPath(map, n.x, n.y, t.x, t.y, 6000); n.repathAt = this.tick + T(0.5); }
          this.followPath(n, def.run);
        }
        if (this.tick >= (n.animLock || 0)) this.setAnim(n, 'run');
      } else {
        n.path = null;
        n.dir = dirFromVector(t.x - n.x, t.y - n.y);
        if (this.tick >= (n.cdUntil || 0)) { this.beginSwing(n, def); }
      }
      if (n.swingAt && this.tick >= n.swingAt) {
        n.swingAt = 0;
        if (Math.hypot(t.x - n.x, t.y - n.y) <= def.reach + 0.6) {
          this.applyDamage(t, def.atk, n, 0);
          this.evAt(t, { e: 'fx', k: 'spark', x: round2(t.x), y: round2(t.y) });
        }
      }
      return;
    }
    n.target = null;
    if (n.swingAt) n.swingAt = 0;
    // back to the post at a walk, then stand to attention
    const P = n.post;
    if (Math.hypot(P.x - n.x, P.y - n.y) < 0.2) {
      this.stopWalking(n);
      if (this.tick >= (n.animLock || 0)) this.setAnim(n, 'idle');
      if (n.facingUntil && this.tick > n.facingUntil) n.facingUntil = 0;
      if (!n.facingUntil) n.dir = P.dir;
      return;
    }
    if (this.talking(n)) return;
    const r = this.walkTo(n, P.x, P.y, def.speed, 9000);
    if (r === 'stuck') { n.x = P.x; n.y = P.y; this.stopWalking(n); }
  },
};
