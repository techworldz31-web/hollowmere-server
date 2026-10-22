// The questing road: "go and look at" quests, the region banners, the level 10 and
// 20 skills, and the champions' tricks (the four regional bosses). Installed onto
// World's prototype (see the bottom of world.js).
import { TICK_RATE } from './constants.js';
import { QUESTS, QUEST_ORDER, MOBS } from './content.js';
import { REGIONS, SPOT_NAMES } from './questline.js';
import { isBlocked } from './pathfind.js';

const T = (s) => Math.round(s * TICK_RATE);
const round2 = (v) => Math.round(v * 100) / 100;

export const questMethods = {
  // twice a second for each player: places found, and the region you are in
  questTick(p) {
    if (p.zone !== 'world' || p.anim === 'die') return;
    const spots = this.map.spots || {};
    for (const q of QUEST_ORDER) {
      const st = p.quests[q], d = QUESTS[q];
      if (d.kind !== 'visit' || st?.state !== 'active' || st.count) continue;
      const s = spots[d.at];
      if (s && Math.hypot(s.x - p.x, s.y - p.y) <= (s.r || 4)) {
        st.count = 1; p.selfDirty = true;
        this.privateEvent(p, { e: 'quest', text: `${d.title}: you found ${SPOT_NAMES[d.at] || d.at}. Return to ${this.npcName(d.turnin || d.giver)}.` });
      }
    }
    let region = null;
    for (const [id, R] of Object.entries(REGIONS)) if (Math.hypot(R.x - p.x, R.y - p.y) <= R.r) { region = id; break; }
    if (this.map.town && p.x >= this.map.town.x0 && p.x <= this.map.town.x1 + 1 && p.y >= this.map.town.y0 && p.y <= this.map.town.y1 + 1) region = 'town';
    if (region !== p.region) {
      const was = p.region; p.region = region;
      if (region && region !== 'town') this.privateEvent(p, { e: 'region', name: REGIONS[region].name, levels: REGIONS[region].levels });
      if (region === 'frostridge') this.ridgeSnow(p);
      else if (region === 'town' && was) this.privateEvent(p, { e: 'region', name: 'Hollowmere', levels: '' });
    }
  },
  npcName(kind) { for (const e of this.ents.values()) if (e.type === 'npc' && e.kind === kind) return e.name; return kind; },

  // ---------------------------------------------------------------- the milestone skills
  // returns true if it handled the skill
  castMilestone(p, name, r, ux, uy, d, tx, ty, alive) {
    const zone = p.zone, S = { x: p.x, y: p.y };
    switch (name) {
      case 'shieldslam': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (170 + 30 * r) / 100, stun = 1.5 + 0.5 * r;
        this.later(0.25, () => {
          if (!alive()) return;
          for (const m of this.mobsNear(p.x, p.y, 2.3, zone)) {
            const mx = m.x - p.x, my = m.y - p.y, md = Math.hypot(mx, my) || 1;
            if ((mx * ux + my * uy) / md > 0.3) { this.hit(p, m, mult); this.stun(m, stun); }
          }
          this.evAt(p, { e: 'fx', k: 'slam', x: round2(p.x + ux * 1.2), y: round2(p.y + uy * 1.2), r: 1.6 });
        });
        return true;
      }
      case 'earthshaker': {
        this.playAnim(p, 'attack', 0.8);
        const mult = (260 + 40 * r) / 100;
        this.later(0.35, () => {
          if (!alive()) return;
          for (const m of this.mobsNear(p.x, p.y, 4, zone)) { this.hit(p, m, mult); this.stun(m, 1); m.slowUntil = this.tick + T(2 + r); }
          this.evAt(p, { e: 'fx', k: 'quake', x: round2(p.x), y: round2(p.y), r: 4 });
        });
        return true;
      }
      case 'piercing': {
        this.playAnim(p, 'attack', 0.7);
        const mult = (210 + 35 * r) / 100;
        this.later(0.3, () => { if (alive()) this.shoot(p, 'arrow', p.x + ux * 9, p.y + uy * 9, mult, null, { pierce: new Set(), big: 1 }); });
        return true;
      }
      case 'eagleeye': {
        this.playAnim(p, 'cast', 0.6);
        p.buffs.eagleeye = { until: this.tick + T(6 + 2 * r), mul: 1 + (25 + 10 * r) / 100 };
        this.evAt(p, { e: 'fx', k: 'eagle', x: round2(p.x), y: round2(p.y) });
        return true;
      }
      case 'chainlight': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (160 + 25 * r) / 100, jumps = 3 + r;
        this.later(0.25, () => {
          if (!alive()) return;
          // first target: the enemy closest to where you aimed
          let from = { x: p.x, y: p.y }, hit = new Set();
          const aim = { x: p.x + ux * Math.min(7, d || 7), y: p.y + uy * Math.min(7, d || 7) };
          let next = this.mobsNear(aim.x, aim.y, 3.5, zone).sort((a, b) => Math.hypot(a.x - aim.x, a.y - aim.y) - Math.hypot(b.x - aim.x, b.y - aim.y))[0];
          for (let j = 0; j < jumps && next; j++) {
            hit.add(next.id);
            this.event({ e: 'fx', k: 'lightning', x: round2(next.x), y: round2(next.y), x0: round2(from.x), y0: round2(from.y) }, next.x, next.y, zone);
            this.hit(p, next, mult * (1 - j * 0.08));
            from = next;
            next = this.mobsNear(from.x, from.y, 4.5, zone).filter((m) => !hit.has(m.id)).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
          }
        });
        return true;
      }
      case 'meteor': {
        this.playAnim(p, 'cast', 0.9);
        const dist = Math.min(9, d), px = p.x + ux * dist, py = p.y + uy * dist, mult = (380 + 60 * r) / 100;
        this.event({ e: 'fx', k: 'warn', x: round2(px), y: round2(py), r: 3, t: 1.1 }, px, py, zone);
        this.event({ e: 'fx', k: 'meteorfall', x: round2(px), y: round2(py), t: 1.1 }, px, py, zone);
        this.later(1.1, () => {
          if (!this.ents.has(p.id)) return;
          this.event({ e: 'fx', k: 'meteor', x: round2(px), y: round2(py), r: 3 }, px, py, zone);
          for (const m of this.mobsNear(px, py, 3, zone)) this.hit(p, m, mult);
        });
        return true;
      }
    }
    return false;
  },

  stun(m, sec) {
    if (m.hp <= 0) return;
    const def = MOBS[m.kind];
    m.stunUntil = this.tick + T(def.boss ? sec * 0.4 : sec);
    m.swingAt = 0;
    this.evAt(m, { e: 'fx', k: 'stun', x: round2(m.x), y: round2(m.y), t: def.boss ? sec * 0.4 : sec });
  },

  // ---------------------------------------------------------------- the regional champions
  // a ground slam every few seconds, and at half health they call for help
  championMechanics(m, t, def, ready) {
    if (!m.calledAdds && m.hp < m.maxHp * 0.5 && def.adds) {
      m.calledAdds = true;
      this.evAt(m, { e: 'say', id: m.id, text: 'To me! TO ME!' });
      this.evAt(m, { e: 'fx', k: 'roar', x: m.x, y: m.y });
      this.summon(m, def.adds, 2);
    }
    if (ready('slam', 9)) {
      this.playAnim(m, 'attack', 1.0); m.swingAt = 0;
      this.telegraph(m, t.x, t.y, 2.4, 1.1, 1.5);
    }
    if (m.hp <= 0) m.calledAdds = false;
  },
};

// a few spots near (x, y) a monster can stand on (used by the map generator too)
export function standable(map, x, y) { return !isBlocked(map, Math.floor(x), Math.floor(y)); }
