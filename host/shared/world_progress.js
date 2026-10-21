// The things that keep an MMO compelling day after day (after World of Warcraft and the classic
// 2.5D MMOs): rare named monsters that turn up now and then, places to discover, rested
// experience that builds up while you are away, achievements, and a daily hunt.
// Installed onto World's prototype (see the bottom of world.js).
import { TICK_RATE } from './constants.js';
import { MOBS, QUEST_ORDER, CLASSES, gearFor, xpToNext } from './content.js';
import { REGIONS, SPOT_NAMES } from './questline.js';
import { TOWN } from './mapgen.js';

const T = (s) => Math.round(s * TICK_RATE);
const DAY_MS = 86400000;
const round2 = (v) => Math.round(v * 100) / 100;

// ---- rare monsters: one per hunting ground, much tougher, a name of their own and a real prize
export const RARES = [
  { id: 'gloopus', kind: 'slime', name: 'Gloopus the Bloated', lv: 7 },
  { id: 'snagtooth', kind: 'goblin', name: 'Snagtooth', lv: 8 },
  { id: 'grimfang', kind: 'wolf', name: 'Grimfang', lv: 9 },
  { id: 'old_tusker', kind: 'boar', name: 'Old Tusker', lv: 10 },
  { id: 'red_mara', kind: 'bandit', name: 'Red Mara', lv: 11 },
  { id: 'ashmane', kind: 'dire_wolf', name: 'Ashmane', lv: 14 },
  { id: 'mossback', kind: 'golem', name: 'The Mossback Colossus', lv: 15 },
  { id: 'winters_lament', kind: 'frost_wraith', name: "Winter's Lament", lv: 18 },
  { id: 'mirejaw', kind: 'bog_lurker', name: 'Mirejaw', lv: 20 },
  { id: 'brother_hollowe', kind: 'cultist', name: 'Brother Hollowe', lv: 21 },
];
const RARE_BY = Object.fromEntries(RARES.map((r) => [r.id, r]));

// ---- places to discover (positions filled in from the map)
export function zonesOf(map) {
  const L = map.landmarks, Z = [
    { id: 'town', name: 'Hollowmere', sub: 'The town by the lake', x: (TOWN.x0 + TOWN.x1) / 2, y: (TOWN.y0 + TOWN.y1) / 2, r: 24 },
    { id: 'meadow', name: 'Slime Meadow', sub: 'Levels 1-3', ...L.meadow, r: 16 },
    { id: 'lake', name: 'Mirror Lake', sub: 'Old Tobin fishes here', ...L.lake, r: 22 },
    { id: 'camp', name: "Grukk's War Camp", sub: 'Levels 4-6', ...L.camp, r: 15 },
    { id: 'deep', name: 'The Hollow Deep', sub: 'A cave mouth into the dark', ...L.cave, r: 6 },
  ];
  for (const [id, R] of Object.entries(REGIONS)) Z.push({ id, name: R.name, sub: `Levels ${R.levels}`, x: R.x, y: R.y, r: R.r * 0.8 });
  for (const [id, s] of Object.entries(map.spots || {})) if (SPOT_NAMES[id]) Z.push({ id, name: SPOT_NAMES[id].replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()), sub: 'A landmark', x: s.x, y: s.y, r: 7 });
  return Z;
}

// ---- achievements: what they ask for, read from the player (and the counters kept below)
const nQuests = (p) => QUEST_ORDER.filter((q) => p.quests[q]?.state === 'done').length;
const BOSSES = Object.keys(MOBS).filter((k) => MOBS[k].boss);
export const ACHIEVEMENTS = [
  { id: 'first_steps', name: 'First Steps', desc: 'Finish the guide on Tutorial Island', pts: 5, need: (p) => [p.tut?.done ? 1 : 0, 1] },
  { id: 'first_blood', name: 'First Blood', desc: 'Defeat your first monster', pts: 5, need: (p, s) => [s.kills, 1] },
  { id: 'hunter', name: 'Hunter', desc: 'Defeat 50 monsters', pts: 10, need: (p, s) => [s.kills, 50] },
  { id: 'slayer', name: 'Slayer', desc: 'Defeat 250 monsters', pts: 15, need: (p, s) => [s.kills, 250] },
  { id: 'exterminator', name: 'Exterminator', desc: 'Defeat 1,000 monsters', pts: 25, need: (p, s) => [s.kills, 1000] },
  { id: 'lv5', name: 'Finding Your Feet', desc: 'Reach level 5', pts: 5, need: (p) => [p.level, 5] },
  { id: 'lv10', name: 'Seasoned', desc: 'Reach level 10', pts: 10, need: (p) => [p.level, 10] },
  { id: 'lv15', name: 'Veteran', desc: 'Reach level 15', pts: 15, need: (p) => [p.level, 15] },
  { id: 'lv20', name: 'Hero of Hollowmere', desc: 'Reach level 20', pts: 25, need: (p) => [p.level, 20] },
  { id: 'wanderer', name: 'Wanderer', desc: 'Discover 5 places', pts: 10, need: (p, s) => [s.disc.length, 5] },
  { id: 'cartographer', name: 'Cartographer', desc: 'Discover every place in the world', pts: 25, need: (p, s, w) => [s.disc.length, w.zoneList.length] },
  { id: 'rare_1', name: 'Something Rare', desc: 'Defeat a rare monster', pts: 10, need: (p, s) => [s.rares.length, 1] },
  { id: 'rare_5', name: 'Rare Hunter', desc: 'Defeat 5 different rare monsters', pts: 20, need: (p, s) => [s.rares.length, 5] },
  { id: 'rare_all', name: 'Legend Hunter', desc: 'Defeat every rare monster', pts: 40, need: (p, s) => [s.rares.length, RARES.length] },
  { id: 'boss_1', name: 'Giant Slayer', desc: 'Defeat a boss', pts: 10, need: (p) => [p.bosses.length, 1] },
  { id: 'boss_all', name: 'Bane of Tyrants', desc: 'Defeat every boss', pts: 40, need: (p) => [p.bosses.length, BOSSES.length] },
  { id: 'quests_10', name: 'Helping Hand', desc: 'Complete 10 quests', pts: 10, need: (p) => [nQuests(p), 10] },
  { id: 'quests_25', name: 'Problem Solver', desc: 'Complete 25 quests', pts: 15, need: (p) => [nQuests(p), 25] },
  { id: 'quests_50', name: 'Hollowmere\'s Hero', desc: 'Complete 50 quests', pts: 25, need: (p) => [nQuests(p), 50] },
  { id: 'chests', name: 'Treasure Seeker', desc: 'Open 10 treasure chests', pts: 10, need: (p, s) => [s.chests, 10] },
  { id: 'gold_1k', name: 'Well Off', desc: 'Have 1,000 gold', pts: 10, need: (p) => [p.gold + (p.bank?.gold || 0), 1000] },
  { id: 'gold_10k', name: 'Wealthy', desc: 'Have 10,000 gold', pts: 20, need: (p) => [p.gold + (p.bank?.gold || 0), 10000] },
  { id: 'angler', name: 'Angler', desc: 'Catch 6 different kinds of fish', pts: 15, need: (p) => [Object.keys(p.fishLog || {}).length, 6] },
  { id: 'titles', name: 'Many Names', desc: 'Earn 5 titles', pts: 15, need: (p) => [p.titles.length, 5] },
  { id: 'daily_1', name: 'Daily Grind', desc: 'Finish a daily hunt', pts: 10, need: (p, s) => [s.dailies, 1] },
  { id: 'daily_7', name: 'Dedicated', desc: 'Finish 7 daily hunts', pts: 20, need: (p, s) => [s.dailies, 7] },
  { id: 'rested', name: 'Well Rested', desc: 'Earn 1,000 bonus experience from being rested', pts: 10, need: (p, s) => [s.restedUsed, 1000] },
];
const ACH_BY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

// the monsters a daily hunt can ask for at a level: something around it, never a boss
function dailyKinds(level, avail) {
  const ok = (k, lo) => !MOBS[k].boss && !MOBS[k].raid && MOBS[k].lv && MOBS[k].lv <= level + 1 && MOBS[k].lv >= lo;
  let ks = avail.filter((k) => ok(k, level - 3));
  if (!ks.length) ks = avail.filter((k) => ok(k, -99)).sort((a, b) => MOBS[b].lv - MOBS[a].lv).slice(0, 2);
  return ks.length ? ks : ['slime'];
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function freshProg() {
  return { ach: {}, stats: { kills: 0, chests: 0, dailies: 0, restedUsed: 0, rares: [], disc: [] }, rested: 0, lastSeen: Date.now(), daily: null };
}

export const progressMethods = {
  // ---------------------------------------------------------------- setup
  initProgress() {
    this.zoneList = zonesOf(this.map);
    this.spawnKinds = [...new Set(this.map.spawns.map((s) => s.kind))];
    this.rareNext = {};
    // the first rares turn up a few minutes after the world starts, each on its own clock
    RARES.forEach((r, i) => { this.rareNext[r.id] = this.tick + T(150 + (i * 97) % 600 + this.rng() * 300); });
  },
  // a save's progress (checked), and the rest earned while away
  loadProg(p, s) {
    const P = freshProg(), v = s?.prog;
    if (v && typeof v === 'object') {
      if (v.ach && typeof v.ach === 'object') for (const k of Object.keys(v.ach)) if (ACH_BY[k]) P.ach[k] = 1;
      const st = v.stats || {};
      for (const k of ['kills', 'chests', 'dailies', 'restedUsed']) if (Number.isInteger(st[k]) && st[k] >= 0) P.stats[k] = st[k];
      if (Array.isArray(st.rares)) P.stats.rares = st.rares.filter((id) => RARE_BY[id]);
      if (Array.isArray(st.disc)) P.stats.disc = st.disc.filter((id) => typeof id === 'string' && id.length < 40).slice(0, 80);
      if (typeof v.rested === 'number' && v.rested >= 0) P.rested = v.rested;
      if (typeof v.lastSeen === 'number') P.lastSeen = v.lastSeen;
      if (v.daily && typeof v.daily === 'object' && MOBS[v.daily.kind]) P.daily = { day: v.daily.day | 0, kind: v.daily.kind, n: Math.max(0, v.daily.n | 0), need: Math.max(1, v.daily.need | 0), done: !!v.daily.done };
    }
    p.prog = P;
    // rested: a tenth of a level for every hour away, up to one and a half levels
    const hours = Math.max(0, (Date.now() - P.lastSeen) / 3600000);
    if (hours > 0.1) {
      const lvl = this.xpNeed(p);
      P.rested = Math.min(lvl * 1.5, P.rested + lvl * 0.1 * hours);
      if (P.rested > lvl * 0.05) p.restedNote = true;
    }
    P.lastSeen = Date.now();
  },
  xpNeed(p) { return xpToNext(p.level); },

  // ---------------------------------------------------------------- every second, per player
  progressTick(p) {
    const P = p.prog; if (!P) return;
    P.lastSeen = Date.now();
    if (p.restedNote) { p.restedNote = false; this.privateEvent(p, { e: 'rested', v: Math.round(P.rested) }); }
    // resting in town builds rested experience too (as an inn would), slowly
    if (p.zone === 'world' && p.x >= TOWN.x0 && p.x <= TOWN.x1 && p.y >= TOWN.y0 && p.y <= TOWN.y1) {
      const cap = this.xpNeed(p) * 1.5;
      if (P.rested < cap) { P.rested = Math.min(cap, P.rested + this.xpNeed(p) * 0.1 / 3600 * 4); if (this.tick % (TICK_RATE * 10) < TICK_RATE) p.selfDirty = true; }
    }
    // places
    if (p.zone === 'world') for (const z of this.zoneList) {
      if (P.stats.disc.includes(z.id) || Math.hypot(p.x - z.x, p.y - z.y) > z.r) continue;
      P.stats.disc.push(z.id);
      const xp = z.id === 'town' ? 0 : Math.round(30 + p.level * 18);
      this.privateEvent(p, { e: 'discover', name: z.name, sub: z.sub, xp });
      if (xp) this.grantXp(p, xp);
      p.selfDirty = true;
    }
    // the daily hunt: a new one each day, at the hero's level
    const day = Math.floor(Date.now() / DAY_MS);
    if (!P.daily || P.daily.day !== day) {
      const ks = dailyKinds(p.level, this.spawnKinds), kind = ks[hashStr(p.name + ':' + day) % ks.length];
      P.daily = { day, kind, n: 0, need: MOBS[kind].lv <= 3 ? 6 : 8, done: false };
      this.privateEvent(p, { e: 'daily', kind, need: P.daily.need, fresh: 1 });
      p.selfDirty = true;
    }
    // a rare monster close by: let the hero sense it, once per appearance
    for (const m of this.rareMobs || []) {
      if (m.hp <= 0 || m.zone !== p.zone || (m.sensed ||= new Set()).has(p.id)) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) < 22) { m.sensed.add(p.id); this.privateEvent(p, { e: 'raresense', name: m.rare.name, x: round2(m.x), y: round2(m.y) }); }
    }
    this.tutorialTick?.(p);
    if (this.tick % (TICK_RATE * 2) < TICK_RATE) this.checkAchievements(p);
  },

  // ---------------------------------------------------------------- the world clock for rares
  rareTick() {
    if (!this.rareNext) return;
    this.rareMobs = (this.rareMobs || []).filter((m) => this.ents.get(m.id) === m);
    for (const r of RARES) {
      if (this.tick < this.rareNext[r.id] || this.rareMobs.some((m) => m.rare.id === r.id)) continue;
      const spots = this.map.spawns.filter((s) => s.kind === r.kind);
      if (!spots.length) { this.rareNext[r.id] = Infinity; continue; }
      const s = spots[Math.floor(this.rng() * spots.length)], def = MOBS[r.kind];
      const m = this.spawnMob(r.kind, s.x, s.y, 'world', { rare: r, rareLv: r.lv, rareMul: 1.45 });
      m.maxHp = m.hp = Math.round(def.hp * 4.2);
      this.rareMobs.push(m);
      this.rareNext[r.id] = Infinity;          // set again when it dies
    }
  },
  // a rare fell: big rewards for everyone who fought it, and the next one comes in 20-35 minutes
  rareKilled(m, credited) {
    const r = m.rare, def = MOBS[m.kind];
    this.rareNext[r.id] = this.tick + T(60 * (20 + this.rng() * 15));
    const owner = credited[0];
    // a guaranteed piece of gear, Masterwork or better (Heroic one time in two), for the owner's class
    const cls = owner?.cls || Object.keys(CLASSES)[0];
    const tier = Math.max(1, Math.min(4, Math.ceil(r.lv / 5)));
    this.dropLoot(gearFor(cls, this.dropSlot(), tier), 1, m.x, m.y, m.zone, owner?.id, this.rng() < 0.5 ? 3 : 2);
    this.dropLoot('gold', Math.round((def.gold?.[1] || 10) * 6 + r.lv * 8), m.x, m.y, m.zone, owner?.id);
    for (const p of credited) {
      if (!p.prog.stats.rares.includes(r.id)) p.prog.stats.rares.push(r.id);
      this.grantXp(p, Math.round(def.xp * 3));
      this.checkAchievements(p);
    }
    if (owner) this.broadcastEvent({ e: 'town', k: 'rare', text: `${owner.name} has slain ${r.name}!` });
  },

  // ---------------------------------------------------------------- kills, rested and the daily hunt
  // experience for a kill, doubled while rested
  killXp(p, xp) {
    const P = p.prog; let bonus = 0;
    if (P && P.rested > 0) { bonus = Math.min(P.rested, xp); P.rested -= bonus; P.stats.restedUsed += Math.round(bonus); }
    this.grantXp(p, Math.round(xp + bonus));
    if (bonus >= 1) this.privateEvent(p, { e: 'restxp', v: Math.round(bonus) });
  },
  onKill(p, m) {
    const P = p.prog; if (!P) return;
    P.stats.kills++;
    const d = P.daily;
    if (d && !d.done && m.kind === d.kind) {
      d.n++;
      this.privateEvent(p, { e: 'daily', kind: d.kind, n: d.n, need: d.need });
      if (d.n >= d.need) {
        d.done = true; P.stats.dailies++;
        const gold = 30 + p.level * 22, xp = Math.round(this.xpNeed(p) * 0.25);
        p.gold += gold; this.grantXp(p, xp);
        this.privateEvent(p, { e: 'dailydone', kind: d.kind, gold, xp });
        this.privateEvent(p, { e: 'gold', v: gold });
      }
    }
    p.selfDirty = true;
  },
  bumpStat(p, k) { if (p.prog) { p.prog.stats[k] = (p.prog.stats[k] || 0) + 1; p.selfDirty = true; } },

  // ---------------------------------------------------------------- achievements
  checkAchievements(p) {
    const P = p.prog; if (!P) return;
    for (const a of ACHIEVEMENTS) {
      if (P.ach[a.id]) continue;
      const [have, want] = a.need(p, P.stats, this);
      if (have >= want && want > 0) {
        P.ach[a.id] = 1; p.selfDirty = true;
        this.privateEvent(p, { e: 'ach', id: a.id, name: a.name, desc: a.desc, pts: a.pts });
        if (a.pts >= 25) this.broadcastEvent({ e: 'town', k: 'ach', text: `${p.name} earned the achievement "${a.name}"!` });
      }
    }
  },
  // for the achievements window: every achievement with progress
  achView(p) {
    const P = p.prog;
    return ACHIEVEMENTS.map((a) => { const [have, want] = a.need(p, P.stats, this); return [a.id, Math.min(have, want), want, P.ach[a.id] ? 1 : 0]; });
  },
};
export { ACH_BY, RARE_BY };
