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
    const m = this.map, near = (x, y, r) => {
      for (let k = 0; k < 60; k++) { const a = this.rng() * Math.PI * 2, d = this.rng() * r, tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d; if (!isBlocked(m, Math.floor(tx), Math.floor(ty)) && m.terrain[Math.floor(ty) * m.w + Math.floor(tx)] !== 0) return { x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5 }; }
      return null;
    };
    // foxes: in Whisperwood and the fields south of town; wild horses on the Highlands
    const W = REGIONS.whisperwood, H = REGIONS.highlands, S = m.landmarks.meadow;
    [[W, 18], [W, 22], [W, 26], [{ x: S.x, y: S.y }, 14], [{ x: 120, y: 150 }, 12], [W, 14]].forEach(([c, r], i) => { const q = near(c.x, c.y, r); if (q) this.spawnNpc(`wild_fox_${i + 1}`, q.x, q.y, Math.floor(this.rng() * 8)); });
    for (let i = 1; i <= 4; i++) { const q = near(H.x + 4, H.y - 6, 12); if (q) this.spawnNpc(`wild_horse_${i}`, q.x, q.y, Math.floor(this.rng() * 8)); }
    // travellers: from the town's gates out to the camps and back, and the weekly cart to Thornwick
    const sp = m.spots, gates = { s: { x: 96.5, y: 151.5 }, n: { x: 96.5, y: 50.5 }, w: { x: 70.5, y: 102.5 } };
    const routes = [[gates.s, sp.thornwick], [gates.n, sp.hermitage], [gates.w, sp.ridgewatch], [gates.s, sp.fenwatch]];
    routes.forEach(([a, b], i) => {
      if (!a || !b) return;
      const A = near(a.x, a.y, 3) || a, B = near(b.x, b.y, 4) || b;
      const n = this.spawnNpc(`traveller_${i + 1}`, A.x, A.y, 2); n.trip = [A, B]; n.leg = 1; n.pauseUntil = this.tick + this.rng() * 600;
    });
    if (sp.thornwick) { const A = near(gates.s.x, gates.s.y, 3) || gates.s, B = near(sp.thornwick.x + 3, sp.thornwick.y - 3, 4) || sp.thornwick; const c = this.spawnNpc('road_cart', A.x, A.y, 2); c.trip = [A, B]; c.leg = 1; }
  },
  // an animal: grazes and wanders near home, bolts when someone comes too close
  updateWild(n, def) {
    if (this.talking(n)) return;
    if (this.tick % 5 === n.id % 5 && !(n.fleeTo && this.tick < n.fleeUntil)) {
      const pl = this.playersNear(n.x, n.y, def.flee, n.zone)[0];
      if (pl) {
        const dx = n.x - pl.x, dy = n.y - pl.y, d = Math.hypot(dx, dy) || 1;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
          const a = Math.atan2(dy, dx) + turn, tx = n.x + Math.cos(a) * 7, ty = n.y + Math.sin(a) * 7;
          if (!isBlocked(this.map, Math.floor(tx), Math.floor(ty)) && Math.hypot(tx - n.origin.x, ty - n.origin.y) < 22) { n.fleeTo = { x: tx, y: ty }; n.fleeUntil = this.tick + T(4); this.stopWalking(n); break; }
        }
      }
    }
    if (n.fleeTo && this.tick < n.fleeUntil) {
      const r = this.walkTo(n, n.fleeTo.x, n.fleeTo.y, def.speed * 3.6, 600);
      if (r !== 'walk') { n.fleeTo = null; n.wanderAt = this.tick + T(2); }
      return;
    }
    n.fleeTo = null;
    if (n.goal) { const r = this.walkTo(n, n.goal.x, n.goal.y, def.speed, 600); if (r !== 'walk') { this.stopWalking(n); this.setAnim(n, 'idle'); } return; }
    if (this.tick >= (n.wanderAt || 0)) {
      n.wanderAt = this.tick + T(5 + this.rng() * 9);
      const a = this.rng() * Math.PI * 2, d = 1.5 + this.rng() * 4, tx = n.origin.x + Math.cos(a) * d, ty = n.origin.y + Math.sin(a) * d;
      if (!isBlocked(this.map, Math.floor(tx), Math.floor(ty))) this.walkTo(n, tx, ty, def.speed, 600);
    }
  },
  // someone on the road: walks one way, rests a while at the far end, walks back
  updateTraveller(n, def) {
    if (this.talking(n) || !n.trip) return;
    if (this.tick < (n.pauseUntil || 0)) { if (n.anim !== 'idle') this.setAnim(n, 'idle'); return; }
    const to = n.trip[n.leg], r = this.walkTo(n, to.x, to.y, def.speed, 9000);
    if (r === 'walk') return;
    if (r === 'stuck') { n.x = to.x; n.y = to.y; this.stopWalking(n); }
    n.leg = 1 - n.leg; n.pauseUntil = this.tick + T(25 + this.rng() * 35); this.setAnim(n, 'idle');
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
