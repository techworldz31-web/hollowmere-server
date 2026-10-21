// Town events on the server: market days (every 3rd day), the harvest festival (every 7th
// day, with a fishing contest) and goblin raids on some nights. Installed onto World.
import { TICK_RATE } from './constants.js';
import { ITEMS, NPCS, PROPS, DUSK, DAWN, gearFor, RARITY, buyPrice } from './content.js';
import { hash2 } from './rng.js';
import { between } from './town.js';

const T = (s) => Math.round(s * TICK_RATE);

export const MARKET_EVERY = 3, FESTIVAL_EVERY = 7, FESTIVAL_DAY = 3;
export const isMarketDay = (d) => d % MARKET_EVERY === 0;
export const isFestivalDay = (d) => d % FESTIVAL_EVERY === FESTIVAL_DAY;
// a raid on the night that starts at the end of day d (never the first night, never festival night)
export const isRaidNight = (d, seed) => d >= 1 && !isFestivalDay(d) && hash2(d, 41, seed) < 0.4;

export const townMethods = {
  // called a few times a second from step()
  updateTown() {
    const S = this.town, t = this.tod, d = this.day;
    const market = isMarketDay(d) && t >= 0.27 && t < 0.8;
    const festival = isFestivalDay(d) && t >= 0.55 && t < 0.985;
    if (market !== S.market) market ? this.openEvent('market') : this.closeEvent('market');
    if (festival !== S.festival) festival ? this.openEvent('festival') : this.closeEvent('festival');
    if (S.contest && !S.contest.done && t >= 0.9) this.endContest();
    // the raid: at nightfall on raid nights, if anyone is out in the world to see it
    const anyone = [...this.clients.values()].some((c) => this.ents.get(c.entId)?.zone === 'world');
    if (!S.raid && S.raidDay !== d && isRaidNight(d, this.seed) && t >= DUSK + 0.02 && t < DUSK + 0.07 && anyone) this.startRaid();
    if (S.raid) this.updateRaid();
    // the raiders' war chest doesn't wait around forever
    if (this.tick % 200 === 0) for (const e of this.ents.values()) if (e.type === 'chest' && e.expires && this.tick > e.expires) this.ents.delete(e.id);
  },

  // ---------------------------------------------------------------- market & festival
  openEvent(kind) {
    const S = this.town;
    S[kind] = true;
    S.ents[kind] = [];
    for (const e of this.map.events[kind]) {
      if (e.prop) {
        const def = PROPS[e.prop];
        const ent = this.newEnt({ type: 'prop', kind: e.prop, v: (e.v || 0) % def.sprites.length, x: e.x, y: e.y, dir: 0 });
        if (def.solid && e.tx != null) {
          const [fw, fh] = def.foot;
          ent.tiles = [];
          for (let y = e.ty; y < e.ty + fh; y++) for (let x = e.tx; x < e.tx + fw; x++) { const i = y * this.map.w + x; if (!this.map.solid[i]) { this.map.solid[i] = 1; ent.tiles.push(i); } }
        }
        S.ents[kind].push(ent.id);
      } else if (e.npc) {
        const n = this.spawnNpc(e.npc, e.x, e.y, e.dir, { front: e.front });
        if (e.npc === 'trader_curio') n.special = this.curios();
        S.ents[kind].push(n.id);
      }
    }
    if (kind === 'market') {
      // visitors come in through the gates for the day
      [[96.5, 56.5], [96.5, 145.5], [96.5, 57.5], [96.5, 144.5]].forEach(([x, y], i) => S.ents.market.push(this.spawnNpc(`visitor_${i + 1}`, x, y, 2, { visitor: true }).id));
      this.broadcastEvent({ e: 'town', k: 'market', text: 'Market day! Travelling traders have set up their stalls on the square.' });
    } else {
      S.contest = { best: new Map(), tobin: Math.round((2.5 + this.rng() * 5) * 100) / 100, done: false };
      this.broadcastEvent({ e: 'town', k: 'festival', text: `The harvest festival has begun! Lanterns, music and dancing on the square, and a fishing contest until late evening. Old Tobin's best so far: ${S.contest.tobin} kg.` });
    }
  },

  closeEvent(kind) {
    const S = this.town;
    S[kind] = false;
    for (const id of S.ents[kind] || []) {
      const e = this.ents.get(id);
      if (!e) continue;
      for (const i of e.tiles || []) this.map.solid[i] = 0;
      // visitors walk home through the gates; everything else is simply packed away
      if (e.visitor && e.type === 'npc' && !e.hidden) { e.leaving = true; continue; }
      this.ents.delete(id);
    }
    S.ents[kind] = [];
    if (kind === 'market') this.broadcastEvent({ e: 'town', k: 'market_end', text: 'The traders pack up their stalls for the day.' });
    else this.broadcastEvent({ e: 'town', k: 'festival_end', text: 'The last lanterns go out. The harvest festival is over for another week.' });
  },

  // Madame Orla's odd items: a couple of fine or masterwork pieces and a dye, different every market day
  curios() {
    const out = [], cls = ['warrior', 'ranger', 'mage'];
    for (let i = 0; i < 3; i++) {
      const item = gearFor(cls[Math.floor(this.rng() * 3)], this.rng() < 0.5 ? 'weapon' : 'armor', this.rng() < 0.6 ? 2 : 3);
      const r = this.rng() < 0.3 ? 2 : 1;
      out.push({ item, r, price: Math.round(buyPrice(item, r) * 1.2) });
    }
    const dyes = ['dye_crimson', 'dye_azure', 'dye_emerald', 'dye_gold', 'dye_shadow', 'dye_frost'];
    const dye = dyes[Math.floor(this.rng() * dyes.length)];
    out.push({ item: dye, r: 0, price: buyPrice(dye) });
    out.push({ item: 'rough_gem', r: 0, price: 90 });
    return out;
  },

  endContest() {
    const C = this.town.contest;
    C.done = true;
    const entries = [...C.best.entries()].sort((a, b) => b[1].w - a[1].w);
    if (!entries.length) return this.broadcastEvent({ e: 'town', k: 'contest', text: `Old Tobin wins the fishing contest again with ${C.tobin} kg. Nobody else even tried.` });
    const [wid, win] = entries[0];
    for (const [id] of entries.slice(1)) { const p = this.ents.get(id); if (p) { p.gold += 20; p.selfDirty = true; this.privateEvent(p, { e: 'gold', v: 20 }); } }
    if (win.w > C.tobin) {
      const p = this.ents.get(wid);
      if (p) {
        p.gold += 150; this.addItem(p, 'glow_bait', 3);
        if (!p.titles.includes('master_angler')) { p.titles.push('master_angler'); this.privateEvent(p, { e: 'title', text: 'Master Angler' }); }
        p.selfDirty = true; this.privateEvent(p, { e: 'gold', v: 150 });
      }
      this.broadcastEvent({ e: 'town', k: 'contest', text: `${win.name} wins the fishing contest with a ${win.w} kg ${ITEMS[win.k].name}! Old Tobin is pretending not to mind.` });
    } else this.broadcastEvent({ e: 'town', k: 'contest', text: `Old Tobin wins the fishing contest with ${C.tobin} kg. Best of the rest: ${win.name}, ${win.w} kg.` });
  },

  // ---------------------------------------------------------------- the goblin raid
  startRaid() {
    this.town.raid = { wave: 0, nextWave: this.tick + T(12), mobs: new Set(), heroes: new Set(), done: false };
    this.town.raidDay = this.day;
    this.broadcastEvent({ e: 'town', k: 'raid', text: 'The alarm bell! Goblins are raiding Hollowmere from the east!' });
  },

  spawnWave(w) {
    const R = this.town.raid, E = this.map.events;
    const n = [5, 6, 4][w];
    for (let i = 0; i < n + (w === 2 ? 1 : 0); i++) {
      const from = E.raidFrom[(i + w) % E.raidFrom.length], to = E.raidTo[(i + w * 2) % E.raidTo.length];
      const kind = w === 2 && i === n ? 'raid_captain' : 'raider';
      const m = this.spawnMob(kind, from.x + (this.rng() - 0.5) * 1.5, from.y + (this.rng() - 0.5) * 1.5, 'world', { spawn: { x: to.x, y: to.y }, state: 'march', raid: true });
      R.mobs.add(m.id);
    }
    this.broadcastEvent({ e: 'town', k: 'wave', text: w === 2 ? 'Warboss Gnash leads the last wave into town!' : `Wave ${w + 1} of goblins pours in from the east!` });
  },

  updateRaid() {
    const R = this.town.raid;
    for (const id of R.mobs) { const m = this.ents.get(id); if (!m || m.anim === 'die') R.mobs.delete(id); }
    if (R.wave < 3 && this.tick >= R.nextWave) { this.spawnWave(R.wave); R.wave++; R.nextWave = this.tick + T(45); }
    else if (R.wave >= 3 && !R.mobs.size) this.raidWon();
    else if (between(this.tod, DAWN, DAWN + 0.2)) {
      // the sun comes up and the goblins run for the trees
      for (const id of R.mobs) this.ents.delete(id);
      this.town.raid = null;
      this.broadcastEvent({ e: 'town', k: 'raid_end', text: 'Dawn breaks and the last raiders flee into the forest.' });
    }
  },

  raidWon() {
    const R = this.town.raid;
    this.town.raid = null;
    const got = [];
    for (const id of R.heroes) {
      const p = this.ents.get(id);
      if (!p || p.type !== 'player') continue;
      got.push(p.name);
      p.gold += 60; this.privateEvent(p, { e: 'gold', v: 60 });
      this.grantXp(p, 150);
      if (!p.titles.includes('defender')) { p.titles.push('defender'); this.privateEvent(p, { e: 'title', text: 'Defender of Hollowmere' }); }
      p.selfDirty = true;
    }
    const c = this.newEnt({ type: 'chest', kind: 'chest_big', x: 96.5, y: 106.5, zone: 'world', raid: true, expires: this.tick + T(60 * 12) });
    void c;
    this.broadcastEvent({ e: 'town', k: 'raid_won', text: `Hollowmere is safe! The raiders are beaten${got.length ? ' thanks to ' + got.join(', ') : ''}. Their war chest lies in the square.` });
  },

  // loot from the raiders' war chest
  openRaidChest(p, c) {
    this.dropLoot('gold', 120 + Math.floor(this.rng() * 90), c.x, c.y + 0.6, c.zone, p.id);
    this.dropLoot('potion', 2, c.x, c.y + 0.6, c.zone, p.id);
    for (const m of ['iron_ore', 'silver_ore', 'scrap']) if (this.rng() < 0.6) this.dropLoot(m, 2 + Math.floor(this.rng() * 3), c.x, c.y + 0.6, c.zone, p.id);
    this.dropLoot(gearFor(p.cls, this.dropSlot(), this.rng() < 0.6 ? 2 : 3), 1, c.x, c.y + 0.6, c.zone, p.id, this.rollRarity([30, 50, 20]));
  },
};
void NPCS;
