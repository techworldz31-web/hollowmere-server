// Trades on the server: fishing, gathering (herbs, ore, wood), cooking at a fire, buffs from
// meals and elixirs. Installed onto World's prototype (see the bottom of world.js).
import { TICK_RATE, dirFromVector } from './constants.js';
import { findPath, isBlocked } from './pathfind.js';
import { ITEMS, NPCS, DUSK, DAWN } from './content.js';
import { TRADES, tradeLevel, FISH, FISH_ORDER, JUNK, NODES, GATHER_ANIM, buffDesc } from './trades.js';
import { between } from './town.js';

const T = (s) => Math.round(s * TICK_RATE);
const round2 = (v) => Math.round(v * 100) / 100;

export const TRADE_ANIMS = new Set(['fish', 'mine', 'chop', 'gather', 'dig', 'reap']);

export const tradeMethods = {
  // ---------------------------------------------------------------- levels & buffs
  tradeLv(p, t) { return tradeLevel(p.trades[t] || 0).lv; },

  gainTrade(p, t, xp) {
    const before = this.tradeLv(p, t);
    p.trades[t] = (p.trades[t] || 0) + xp;
    const after = this.tradeLv(p, t);
    this.privateEvent(p, { e: 'txp', t, v: xp });
    if (after > before) {
      this.evAt(p, { e: 'tlvl', id: p.id, t, lv: after });
      this.privateEvent(p, { e: 'sys', text: `${TRADES[t].name} is now level ${after}.` });
    }
    p.selfDirty = true;
  },

  // everything your meal and elixir are doing for you right now
  buffFx(p) {
    const fx = { atk: 0, def: 0, spd: 0, regen: 0, xp: 0, night: 0 };
    for (const k of ['meal', 'elixir', 'kit', 'bandage']) {
      const b = p.buffs?.[k];
      if (b && b.until > this.tick) for (const [s, v] of Object.entries(b.fx)) fx[s] += v;
    }
    return fx;
  },

  // a bandage: a short, strong regeneration that works in a fight
  bandage(p, slot) {
    const it = p.inv[slot], def = ITEMS[it.item];
    if (p.hp >= p.maxHp) return this.privateEvent(p, { e: 'sys', text: 'You are not hurt.' });
    p.buffs.bandage = { until: this.tick + T(def.dur), kind: it.item, fx: { regen: Math.round(p.maxHp * def.heal / def.dur) } };
    if (--it.qty <= 0) p.inv[slot] = null;
    this.evAt(p, { e: 'fx', k: 'heal', x: round2(p.x), y: round2(p.y) });
    this.privateEvent(p, { e: 'buff', text: `${def.name}: healing over ${def.dur}s.`, k: it.item });
    p.selfDirty = true;
  },

  eat(p, slot) {
    const it = p.inv[slot], def = ITEMS[it.item], kind = def.type;
    p.buffs[kind] = { until: this.tick + T(def.dur), kind: it.item, fx: def.buff };
    if (--it.qty <= 0) p.inv[slot] = null;
    this.evAt(p, { e: 'sfx', s: kind === 'meal' ? 'eat' : 'potion', x: round2(p.x), y: round2(p.y) });
    this.privateEvent(p, { e: 'buff', text: `${def.name}: ${buffDesc(def.buff, def.dur)}`, k: it.item });
    p.selfDirty = true;
  },

  hasTool(p, id) { return p.inv.some((s) => s?.item === id); },
  rodOf(p) { let best = 0; for (const s of p.inv) if (s && ITEMS[s.item].rod) best = Math.max(best, ITEMS[s.item].rod); return best; },

  // anything that moves the hero or starts a fight puts the rod or the pickaxe away
  stopWork(p) {
    if (p.fish) { this.evAt(p, { e: 'fish', s: 'end', id: p.id }); p.fish = null; }
    if (p.gather) { p.gather = null; p.act = null; p.selfDirty = true; }
    if (p.farm) { p.farm = null; p.act = null; p.selfDirty = true; }
    p.castAt = null; p.farmGo = null;
  },

  // ---------------------------------------------------------------- fishing
  waterKind(map, x, y) {
    const i = Math.floor(y) * map.w + Math.floor(x);
    return map.riverFlow && (map.riverFlow[i * 2] || map.riverFlow[i * 2 + 1]) ? 'river' : 'lake';
  },
  deepWater(map, x, y, r = 2) {
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (!this.isWater(map, x + ox, y + oy)) return false;
    return true;
  },

  startFishing(p, x, y) {
    if (p.anim === 'die' || p.zone !== 'world') return;
    const map = this.mapOf(p);
    if (x < 0 || y < 0 || x >= map.w || y >= map.h || !this.isWater(map, x, y)) return;
    if (!this.rodOf(p)) return this.privateEvent(p, { e: 'sys', text: 'You need a fishing rod. Old Tobin by the lake knows where to find one, or Bram sells them.' });
    this.stopWork(p);
    p.target = null; p.pending = null; p.moveDir = null;
    if (Math.hypot(x - p.x, y - p.y) <= 5.2) { p.path = null; return this.cast(p, x, y); }
    // walk to the nearest bit of shore first
    let best = null, bd = Infinity;
    for (let oy = -5; oy <= 5; oy++) for (let ox = -5; ox <= 5; ox++) {
      const tx = Math.floor(x) + ox, ty = Math.floor(y) + oy;
      if (isBlocked(map, tx, ty) || Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > 4.6) continue;
      const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
      if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    p.path = best ? findPath(map, p.x, p.y, best.x, best.y) : null;
    if (!p.path) return this.privateEvent(p, { e: 'sys', text: 'You cannot reach the water from here.' });
    p.castAt = { x, y };
  },

  cast(p, x, y) {
    const map = this.mapOf(p), rod = this.rodOf(p);
    if (!rod) return;
    let bait = null;
    for (const b of ['glow_bait', 'worms']) if (this.countItem(p, b)) { bait = b; this.removeItem(p, b, 1); break; }
    const wait = (3 + this.rng() * 6) * (bait === 'glow_bait' ? 0.7 : bait ? 0.8 : 1) * (rod >= 2 ? 0.8 : 1);
    p.fish = { x, y, water: this.waterKind(map, x, y), deep: this.deepWater(map, x, y, 2), rod, bait, state: 'wait', biteAt: this.tick + T(wait), until: 0, catch: null, misses: p.fish?.misses || 0 };
    p.dir = dirFromVector(x - p.x, y - p.y);
    this.evAt(p, { e: 'fish', s: 'cast', id: p.id, x: round2(x), y: round2(y) });
  },

  rollFish(p, f) {
    const lv = this.tradeLv(p, 'fishing'), night = between(this.tod, DUSK, DAWN), rain = this.weather === 1 || this.weather === 2, storm = this.weather === 2;
    const pool = [];
    for (const k of FISH_ORDER) {
      const F = FISH[k];
      if (F.lv > lv || (F.where !== 'any' && F.where !== f.water)) continue;
      if ((F.only === 'night' && !night) || (F.only === 'day' && night)) continue;
      if (F.legend && !f.deep) continue;
      let w = F.wt;
      if (night && F.night) w *= F.night;
      if (rain && F.rain) w *= F.rain;
      if (storm && F.storm) w *= F.storm;
      if (F.rare) w *= (f.bait === 'glow_bait' ? 2 : 1) * (f.rod >= 2 ? 1.4 : 1);
      if (F.only === 'night' && f.bait === 'glow_bait') w *= 1.5;
      pool.push([k, w]);
    }
    for (const [k, w] of Object.entries(JUNK)) pool.push([k, w]);
    let r = this.rng() * pool.reduce((a, [, w]) => a + w, 0), k = pool[0][0];
    for (const [id, w] of pool) { r -= w; if (r <= 0) { k = id; break; } }
    const F = FISH[k];
    if (!F) return { k, w: 0, win: 1.6 };
    const w = round2(F.w[0] + (F.w[1] - F.w[0]) * Math.pow(this.rng(), 1.8));
    // the harder the fish for your level, the quicker you need to be
    const win = Math.max(0.7, Math.min(1.5, 1.0 + 0.04 * (lv - F.lv))) + (f.rod >= 2 ? 0.2 : 0);
    return { k, w, win };
  },

  hook(p) {
    const f = p.fish;
    if (!f) return;
    if (f.state === 'wait') {
      // too soon: the fish is spooked, wait for the next one
      f.biteAt = this.tick + T(2 + this.rng() * 4);
      return this.privateEvent(p, { e: 'fish', s: 'early', id: p.id });
    }
    if (f.state !== 'bite') return;
    const { k, w } = f.catch;
    f.state = 'landed'; f.recastAt = this.tick + T(1.8); f.misses = 0;
    if (!this.addItem(p, k, 1)) { this.privateEvent(p, { e: 'sys', text: 'Your pack is full. The fish slips back into the water.' }); f.state = 'idle'; return; }
    let best = false;
    const F = FISH[k];
    if (F) {
      const log = p.fishLog[k] || [0, 0];
      best = w > log[1];
      p.fishLog[k] = [log[0] + 1, Math.max(log[1], w)];
      const frac = (w - F.w[0]) / (F.w[1] - F.w[0]);
      this.gainTrade(p, 'fishing', Math.round(F.xp * (1 + frac * 0.5)));
      const C = this.town?.contest;
      if (C && !C.done) { const prev = C.best.get(p.id); if (!prev || w > prev.w) C.best.set(p.id, { w, k, name: p.name }); }
      if (F.legend) this.broadcastEvent({ e: 'town', k: 'legend', text: `${p.name} has landed The Thing in the Lake! ${w} kg!` });
    } else this.gainTrade(p, 'fishing', 2);
    this.evAt(p, { e: 'fish', s: 'catch', id: p.id, k, w, best: best && !!F });
    p.selfDirty = true;
  },

  updateFishing(p, moving) {
    const f = p.fish;
    if (moving || !this.rodOf(p)) return this.stopWork(p);
    if (f.state === 'wait' && this.tick >= f.biteAt) {
      f.state = 'bite'; f.catch = this.rollFish(p, f);
      f.until = this.tick + T(f.catch.win + 0.35);           // a little extra for the round trip to the server
      this.evAt(p, { e: 'fish', s: 'bite', id: p.id, win: f.catch.win });
    } else if (f.state === 'bite' && this.tick > f.until) {
      f.state = 'idle'; f.recastAt = this.tick + T(1.2);
      this.privateEvent(p, { e: 'fish', s: 'lost', id: p.id });
      // nobody minding the rod: after three in a row, reel in
      if (++f.misses >= 3) { this.privateEvent(p, { e: 'sys', text: 'Nobody is minding the rod, so you reel in. Click the water to fish again.' }); this.stopWork(p); }
    } else if ((f.state === 'landed' || f.state === 'idle') && this.tick >= f.recastAt) {
      this.cast(p, f.x, f.y);                                   // keep fishing the same spot until you walk away
    }
  },

  // ---------------------------------------------------------------- gathering
  nodeRefresh(n) {
    const N = NODES[n.kind];
    if (n.left == null) n.left = N.pulls[0] + Math.floor(this.rng() * (N.pulls[1] - N.pulls[0] + 1));
    if (n.dep && this.tick >= n.dep) { n.dep = 0; n.left = N.pulls[0] + Math.floor(this.rng() * (N.pulls[1] - N.pulls[0] + 1)); }
  },
  gatherTime(p, N) { return N.trade === 'herbalism' ? 1.6 : Math.max(1.5, 3.0 - 0.07 * (this.tradeLv(p, N.trade) - N.lv)); },

  startGather(p, n) {
    const N = NODES[n.kind];
    this.nodeRefresh(n);
    const say = (text) => this.privateEvent(p, { e: 'sys', text });
    if (n.dep) return say(N.trade === 'mining' ? 'This vein is worked out for now. It will come back.' : N.trade === 'woodcutting' ? 'Only a stump left. Give it time to grow back.' : `Someone has picked this ${N.name} already. It will grow back.`);
    if (!this.hasTool(p, N.tool)) return say(N.tool === 'herb_pouch' ? 'You need a herb pouch. Mira the Apothecary sells them.' : `You need a ${ITEMS[N.tool].name.toLowerCase()}. Hilda the Smith can make you one.`);
    const lv = this.tradeLv(p, N.trade);
    if (lv < N.lv) return say(`You need ${TRADES[N.trade].name} level ${N.lv} for ${N.name}. Yours is ${lv}.`);
    if (N.night && !between(this.tod, DUSK - 0.01, DAWN + 0.01)) return say('The nightbloom is shut tight. It only opens at night.');
    this.stopWork(p);
    const dur = this.gatherTime(p, N);
    p.gather = { id: n.id, next: this.tick + T(dur) };
    p.act = { k: N.trade, at: this.tick, dur: T(dur) };
    p.dir = dirFromVector(n.x - p.x, n.y - p.y);
    p.selfDirty = true;
  },

  updateGather(p, moving) {
    const g = p.gather, n = this.ents.get(g.id);
    if (moving || !n || n.dep) { p.gather = null; p.act = null; p.selfDirty = true; return; }
    if (this.tick < g.next) return;
    const N = NODES[n.kind], lv = this.tradeLv(p, N.trade);
    const chance = N.trade === 'herbalism' ? 1 : Math.max(0.4, Math.min(0.95, 0.6 + 0.05 * (lv - N.lv)));
    if (this.rng() < chance) {
      if (!this.addItem(p, N.item, 1)) { this.privateEvent(p, { e: 'sys', text: 'Your pack is full.' }); p.gather = null; p.act = null; p.selfDirty = true; return; }
      this.privateEvent(p, { e: 'got', item: N.item, q: 1 });
      this.gainTrade(p, N.trade, N.xp);
      if (N.trade === 'mining' && this.rng() < 0.03 && this.addItem(p, 'rough_gem', 1)) this.privateEvent(p, { e: 'loot', text: 'You found a Rough Gem in the rock!', r: 1 });
      if (--n.left <= 0) {
        const [a, b] = N.respawn;
        n.dep = this.tick + T(a + this.rng() * (b - a));
        this.evAt(n, { e: 'node', id: n.id, s: 'dep', x: n.x, y: n.y, k: n.kind });
        p.gather = null; p.act = null; p.selfDirty = true;
        return;
      }
    }
    const dur = this.gatherTime(p, N);
    g.next = this.tick + T(dur);
    p.act = { k: N.trade, at: this.tick, dur: T(dur) };
    p.selfDirty = true;
  },

  workAnim(p) {
    if (p.fish) return 'fish';
    if (p.farm) return p.farm.anim;
    if (p.gather) { const n = this.ents.get(p.gather.id); return n ? GATHER_ANIM[NODES[n.kind].trade] : null; }
    return null;
  },

  // ---------------------------------------------------------------- cooking, brewing, forging
  craftAt(p, n, R) {
    const at = R.at || 'forge';
    if (!n || n.zone !== p.zone || Math.hypot(n.x - p.x, n.y - p.y) > 3.6) return false;
    if (at === 'forge') return n.type === 'npc' && NPCS[n.kind].role === 'craft';
    if (at === 'brew') return n.type === 'npc' && !!NPCS[n.kind].brew;
    if (at === 'cook') return n.type === 'station' && NPCS[n.kind].station === 'cook';
    if (at === 'mill') return n.type === 'station' && n.kind === 'mill';
    // crafting trades: at a camp's workbench, or at Hilda's forge
    if (at === 'craft') return (n.type === 'station' && NPCS[n.kind]?.station === 'craft') || (n.type === 'npc' && NPCS[n.kind].role === 'craft');
    return false;
  },

  cookResult(p, R) {
    const lv = this.tradeLv(p, 'cooking');
    const burn = Math.max(0, Math.min(0.3, 0.3 - 0.06 * (lv - R.lv)));
    const burnt = this.rng() < burn;
    this.gainTrade(p, 'cooking', Math.round((8 + R.lv * 3) * (burnt ? 0.4 : 1)));
    return burnt ? 'burnt_food' : R.out;
  },
};
