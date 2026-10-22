// Places off the road (shared/mapgen.js puts them in the world): what happens when a hero reads
// the note at an abandoned camp, kneels at a wayside shrine, or searches a ruin. Finding each one
// counts as a discovery (world_progress.js), and finding them all earns "Off the Beaten Path".
// Installed onto World's prototype (see the bottom of world.js).
import { POI_DEFS } from './mapgen.js';
import { TICK_RATE } from './constants.js';
import { S2C } from './protocol.js';
import { gearFor, xpToNext, NPCS } from './content.js';
import { REGIONS } from './questline.js';
import { isBlocked } from './pathfind.js';
import { buildWildNav, wildFree, wildRay, wildStep, wildGo } from './wildnav.js';

const T = (s) => Math.round(s * TICK_RATE);
const DEF = Object.fromEntries(POI_DEFS.map((d) => [d.id, d]));

// what the notes say
const NOTES = {
  poi_pilgrims: { title: 'A Pilgrim\'s Prayer', text: 'Scratched on a board, in a careful hand:\n\n"Lady of the green places, keep our feet on the road and our bread dry. We go to the shrine by the southern fields to give thanks for the harvest. If you find this, friend, go there too. She is kind to travellers."' },
  poi_trapper: { title: 'The Trapper\'s Journal', text: 'The last pages of a water-stained journal:\n\n"Day 12. Wolves took the snares again. Bigger than any I have seen.\nDay 13. Something walks the woods at night that is not a wolf. It does not leave tracks.\nDay 14. Packing up. Elsa can keep her lodge. I am going home."\n\nThe journal ends there. His pack is still in the tent.' },
  poi_patrol: { title: 'An Unsent Letter', text: 'A letter, never sent, pinned under a stone:\n\n"Mara, the trolls came down off the ridge three nights running. The sergeant says hold. Half of us have already gone back to Ridgewatch. If you get this, tell my father I kept the old sword sharp, like he taught me.\n\nYour brother, Wil."' },
};

export const poiMethods = {
  // ---------------------------------------------------------------- life between the towns
  spawnWilds() {
    const m = this.map, near = (x, y, r, camps = false) => {
      for (let k = 0; k < 60; k++) { const a = this.rng() * Math.PI * 2, d = this.rng() * r, tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d; if (!isBlocked(m, Math.floor(tx), Math.floor(ty)) && m.terrain[Math.floor(ty) * m.w + Math.floor(tx)] !== 0 && (camps || !Object.values(m.spots || {}).some((sp) => Math.hypot(sp.x - tx, sp.y - ty) < 10)) && !(m.town && tx > m.town.x0 - 4 && tx < m.town.x1 + 4 && ty > m.town.y0 - 4 && ty < m.town.y1 + 4)) return { x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5 }; }
      return null;
    };
    // foxes: in Whisperwood and the fields south of town; wild horses on the Highlands
    const W = REGIONS.whisperwood, H = REGIONS.highlands, S = m.landmarks.meadow;
    [[W, 18], [W, 22], [W, 26], [{ x: S.x, y: S.y }, 14], [{ x: 120, y: 150 }, 12], [W, 14]].forEach(([c, r], i) => { const q = near(c.x, c.y, r); if (q) this.spawnNpc(`wild_fox_${i + 1}`, q.x, q.y, Math.floor(this.rng() * 8)); });
    for (let i = 1; i <= 4; i++) { const q = near(H.x + 4, H.y - 6, 12); if (q) this.spawnNpc(`wild_horse_${i}`, q.x, q.y, Math.floor(this.rng() * 8)); }
    // deer grazing in Whisperwood's glades and the southern fields; stags on the woods' edges and the Highlands
    [[W, 20], [W, 24], [W, 16], [W, 28], [{ x: S.x + 6, y: S.y - 4 }, 12], [{ x: 128, y: 160 }, 10]].forEach(([c, r], i) => { const q = near(c.x, c.y, r); if (q) this.spawnNpc(`wild_deer_${i + 1}`, q.x, q.y, Math.floor(this.rng() * 8)); });
    [[W, 26], [{ x: H.x + 10, y: H.y + 8 }, 10], [W, 18]].forEach(([c, r], i) => { const q = near(c.x, c.y, r); if (q) this.spawnNpc(`wild_stag_${i + 1}`, q.x, q.y, Math.floor(this.rng() * 8)); });
    // travellers: from the town's gates out to the camps and back, and the weekly cart to Thornwick
    const sp = m.spots, gates = { s: { x: 96.5, y: 151.5 }, n: { x: 96.5, y: 50.5 }, w: { x: 70.5, y: 102.5 } };
    const routes = [[gates.s, sp.thornwick], [gates.n, sp.hermitage], [gates.w, sp.ridgewatch], [gates.s, sp.fenwatch]];
    routes.forEach(([a, b], i) => {
      if (!a || !b) return;
      const A = near(a.x, a.y, 3, true) || a, B = near(b.x, b.y, 4, true) || b;   // the road's ends: by a gate, at the edge of a camp
      const n = this.spawnNpc(`traveller_${i + 1}`, A.x, A.y, 2); n.trip = [A, B]; n.leg = 1; n.pauseUntil = this.tick + this.rng() * 600;
    });
    if (sp.thornwick) { const A = near(gates.s.x, gates.s.y, 3, true) || gates.s, B = near(sp.thornwick.x + 3, sp.thornwick.y - 3, 4, true) || sp.thornwick; const c = this.spawnNpc('road_cart', A.x, A.y, 2); c.trip = [A, B]; c.leg = 1; }
  },
  // an animal: grazes, ambles from one patch of grass to the next, and bolts when someone comes too
  // close (see wildnav.js for how they find their way: bushes and fences don't stop them, and they
  // weave between tree trunks)
  updateWild(n, def) {
    if (this.talking(n)) { n.wgoal = null; return; }
    const nav = this.wildNav || (this.wildNav = buildWildNav(this.map));
    const town = this.map.town, inTown = (x, y) => town && x > town.x0 - 3 && x < town.x1 + 3 && y > town.y0 - 3 && y < town.y1 + 3;
    // who's about? (the nearest hero inside its flight distance)
    if (this.tick % 3 === n.id % 3) {
      let near = null, nd = def.flee;
      for (const pl of this.playersNear(n.x, n.y, def.flee, n.zone)) { const d = Math.hypot(pl.x - n.x, pl.y - n.y); if (d < nd) { nd = d; near = pl; } }
      if (near) { n.threat = { x: near.x, y: near.y }; if (!(n.fleeUntil > this.tick)) n.fleeDir = null; n.fleeUntil = this.tick + T(2 + this.rng() * 1.5); n.wgoal = null; }
    }
    if (n.fleeUntil > this.tick && n.threat) {
      // pick the best way to run: far from the threat, a long clear run, not too far from home,
      // never into town, and not a sudden about-turn
      if (!n.fleeDir || this.tick >= n.fleeRepick) {
        const ax = n.x - n.threat.x, ay = n.y - n.threat.y, ad = Math.hypot(ax, ay) || 1;
        let best = null, bs = -Infinity;
        for (let k = 0; k < 16; k++) {
          const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a), clear = wildRay(nav, n.x, n.y, ux, uy, 6);
          const hx = n.x + ux * clear, hy = n.y + uy * clear;
          let sc = (ux * ax + uy * ay) / ad * 3 + clear * 0.8 - Math.max(0, Math.hypot(hx - n.origin.x, hy - n.origin.y) - 20) * 0.7;
          if (n.fleeDir) sc += (ux * n.fleeDir.x + uy * n.fleeDir.y) * 0.8;
          if (clear < 0.75) sc -= 12;
          if (inTown(hx, hy)) sc -= 30;
          if (sc > bs) { bs = sc; best = { x: ux, y: uy }; }
        }
        n.fleeDir = best; n.fleeRepick = this.tick + T(0.4);
      }
      const ran = wildStep(nav, n, n.x + n.fleeDir.x * 3, n.y + n.fleeDir.y * 3, (def.fleeSpeed || def.speed * 3.6) / TICK_RATE);
      if (!ran) n.fleeRepick = this.tick;
      this.setAnim(n, ran ? (def.run ? 'run' : 'walk') : 'idle');
      if (!(n.fleeUntil > this.tick + 1)) n.wanderAt = this.tick + T(1.5 + this.rng() * 2);
      return;
    }
    n.threat = null;
    // calm: amble to another patch now and then (back toward home if it has strayed)
    if (!n.wgoal && this.tick >= (n.wanderAt || 0)) {
      const far = Math.hypot(n.x - n.origin.x, n.y - n.origin.y) > 9;
      for (let k = 0; k < 12 && !n.wgoal; k++) {
        const c = far ? n.origin : n, a = this.rng() * Math.PI * 2, d = (far ? 0.5 : 2) + this.rng() * 4.5;
        const tx = c.x + Math.cos(a) * d, ty = c.y + Math.sin(a) * d;
        if (wildFree(nav, tx, ty) && !inTown(tx, ty) && Math.hypot(tx - n.origin.x, ty - n.origin.y) < 14) n.wgoal = { x: tx, y: ty };
      }
      if (!n.wgoal) n.wanderAt = this.tick + T(2);
    }
    if (n.wgoal) {
      const r = wildGo(this, nav, n, n.wgoal.x, n.wgoal.y, def.speed / TICK_RATE);
      if (r === 'walk') { this.setAnim(n, 'walk'); return; }
      n.wgoal = null; n.wanderAt = this.tick + T(4 + this.rng() * 9);   // graze a while
    }
    this.setAnim(n, 'idle');
  },
  // someone on the road: walks one way, rests a while at the far end, walks back
  updateTraveller(n, def) {
    if (this.talking(n) || !n.trip) return;
    if (this.tick < (n.pauseUntil || 0)) { if (n.anim !== 'idle') this.setAnim(n, 'idle'); return; }
    const to = n.trip[n.leg], r = this.walkTo(n, to.x, to.y, def.speed, 9000);
    if (r === 'walk') return;
    if (r === 'stuck') this.stopWalking(n);   // can't get through: turn back (never pop across the map)
    n.leg = 1 - n.leg; n.pauseUntil = this.tick + T(25 + this.rng() * 35); this.setAnim(n, 'idle');
  },

  // ---------------------------------------------------------------- Frostridge's own snow
  // Walking onto the ridge brings snow down for you and your party (party members who arrive while
  // it falls share it). It falls for 5 to 8 minutes and then the sky over the ridge clears; walk onto
  // the ridge again after that for another fall. Nobody else sees it, and the valley's own snow
  // (world.weather) never reaches the ridge (the client keeps it off).
  ridgeSnowKey(p) { return p.partyId != null ? `pt${p.partyId}` : `p${p.id}`; },
  ridgeSnow(p) {
    const sf = this.snowfalls || (this.snowfalls = new Map()), key = this.ridgeSnowKey(p), cur = sf.get(key);
    if (cur && this.tick < cur.until + T(60)) return;          // still snowing for you (or only just stopped)
    sf.set(key, { until: this.tick + T(300 + this.rng() * 180) });
    const party = this.partyOf(p);
    for (const m of party ? this.partyMembersOnline(party) : [p]) if (m.region === 'frostridge') this.privateEvent(m, { e: 'sys', text: 'Snow begins to fall over Frostridge.' });
  },
  // is it snowing on the ridge for this hero?
  ridgeSnowing(p) {
    const sf = this.snowfalls; if (!sf || !sf.size) return false;
    const a = sf.get(this.ridgeSnowKey(p)), b = sf.get(`p${p.id}`);
    if (this.tick % 600 === 0) for (const [k, v] of sf) if (this.tick > v.until + T(120)) sf.delete(k);
    return !!((a && this.tick < a.until) || (b && this.tick < b.until));
  },

  poiUse(p, st) {
    const d = DEF[st.poi]; if (!d) return;
    p.dir = Math.round(((Math.atan2(st.y - p.y, st.x - p.x) / (Math.PI / 4)) + 8)) % 8;
    if (st.kind === 'poi_note') {
      const N = NOTES[d.id];
      return this.send(p.clientId, { t: S2C.DIALOG, npc: st.id, name: N.title, text: N.text, options: [{ id: 'bye', label: 'Put it back' }] });
    }
    if (st.kind === 'poi_shrine') {
      const b = p.buffs.shrine;
      if (b && b.until > this.tick) return this.privateEvent(p, { e: 'sys', text: `You already carry a shrine's blessing (${Math.ceil((b.until - this.tick) / TICK_RATE / 60)} min left).` });
      p.buffs.shrine = { until: this.tick + T(600), start: this.tick, kind: d.id, fx: { atk: 0.08, def: 0.08, regen: Math.max(2, Math.round(p.maxHp * 0.004)) } };
      p.hp = p.maxHp; p.mp = p.maxMp; p.selfDirty = true;
      this.evAt(p, { e: 'fx', k: 'heal', x: p.x, y: p.y });
      this.evAt(st, { e: 'fx', k: 'nova', x: st.x, y: st.y, r: 2 });
      this.privateEvent(p, { e: 'buff', text: `You kneel at the ${d.name}. Blessed: +8% damage and defence, health slowly returning, for 10 minutes.`, k: 'shrine' });
      return;
    }
    if (st.kind === 'poi_cache') {
      const done = p.prog?.stats.caches || (p.prog && (p.prog.stats.caches = []));
      if (!done) return;
      if (done.includes(d.id)) return this.privateEvent(p, { e: 'sys', text: 'You have already searched here. Only dust and old bones now.' });
      done.push(d.id);
      // something worth the climb: gold, potions, and a piece of gear for the area's level
      const gold = Math.round(20 + d.lv * 9), tier = d.lv < 9 ? 2 : d.lv < 14 ? 3 : 4;
      this.dropLoot('gold', gold, st.x, st.y + 0.6, st.zone, p.id);
      this.dropLoot(d.lv >= 14 ? 'potion_big' : 'potion', 2, st.x, st.y + 0.6, st.zone, p.id);
      this.dropLoot(gearFor(p.cls, this.dropSlot(), tier), 1, st.x, st.y + 0.6, st.zone, p.id, this.rollRarity([20, 55, 25]));
      this.grantXp(p, Math.round(xpToNext(Math.max(1, Math.min(p.level, d.lv))) * 0.05));
      this.evAt(st, { e: 'fx', k: 'chest', x: st.x, y: st.y });
      this.privateEvent(p, { e: 'sys', text: `You search the ${d.name} and find something left behind.` });
    }
  },
};
