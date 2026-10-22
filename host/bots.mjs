// Hollowmere bots: computer-played heroes for a running Hollowmere host.
//   node bots.mjs 20        (how many; 20 if not given)     BOTDEBUG=1 for a running commentary
//
// Each bot has a brain built like the AI in modern games ("utility AI"): several times a second it
// looks at what it can see, remembers what it has learned, and scores everything it could do right
// now (dodge, drink a potion, fight, flee, loot, rest, hand in a quest, go shopping, group up...).
// The best score wins, with a little stickiness so it doesn't flip-flop between plans.
//
//  - It plays the quest line like a person: takes quests from the givers it can, works on the ones
//    it can do (kill, collect drops, visit places, carry messages), hands them in, and grinds
//    bounties or level-appropriate monsters in between.
//  - It fights with its class: warriors wade in with Cleave, Whirlwind and Battle Cry; rangers and
//    mages keep their distance, step back when something reaches them, Dash or Frost Nova out of
//    trouble, Mend themselves. Everyone steps out of a boss's warning circles.
//  - It picks fights sensibly: monsters its own level, alone rather than in a crowd, not someone
//    else's kill, and not a kind that has killed it recently (it remembers, and gets more careful).
//  - It looks after itself: drinks potions, rests when hurt or out of mana, sells junk and buys
//    potions in town, puts on better gear, spends skill points, picks a specialisation at 10, learns
//    and rides its horse on long trips, uses the hearthstone, types /stuck if truly stuck.
//  - The bots talk to each other through a shared "blackboard": they spread out over the hunting
//    grounds instead of piling onto one spot, never chase the same monster, and team up (a real
//    party) to take on bosses none of them could beat alone.
//  - They're sociable: they answer when you talk to them, join your party if you invite them (and
//    then follow you and help you fight), say hello, cheer level-ups, and grumble after a death.
// Close the window to remove them.
import WebSocket from './node_modules/ws/index.js';
import { MOBS, NPCS, QUESTS, QUEST_ORDER, ITEMS, CLASSES, SKILLS, QUEST_DROPS, itemStat, skillCost } from './shared/content.js';
import { QUEST_DROPS_NEW, REGIONS, SPOT_NAMES, START_LEVELS } from './shared/questline.js';
import { canOffer, questComplete } from './shared/quests.js';
import { SPECS, skillList } from './shared/specs.js';
import { generateMap } from './shared/mapgen.js';
import { isBlocked, findPath } from './shared/pathfind.js';
import { TICK_RATE, PROTOCOL_VERSION } from './shared/constants.js';

const COUNT = Number(process.argv[2]) || 20, DEBUG = !!process.env.BOTDEBUG;
const NAMES = ['Aldric', 'Brenna', 'Cedric', 'Dagny', 'Elric', 'Freya', 'Gareth', 'Hilde', 'Ivo', 'Jorund', 'Kara', 'Leif', 'Maren', 'Niall', 'Osric', 'Petra', 'Quinn', 'Rowena', 'Sigurd', 'Tamsin'];
const CLS = ['warrior', 'ranger', 'mage'];

// ================================================================ what every bot knows about the world
const MAP = generateMap();
const TOWN = { x: 96, y: 104 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const lvOf = (k) => MOBS[k]?.lv ?? START_LEVELS[k] ?? 1;
const walkable = (x, y) => !isBlocked(MAP, Math.floor(x), Math.floor(y));
const SPAWNS = {};                                       // monster kind -> where they stand
for (const s of MAP.spawns) (SPAWNS[s.kind] ||= []).push({ x: s.x, y: s.y });
const NPC_AT = {};                                       // npc kind -> where they stand
for (const n of MAP.npcs) NPC_AT[n.kind] ||= { x: n.x, y: n.y };
for (const [id, s] of Object.entries(MAP.spots || {})) NPC_AT['spot:' + id] = s;
const SHOP = (k) => NPC_AT[k] && NPCS[k];
// which monsters drop an item (quest items, materials)
const DROPS_FROM = {};
const addDrop = (item, kind) => { if (SPAWNS[kind]) (DROPS_FROM[item] ||= new Set()).add(kind); };
for (const [k, d] of Object.entries(MOBS)) for (const [item] of d.loot || []) addDrop(item, k);
for (const T of [QUEST_DROPS, QUEST_DROPS_NEW]) for (const [kind, list] of Object.entries(T || {})) for (const [item] of list) addDrop(item, kind);

// what a quest needs doing, and whether a bot can do it at all (no fishing, farming or dungeon trips)
function questPlan(q) {
  const d = QUESTS[q];
  if (d.kind === 'kill') return SPAWNS[d.target] ? { kill: [d.target] } : null;
  if (d.kind === 'collect') { const k = DROPS_FROM[d.item]; return k?.size ? { kill: [...k] } : null; }
  if (d.kind === 'visit') return MAP.spots?.[d.at] ? { go: MAP.spots[d.at] } : null;
  if (d.kind === 'talk') return { talk: d.turnin || d.giver };
  return null;
}
// where it's dangerous for a hero of a given level: around every monster well above it (and every
// boss), out to a little past where it would notice you. Routes are planned around these.
const DANGER = new Map();
function dangerGrid(lv) {
  if (DANGER.has(lv)) return DANGER.get(lv);
  const W = MAP.w, g = new Float32Array(W * MAP.h);
  for (const s of MAP.spawns) {
    const d = MOBS[s.kind]; if (!d || (lvOf(s.kind) <= lv + 2 && !d.boss)) continue;
    const R = Math.min(d.aggro || 7, 8) * 0.65 + 3.5 + (d.boss ? 3 : 0);
    for (let y = Math.max(0, Math.floor(s.y - R)); y <= Math.min(MAP.h - 1, s.y + R); y++) for (let x = Math.max(0, Math.floor(s.x - R)); x <= Math.min(W - 1, s.x + R); x++) {
      const k = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y); if (k < R) g[y * W + x] += 12 + 30 * (1 - k / R);
    }
  }
  DANGER.set(lv, g); return g;
}
const dangerAt = (p, lv) => dangerGrid(lv)[Math.floor(p.y) * MAP.w + Math.floor(p.x)] || 0;
// a route from a to b that keeps out of danger (a long way round beats a dead hero)
function safeRoute(a, b, lv, avoid = []) {
  const g = dangerGrid(lv), W = MAP.w;
  const cost = (x, y) => { let c = 1 + g[y * W + x]; for (const z of avoid) if (Math.hypot(x + 0.5 - z.x, y + 0.5 - z.y) < z.r) c += 40; return c; };
  return findPath(MAP, a.x, a.y, b.x, b.y, 80000, cost);
}
const DOABLE = new Set(QUEST_ORDER.filter((q) => questPlan(q) && NPC_AT[QUESTS[q].giver]));

// ================================================================ the blackboard the bots share
const BB = {
  bots: new Map(),                 // name -> Bot
  claims: new Map(),               // monster id -> bot name (one bot per monster)
  groups: new Map(),               // boss kind -> { leader, members:Set, formed }
  isBot: (name) => BB.bots.has(name),
  // how many bots are hunting near a spot (so they spread out)
  crowd(x, y, except) { let n = 0; for (const b of BB.bots.values()) if (b !== except && b.me && Math.hypot(b.me.x - x, b.me.y - y) < 12) n++; return n; },
};

// ================================================================ how a bot talks
const SAY = {
  hello: ['hey all', 'hi!', 'evening folks', 'o/', 'hello hollowmere'],
  lvl: (lv) => [`ding ${lv}!`, `level ${lv} finally`, `woo, ${lv}`, `${lv} :)`],
  died: (k) => [`ugh, ${k} got me`, `that ${k} hit way too hard`, 'well that went badly', `note to self: respect the ${k}s`, 'brb, walking back from the waystone'],
  quest: (t) => [`done with ${t}`, `finished ${t}, onto the next`, `${t} complete!`],
  random: ['anyone want to group?', 'nice weather today', 'love this game', 'this town is cozy', 'whos heading north?', 'that was close', 'anyone else farming here?', 'need a healer lol', 'the music in the woods is great'],
  greet: (n) => [`hey ${n}!`, `hi ${n}`, `${n} o/`, `hello ${n}, need anything?`],
  yes: ['sure!', 'ok', 'sounds good', 'on my way'],
  thanks: ['thanks!', 'ty!', 'cheers', 'much appreciated'],
};

// ================================================================ a bot
const G0 = (b) => [...BB.groups.values()].some((G) => G.formed && G.members.has(b.name));
class Bot {
  constructor(i) {
    this.i = i;
    this.name = (NAMES[i % NAMES.length] + (i >= NAMES.length ? Math.floor(i / NAMES.length) : '') + 'Bot').slice(0, 16);
    this.cls = CLS[i % 3];
    // personality: every bot plays a little differently
    this.trait = { brave: rnd(0.3, 1), social: rnd(0.2, 1), chatty: rnd(0.1, 0.8), skill: rnd(0.55, 0.95), quester: rnd(0.5, 1), reaction: rnd(180, 420) };
    this.mem = { deaths: {}, deathsAt: [], stuck: 0, badQuest: new Map(), seen: new Map(), lastSay: 0, greeted: new Set() };
    BB.bots.set(this.name, this);
    this.connect();
  }
  log(...a) { if (DEBUG) console.log(`[${this.name} L${this.me?.lv ?? '?'}]`, ...a); }

  // ---------------------------------------------------------------- connection
  connect() {
    const ws = this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.reset();
    ws.on('open', () => this.send({ t: 'hello', name: this.name, cls: this.cls, proto: PROTOCOL_VERSION, pass: 'botpass' + this.i }));
    ws.on('message', (raw) => { let m; try { m = JSON.parse(raw); } catch { return; } this.onMessage(m); });
    ws.on('error', () => {});
    ws.on('close', () => { clearInterval(this.timer); if (!stopping) setTimeout(() => this.connect(), 10000 + Math.random() * 5000); });
    this.timer = setInterval(() => { try { this.think(); } catch (e) { console.error(this.name, e); } }, 120);
  }
  reset() {
    this.id = null; this.me = null; this.self = null; this.ents = []; this.zone = 'world'; this.tick = 0;
    this.plan = null; this.target = null; this.goal = null; this.nextAt = 0; this.dangers = []; this.lastHp = null; this.hurtAt = 0;
    this.prefsSent = false; this.dialog = null; this.shop = null; this.party = null; this.leader = null; this.sayQueue = [];
  }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  say(text, delay = rnd(800, 2500)) { if (!text) return; const now = Date.now(); if (now - this.mem.lastSay < 6000) return; this.mem.lastSay = now; setTimeout(() => this.send({ t: 'chat', text }), delay); }

  onMessage(m) {
    if (m.t === 'welcome') { this.id = m.id; this.zone = m.zone?.kind || 'world'; if (Math.random() < this.trait.chatty) this.say(pick(SAY.hello), rnd(3000, 9000)); }
    else if (m.t === 'zone') this.zone = m.zone?.kind || 'world';
    else if (m.t === 'error') console.log(this.name, ':', m.message);
    else if (m.t === 'dialog') this.dialog = { ...m, at: Date.now() };
    else if (m.t === 'shop') this.shop = { ...m, at: Date.now() };
    else if (m.t === 'snap') this.perceive(m);
  }

  // ---------------------------------------------------------------- perception and memory
  perceive(m) {
    this.tick = m.tick;
    this.ents = m.ents || this.ents;
    if (m.self) this.self = m.self;
    const me = this.ents.find((e) => e.i === this.id);
    if (me) {
      if (this.lastHp != null && me.hp < this.lastHp) this.hurtAt = Date.now();
      if (me.hp <= 0 && this.lastHp > 0) this.onDeath();
      this.lastHp = me.hp; this.me = me;
    }
    for (const ev of m.ev || []) this.onEvent(ev);
  }
  onEvent(ev) {
    const now = Date.now();
    if (ev.e === 'fx' && ev.k === 'warn') this.dangers.push({ x: ev.x, y: ev.y, r: ev.r, until: now + (ev.t || 1) * 1000 + 250 });
    else if (ev.e === 'lvl' && ev.id === this.id) { if (Math.random() < this.trait.chatty) this.say(pick(SAY.lvl(ev.lv))); }
    else if (ev.e === 'lvl' && this.party && Math.random() < 0.3) this.say(pick(['gz!', 'grats!', 'nice!', 'gratz']));
    else if (ev.e === 'quest' && /^Quest complete: (.*)/.test(ev.text || '') && Math.random() < this.trait.chatty * 0.5) this.say(pick(SAY.quest(RegExp.$1)));
    else if (ev.e === 'pinvite') this.onInvite(ev);
    else if (ev.e === 'party') this.party = ev.party || null;
    else if (ev.e === 'chat' && ev.from && ev.from !== this.name && !ev.sys && !ev.out) this.onChat(ev);
    else if (ev.e === 'sys' && DEBUG) this.log('sys:', ev.text);
    else if (ev.e === 'tinvite') this.send({ t: 'trade', op: 'no' });
    else if (ev.e === 'ginvite') this.send({ t: 'guild', op: 'decline' });
  }
  onDeath() {
    // remember what killed it: that kind is avoided for a while, and it plays more carefully
    const killer = this.target && this.ents.find((e) => e.i === this.target) || this.attackers()[0];
    const k = killer?.k;
    if (k) this.mem.deaths[k] = (this.mem.deaths[k] || 0) + 1;
    this.mem.deathsAt.push(Date.now());
    this.trait.brave = Math.max(0.15, this.trait.brave - 0.1);
    this.log('died to', k);
    if (k && Math.random() < this.trait.chatty) this.say(pick(SAY.died(MOBS[k]?.name?.toLowerCase() || k)), rnd(5000, 9000));
    this.release(); this.plan = null; this.goal = null;
  }
  onInvite(ev) {
    // real players: join if sociable and not busy with a boss group; other bots: join if it's our group
    const g = [...BB.groups.values()].find((G) => G.leader === ev.from && G.members.has(this.name));
    if (g || (!BB.isBot(ev.from) && Math.random() < 0.4 + this.trait.social * 0.6 && !this.inGroup())) {
      setTimeout(() => this.send({ t: 'party', op: 'accept' }), rnd(1200, 3500));
      if (!BB.isBot(ev.from)) { this.leader = ev.from; this.say(pick(SAY.yes), rnd(2000, 4000)); }
    } else setTimeout(() => this.send({ t: 'party', op: 'decline' }), rnd(1500, 4000));
  }
  onChat(ev) {
    if (BB.isBot(ev.from) && Math.random() < 0.85) return;     // bots don't natter at each other endlessly
    const t = (ev.text || '').toLowerCase(), named = t.includes(this.name.toLowerCase()) || t.includes(this.name.toLowerCase().replace('bot', '')) || ev.whisper;
    const near = this.ents.some((e) => e.ty === 'player' && e.n === ev.from);
    const reply = (s) => this.send(ev.whisper ? { t: 'chat', text: `/w ${ev.from} ${s}` } : { t: 'chat', text: s });
    const later = (s) => setTimeout(() => reply(s), rnd(1500, 4500));
    if (!named && !(near && /\b(hi|hey|hello|yo|sup)\b/.test(t) && !this.mem.greeted.has(ev.from) && Math.random() < this.trait.social)) {
      if (near && /\b(lfg|group|party|help)\b/.test(t) && !BB.isBot(ev.from) && !this.inGroup() && Math.random() < this.trait.social * 0.6) { later('i can help, inviting'); setTimeout(() => this.send({ t: 'party', op: 'invite', name: ev.from }), rnd(2500, 5000)); }
      return;
    }
    this.mem.greeted.add(ev.from);
    if (/\b(hi|hey|hello|yo|sup)\b/.test(t)) return later(pick(SAY.greet(ev.from)));
    if (/where/.test(t)) {
      const what = Object.keys(NPC_AT).find((k) => !k.startsWith('spot:') && t.includes((NPCS[k]?.name || '').split(' ')[0].toLowerCase()));
      if (what) { const p = NPC_AT[what]; return later(`${NPCS[what].name} is ${this.placeName(p)} (${Math.round(p.x)}, ${Math.round(p.y)})`); }
      return later(`i'm ${this.placeName(this.me)} right now`);
    }
    if (/\b(level|lvl|lv)\b/.test(t)) return later(`i'm level ${this.me?.lv}, ${this.plan?.why || 'just exploring'}`);
    if (/\b(what|doing|up to)\b/.test(t)) return later(this.plan?.why ? `${this.plan.why}` : 'just wandering about');
    if (/\b(group|party|join|help|come)\b/.test(t) && !BB.isBot(ev.from)) { later(this.inGroup() ? 'sorry, busy with a group right now' : pick(SAY.yes)); if (!this.inGroup()) setTimeout(() => this.send({ t: 'party', op: 'invite', name: ev.from }), rnd(2500, 5000)); return; }
    if (/\b(thanks|thank you|ty|thx)\b/.test(t)) return later(pick(['np!', 'anytime', 'no problem', ':)']));
    if (/\b(bot|robot|ai)\b/.test(t)) return later(pick(['beep boop', 'i am but a humble bot', 'yep, a bot. still having fun though']));
    later(pick(['haha', 'true', 'yeah', 'oh nice', 'hmm', 'lol', 'fair enough']));
  }
  placeName(p) {
    if (!p) return 'somewhere';
    if (p.x > 66 && p.x < 130 && p.y > 74 && p.y < 134) return 'in town';
    for (const [id, R] of Object.entries(REGIONS)) if (Math.hypot(R.x - p.x, R.y - p.y) < R.r) return `in ${R.name}`;
    let best = null, bd = 20; for (const [id, s] of Object.entries(MAP.spots || {})) { const d = dist(s, p); if (d < bd) { bd = d; best = id; } }
    return best ? `near ${SPOT_NAMES[best] || best}` : 'out in the wilds';
  }

  // ---------------------------------------------------------------- helpers
  get lv() { return this.me?.lv || this.self?.level || 1; }
  get hpK() { return this.me ? this.me.hp / (this.me.mh || 1) : 1; }
  get mpK() { return this.self?.maxMp ? (this.self.mp || 0) / this.self.maxMp : 1; }
  get ranged() { return (CLASSES[this.cls].range || 1) > 3; }
  inGroup() { return !!this.leader || [...BB.groups.values()].some((G) => G.members.has(this.name)); }
  mobs() { return this.ents.filter((e) => e.ty === 'mob' && e.a !== 'die' && e.hp > 0); }
  attackers() {
    // monsters on me: close by and coming at me or swinging, or anything that hit me just now
    const me = this.me; if (!me) return [];
    return this.mobs().filter((e) => { const d = dist(e, me); return d < 2.6 || (d < 9 && (e.a === 'attack' || e.a === 'cast') && Date.now() - this.hurtAt < 3000); }).sort((a, b) => dist(a, me) - dist(b, me));
  }
  potionSlot() {
    const inv = this.self?.inv || []; let best = -1, heal = 0;
    const missing = (this.me?.mh || 0) - (this.me?.hp || 0);
    inv.forEach((s, i) => { const d = s && ITEMS[s.item]; if (d?.type === 'consumable' && d.heal) { const v = Math.min(d.heal, missing) - d.heal * 0.15; if (best < 0 || v > heal) { best = i; heal = v; } } });
    return best;
  }
  potions() { return (this.self?.inv || []).reduce((n, s) => n + (s && ITEMS[s.item]?.type === 'consumable' && ITEMS[s.item].heal ? s.qty : 0), 0); }
  freeSlots() { return (this.self?.inv || []).filter((s) => !s).length; }
  skillReady(name) { const r = this.self?.skills?.[name] || 0; if (!r) return false; return (this.self.cds?.[name] || 0) <= this.tick && (this.self.mp ?? 0) >= skillCost(name); }
  slotOf(name) { return skillList(this.cls, this.self?.spec, CLASSES).indexOf(name); }
  cast(name, x, y, id) { const s = this.slotOf(name); if (s < 0 || !this.skillReady(name)) return false; this.send({ t: 'skill', slot: s, x, y, id }); (this.self.cds ||= {})[name] = this.tick + TICK_RATE; return true; }
  claim(m) { this.release(); if (m) { BB.claims.set(m.i, this.name); this.target = m.i; } }
  release() { if (this.target != null && BB.claims.get(this.target) === this.name) BB.claims.delete(this.target); this.target = null; }
  // walk somewhere: plan a route that keeps out of danger, then walk it a stretch at a time
  goTo(x, y, why, near = 1.5) {
    const me = this.me, now = Date.now();
    const same = this.goal && Math.hypot(this.goal.x - x, this.goal.y - y) < 1;
    if (!same || this.goal.replan) {
      const route = Math.hypot(x - me.x, y - me.y) > 3 ? safeRoute(me, { x, y }, this.lv, this.avoidZones()) : null;
      this.goal = { x, y, near, why, at: now, best: Infinity, bestAt: now, sentAt: 0, tries: same ? this.goal.tries : 0, route: route || [{ x, y }], wi: 0 };
    }
    const g = this.goal, d = Math.hypot(x - me.x, y - me.y);
    if (d < near) return true;
    while (g.wi < g.route.length - 1 && dist(g.route[g.wi], me) < 1.8) { g.wi++; g.sentAt = 0; g.best = Infinity; g.bestAt = now; }
    const wp = g.route[g.wi], dw = dist(wp, me);
    if (dw < g.best - 0.6) { g.best = dw; g.bestAt = now; }
    if (now - g.bestAt > 6000) return this.unstick();
    if (now - g.sentAt > 2500) {
      g.sentAt = now;
      // a long trip on foot: ride if it has a horse
      if (d > 35 && this.self?.mounts?.length && !this.self.mounted && !this.attackers().length) this.send({ t: 'mount' });
      this.send({ t: 'move', x: wp.x, y: wp.y });
    }
    return false;
  }
  avoidZones() { const now = Date.now(); this.avoid = (this.avoid || []).filter((z) => z.until > now); return this.avoid; }
  unstick() {
    // no headway: step aside and plan again; still stuck -> /stuck
    const g = this.goal; g.tries++; g.bestAt = Date.now(); g.best = Infinity; g.sentAt = Date.now() + 1500; g.replan = true;
    this.mem.stuck++;
    this.log('stuck going to', g.why, 'try', g.tries);
    if (g.tries >= 4) { this.send({ t: 'chat', text: '/stuck' }); this.goal = null; this.plan = null; return false; }
    for (let k = 0; k < 10; k++) { const a = Math.random() * 6.28, r = 2 + Math.random() * 3, x = this.me.x + Math.cos(a) * r, y = this.me.y + Math.sin(a) * r; if (walkable(x, y)) { this.send({ t: 'move', x, y }); break; } }
    return false;
  }
  stop() { this.goal = null; this.send({ t: 'dir', dx: 0, dy: 0 }); }

  // ================================================================ the brain
  think() {
    const now = Date.now();
    if (!this.me || now < this.nextAt) return;
    this.nextAt = now + this.trait.reaction * rnd(0.7, 1.3);
    if (!this.prefsSent) { this.prefsSent = true; this.send({ t: 'prefs', auto: 1, loot: 1 }); }
    if (this.me.hp <= 0) { this.plan = null; this.goal = null; this.release(); return; }
    if (this.zone !== 'world') { if (now - (this.hearthAt || 0) > 20000) { this.hearthAt = now; this.send({ t: 'hearth' }); } return; }
    this.dangers = this.dangers.filter((d) => d.until > now);
    this.housekeeping(now);

    // score every option; the current plan gets a small bonus so the bot doesn't dither
    const opts = [];
    const add = (score, kind, data = {}) => { if (score > 0) opts.push({ score: score + (this.plan?.kind === kind ? 25 : 0), kind, ...data }); };
    const me = this.me, hp = this.hpK, atk = this.attackers(), fighting = atk.length > 0 || Date.now() - this.hurtAt < 3500;

    // 1. step out of a warning circle
    const danger = this.dangers.find((d) => dist(d, me) < d.r + 0.7);
    if (danger) add(1000, 'dodge', { danger });
    // 2. drink when low in a fight
    if (fighting && hp < 0.4 + (1 - this.trait.brave) * 0.15 && this.potionSlot() >= 0 && now - (this.potAt || 0) > 1200) add(900, 'potion');
    // 3. run when it's going badly and there's nothing to drink
    if (fighting && hp < 0.22 && this.potionSlot() < 0) add(850, 'flee');
    if (fighting && atk.length >= 3 + Math.round(this.trait.brave * 2) && hp < 0.6) add(820, 'flee');
    // 3b. something far too strong close by and not yet on me: get out of its way and route round it
    const threat = !fighting && this.mobs().find((m) => (lvOf(m.k) > this.lv + 2 || MOBS[m.k]?.boss) && !G0(this) && dist(m, me) < Math.min((MOBS[m.k]?.aggro || 7) * 0.65, 5.5) + 3.5);
    if (threat) add(800, 'avoid', { mob: threat });
    // 4. a party leader (a real player who invited it): stay with them and help
    if (this.leader) add(fighting ? 300 : 700, 'follow');
    // 5. fight back / keep fighting
    if (atk.length) add(700, 'fight', { mob: this.chooseVictim(atk) });
    else if (this.target != null) { const t = this.mobs().find((e) => e.i === this.target); if (t && dist(t, me) < 18) add(600, 'fight', { mob: t }); else this.release(); }
    // 6. a boss group it belongs to
    const G = [...BB.groups.values()].find((g) => g.members.has(this.name));
    if (G) add(550, 'group', { G });
    // 7. loot of mine lying close by
    if (!fighting && this.ents.some((e) => e.ty === 'loot' && dist(e, me) < 6) && this.freeSlots() > 0) add(450, 'loot');
    // 8. rest when hurt or drained
    if (!fighting && (hp < 0.55 || (this.cls !== 'warrior' && this.mpK < 0.2))) add(420, 'rest');
    if (this.plan?.kind === 'rest' && !fighting && (hp < 0.95 || this.mpK < 0.8)) add(420, 'rest');
    // 9. errands
    const task = this.questTask();
    if (task?.turnin) add(330, 'turnin', { task });
    if (this.needsTown()) add(310, 'town');
    if (this.specDue()) add(300, 'spec');
    if (task?.offer) add(280, 'accept', { task });
    if (task?.work) add(250 * this.trait.quester + 30, 'quest', { task });
    // 10. hunt something fitting nearby, or go to a good hunting ground
    const prey = this.choosePrey(task?.work?.kill);
    if (prey && hp > 0.6) add(260, 'fight', { mob: prey });
    add(120, 'grind');
    if (Math.random() < 0.002 * this.trait.chatty) this.say(pick(SAY.random));

    opts.sort((a, b) => b.score - a.score);
    const best = opts[0];
    if (!best) return;
    if (best.kind !== this.plan?.kind && DEBUG) this.log('->', best.kind, best.task?.why || best.mob?.k || '');
    this.plan = { kind: best.kind, why: best.task?.why || (best.kind === 'grind' ? `hunting ${this.plan?.prey || ''}` : best.kind), since: this.plan?.kind === best.kind ? this.plan.since : now, prey: this.plan?.prey };
    this.act(best);
  }

  act(o) {
    const me = this.me, now = Date.now();
    switch (o.kind) {
      case 'dodge': {
        // the shortest way out of the circle that's walkable (and not into another one)
        const d = o.danger; let ax = me.x - d.x, ay = me.y - d.y; const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
        for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 3.14]) {
          const a = Math.atan2(ay, ax) + turn, out = d.r + 1.4 - (turn ? 0 : l), x = me.x + Math.cos(a) * Math.max(1.2, out), y = me.y + Math.sin(a) * Math.max(1.2, out);
          if (walkable(x, y) && !this.dangers.some((z) => z !== d && Math.hypot(z.x - x, z.y - y) < z.r + 0.5)) { this.send({ t: 'move', x, y }); break; }
        }
        if (this.cls === 'ranger' && Math.random() < 0.5) this.cast('dash', me.x + ax * 5, me.y + ay * 5);
        this.nextAt = now + 350; return;
      }
      case 'avoid': {
        const m = o.mob; this.avoid = this.avoidZones(); if (!this.avoid.some((z) => Math.hypot(z.x - m.x, z.y - m.y) < 3)) this.avoid.push({ x: m.x, y: m.y, r: 9, until: now + 40000 });
        if (this.goal) this.goal.replan = true;
        let ax = me.x - m.x, ay = me.y - m.y; const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) { const a = Math.atan2(ay, ax) + turn, x = me.x + Math.cos(a) * 5, y = me.y + Math.sin(a) * 5; if (walkable(x, y)) { this.send({ t: 'move', x, y }); break; } }
        this.nextAt = now + 900; return;
      }
      case 'potion': { const s = this.potionSlot(); if (s >= 0) { this.send({ t: 'use', slot: s }); this.potAt = now; } return; }
      case 'flee': {
        const atk = this.attackers(); let ax = 0, ay = 0;
        for (const a of atk) { const l = dist(a, me) || 1; ax += (me.x - a.x) / l; ay += (me.y - a.y) / l; }
        if (!atk.length) { ax = TOWN.x - me.x; ay = TOWN.y - me.y; }
        const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
        if (this.cls === 'mage') this.cast('frostnova', me.x, me.y) || this.cast('icebarrier', me.x, me.y) || this.cast('heal', me.x, me.y);
        if (this.cls === 'warrior') this.cast('shieldwall', me.x, me.y) || this.cast('battlecry', me.x, me.y);
        if (this.cls === 'ranger') this.cast('dash', me.x + ax * 5, me.y + ay * 5);
        this.release();
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) { const a = Math.atan2(ay, ax) + turn, x = me.x + Math.cos(a) * 8, y = me.y + Math.sin(a) * 8; if (walkable(x, y)) { this.send({ t: 'move', x, y }); break; } }
        this.nextAt = now + 700; return;
      }
      case 'follow': {
        const L = this.ents.find((e) => e.ty === 'player' && e.n === this.leader);
        // not in their party after all (declined, kicked, they left): back to its own life
        if (!this.party || !this.party.m?.some((x) => x.n === this.leader && x.on)) { if (now - (this.leaderAt ||= now) > 20000) { this.leader = null; this.leaderAt = 0; } return; }
        if (L) { this.leaderSeen = { x: L.x, y: L.y, at: now }; this.leaderAt = now; }
        if (!L) {
          // out of sight: go where they were last seen; lost for two minutes -> say so and leave
          const s = this.leaderSeen;
          if (s && dist(s, me) > 3) { this.goTo(s.x, s.y, 'catching up with ' + this.leader, 3); return; }
          if (now - (this.leaderAt || now) > 120000) { this.send({ t: 'chat', text: `/w ${this.leader} lost you, heading off on my own. invite me again anytime!` }); this.send({ t: 'party', op: 'leave' }); this.leader = null; }
          return;
        }
        // help: whatever is fighting near the leader
        const foe = this.mobs().filter((e) => dist(e, L) < 6 && (e.hp < e.mh || e.a === 'attack')).sort((a, b) => dist(a, L) - dist(b, L))[0];
        if (foe) return this.fight(foe);
        const d = dist(L, me); if (d > 3.5) this.goTo(L.x + rnd(-1.5, 1.5), L.y + rnd(-1.5, 1.5), 'follow ' + this.leader, 2.5);
        return;
      }
      case 'fight': return this.fight(o.mob);
      case 'group': return this.groupStep(o.G);
      case 'loot': { const l = this.ents.filter((e) => e.ty === 'loot').sort((a, b) => dist(a, me) - dist(b, me))[0]; if (!l) return; if (dist(l, me) < 2.5) this.send({ t: 'lootall' }); else this.send({ t: 'interact', id: l.i }); this.nextAt = now + 700; return; }
      case 'rest': {
        if (this.goal) this.stop();
        if (this.cls === 'mage' && this.hpK < 0.7) this.cast('heal', me.x, me.y);
        if (this.hpK < 0.35 && this.potionSlot() >= 0 && Math.random() < 0.3 && now - (this.potAt || 0) > 5000) { this.send({ t: 'use', slot: this.potionSlot() }); this.potAt = now; }
        this.nextAt = now + 1500; return;
      }
      case 'turnin': case 'accept': return this.talkTo(o.task.npc, o.kind === 'accept' ? o.task.offer : null, o.task.why);
      case 'town': return this.townErrand();
      case 'spec': return this.chooseSpec();
      case 'quest': return this.questWork(o.task);
      case 'grind': return this.grind();
    }
  }

  // ---------------------------------------------------------------- combat
  chooseVictim(atk) {
    // focus: what's already hurt (finish it), else the nearest; a caster first in a mixed pack
    return atk.slice().sort((a, b) => (a.hp / a.mh) * 3 + dist(a, this.me) * 0.3 - ((b.hp / b.mh) * 3 + dist(b, this.me) * 0.3))[0];
  }
  choosePrey(wanted) {
    const me = this.me, lv = this.lv;
    let best = null, bs = -Infinity;
    for (const m of this.mobs()) {
      const def = MOBS[m.k]; if (!def) continue;
      const d = dist(m, me); if (d > 16) continue;
      const diff = lvOf(m.k) - lv, want = wanted?.includes(m.k);
      if (def.boss) continue;                                         // bosses only with a group (see groups)
      if (diff > (want ? 2 : 1) + Math.round(this.trait.brave)) continue;
      if (diff < -6 && !want) continue;                               // grey: not worth it
      const claimedBy = BB.claims.get(m.i); if (claimedBy && claimedBy !== this.name) continue;
      // someone else's fight: a hurt monster with another player right by it
      if (m.hp < m.mh && this.ents.some((p) => p.ty === 'player' && p.i !== this.id && dist(p, m) < 4)) continue;
      const crowd = this.mobs().filter((o) => o !== m && dist(o, m) < (MOBS[o.k]?.aggro || 7) * 0.7).length;
      const fear = (this.mem.deaths[m.k] || 0) * 6;
      const s = -d + (want ? 18 : 0) - crowd * (10 - this.trait.brave * 5) - fear - Math.max(0, diff) * 3;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }
  fight(m) {
    const me = this.me, now = Date.now(); if (!m) return;
    if (this.target !== m.i) { this.claim(m); this.attackSent = 0; }
    const d = dist(m, me), atk = this.attackers(), hp = this.hpK, sk = this.trait.skill;
    const def = CLASSES[this.cls], range = def.range;
    // class tactics
    if (this.cls === 'warrior') {
      if (atk.length >= 2 && Math.random() < sk && (this.cast('whirlwind', me.x, me.y) || this.cast('earthshaker', me.x, me.y))) return;
      if ((atk.length >= 2 || MOBS[m.k]?.boss || hp < 0.5) && Math.random() < sk && (this.cast('battlecry', me.x, me.y) || this.cast('rampage', me.x, me.y))) return;
      if (hp < 0.35 && this.cast('shieldwall', me.x, me.y)) return;
      if (d < 2.2 && Math.random() < sk && (this.cast('shieldslam', m.x, m.y, m.i) || this.cast('bloodthirst', m.x, m.y, m.i) || this.cast('cleave', m.x, m.y, m.i))) return;
    } else {
      // keep your distance: something on top of you -> slow it / leap away / step back
      const close = atk.find((a) => dist(a, me) < 1.9 && (MOBS[a.k]?.range || 1.4) < 3);
      if (close && Math.random() < sk) {
        if (this.cls === 'mage' && this.cast('frostnova', me.x, me.y)) return;
        const ax = me.x - close.x, ay = me.y - close.y, l = Math.hypot(ax, ay) || 1;
        if (this.cls === 'ranger' && hp < 0.75 && this.cast('dash', me.x + ax / l * 5, me.y + ay / l * 5)) return;
        if (now - (this.kiteAt || 0) > 1600) {
          for (const turn of [0, 0.7, -0.7, 1.3, -1.3]) { const a = Math.atan2(ay, ax) + turn, x = me.x + Math.cos(a) * 3.5, y = me.y + Math.sin(a) * 3.5; if (walkable(x, y)) { this.kiteAt = now; this.send({ t: 'move', x, y }); this.attackSent = 0; this.nextAt = now + 650; return; } }
        }
      }
      if (this.cls === 'mage' && hp < 0.55 && this.cast('heal', me.x, me.y)) return;
      if (this.cls === 'mage' && hp < 0.5 && this.cast('icebarrier', me.x, me.y)) return;
      if (d < range + 1 && Math.random() < sk) {
        const pack = this.mobs().filter((o) => dist(o, m) < 2.5).length;
        if (this.cls === 'mage' && ((pack >= 2 && this.cast('meteor', m.x, m.y, m.i)) || this.cast('chainlight', m.x, m.y, m.i) || this.cast('glacialspike', m.x, m.y, m.i) || this.cast('fireball', m.x, m.y, m.i) || (pack >= 2 && this.cast('flamewave', m.x, m.y, m.i)) || this.cast('livingbomb', m.x, m.y, m.i))) return;
        if (this.cls === 'ranger' && ((MOBS[m.k]?.boss || m.mh > 300) && this.cast('huntersmark', m.x, m.y, m.i) || this.cast('spiritwolf', me.x, me.y) || this.cast('eagleeye', me.x, me.y) || this.cast('aimedshot', m.x, m.y, m.i) || this.cast('piercing', m.x, m.y, m.i) || (pack >= 2 && this.cast('volley', m.x, m.y, m.i)) || this.cast('multishot', m.x, m.y, m.i))) return;
      }
    }
    if (now - (this.attackSent || 0) > 1800) { this.attackSent = now; this.goal = null; this.send({ t: 'attack', id: m.i }); }
  }

  // ---------------------------------------------------------------- quests
  // what the quest log says to do next: hand something in, pick something up, or work on it
  questTask() {
    const Q = this.self?.quests, inv = this.self?.inv || []; if (!Q) return null;
    const lv = this.lv, who = { level: lv, cls: this.cls }, now = Date.now();
    const bad = (q) => (this.mem.badQuest.get(q) || 0) > now;
    let turnin = null, offer = null, work = null;
    for (const q of QUEST_ORDER) {
      const d = QUESTS[q], st = Q[q];
      if (st?.state === 'active' && questComplete(q, st, inv)) { const npc = d.turnin || d.giver; if (NPC_AT[npc] && !turnin && dangerAt(NPC_AT[npc], lv) < 1) turnin = { q, npc }; continue; }
      if (!st && DOABLE.has(q) && !bad(q) && canOffer(Q, q, who) && (d.lv || 1) <= lv + 1 && !offer && dangerAt(NPC_AT[d.giver], lv) < 1) offer = { q, npc: d.giver };
      if (st?.state === 'active' && DOABLE.has(q) && !bad(q) && !work) {
        const plan = questPlan(q);
        const hard = plan.kill?.every((k) => MOBS[k]?.boss || lvOf(k) > lv + 2) || (plan.go && dangerAt(plan.go, lv) > 0) || (plan.talk && dangerAt(NPC_AT[plan.talk] || TOWN, lv) > 0);
        if (!hard || plan.kill?.some((k) => MOBS[k]?.boss)) work = { q, ...plan, boss: plan.kill?.find((k) => MOBS[k]?.boss) };
      }
    }
    if (turnin) return { turnin: turnin.q, npc: turnin.npc, why: `handing in ${QUESTS[turnin.q].title}` };
    const out = {};
    if (offer) Object.assign(out, { offer: offer.q, npc: offer.npc, why: `picking up ${QUESTS[offer.q].title}` });
    if (work) out.work = work, out.why ??= `on ${QUESTS[work.q].title}`;
    return offer || work ? out : null;
  }
  talkTo(npcKind, accept, why) {
    const me = this.me, now = Date.now(), at = NPC_AT[npcKind];
    const n = this.ents.find((e) => e.ty === 'npc' && e.k === npcKind);
    if (!n && !at) return;
    // not in sight yet: walk to where they stand (the counter's customer side for shopkeepers)
    if (!n || dist(n, me) > 16) { const fr = NPCS[npcKind]?.front || [0, 1]; this.goTo(at.x + fr[0], at.y + fr[1], why, 3); return; }
    this.goal = null;
    const dlg = this.dialog;
    if (dlg && dlg.npc === n.i && now - dlg.at < 8000) {
      this.dialog = null;
      const o = (accept && dlg.options.find((x) => x.id === 'accept:' + accept)) || dlg.options.find((x) => x.id.startsWith('accept:')) || dlg.options.find((x) => x.id === 'talk') || dlg.options.find((x) => x.id === 'bye');
      if (o) setTimeout(() => this.send({ t: 'dialog', npc: n.i, choice: o.id }), rnd(600, 1600));
      if (o?.id === 'talk') this.talkAt = 0;
      if (o?.id === 'bye' && accept) this.mem.badQuest.set(accept, now + 10 * 60000);   // they had nothing for us after all
      this.nextAt = now + 1800; return;
    }
    if (now - (this.talkAt || 0) > 4000) { this.talkAt = now; this.send({ t: 'interact', id: n.i }); }
    // a quest that the npc won't give (or take) after a good while is set aside
    this.talkTries = (this.talkTarget === npcKind ? this.talkTries + 1 : 1); this.talkTarget = npcKind;
    if (this.talkTries > 120) { if (accept) this.mem.badQuest.set(accept, now + 10 * 60000); this.talkTries = 0; this.plan = null; }
  }
  questWork(task) {
    const w = task.work, me = this.me;
    if (w.talk) return this.talkTo(w.talk, null, task.why);
    if (w.go) { if (this.goTo(w.go.x, w.go.y, task.why, 2)) this.mem.badQuest.set(w.q, Date.now() + 60000); return; }
    // a boss: needs friends, unless well over its level
    if (w.boss) {
      // it has died to this boss twice: leave it for a while (and level up meanwhile)
      if ((this.mem.deaths[w.boss] || 0) >= 2 && lvOf(w.boss) + 2 > this.lv) { this.mem.badQuest.set(w.q, Date.now() + 20 * 60000); this.mem.deaths[w.boss] = 1; const G = BB.groups.get(w.boss); if (G?.members.has(this.name)) this.leaveGroup(G); return; }
      if (lvOf(w.boss) + 2 <= this.lv) return this.huntAt(w.kill, task.why, true);
      return this.wantGroup(w.boss, w.q);
    }
    return this.huntAt(w.kill, task.why);
  }
  huntAt(kinds, why, boss = false) {
    const me = this.me;
    // a monster of the right kind in sight: fight it (bosses too, when allowed)
    const seen = this.mobs().filter((m) => kinds.includes(m.k) && (boss || !MOBS[m.k]?.boss) && !(BB.claims.get(m.i) && BB.claims.get(m.i) !== this.name)).sort((a, b) => dist(a, me) - dist(b, me))[0];
    if (seen && this.hpK > 0.55) return this.fight(seen);
    // else walk to where they live, preferring spots with fewer bots
    if (!this.huntSpot || !kinds.includes(this.huntSpot.kind) || dist(this.huntSpot, me) < 3) {
      const spots = kinds.flatMap((k) => (SPAWNS[k] || []).map((s) => ({ ...s, kind: k })));
      if (!spots.length) return;
      const cost = (p) => dist(p, me) * 0.05 + BB.crowd(p.x, p.y, this) * 2 + Math.random() * 2 + (boss ? 0 : dangerAt(p, this.lv) * 2);
      spots.forEach((p) => { p.c = cost(p); }); spots.sort((a, b) => a.c - b.c);
      this.huntSpot = spots[0];
    }
    this.plan.prey = MOBS[this.huntSpot.kind]?.name;
    this.goTo(this.huntSpot.x + rnd(-1, 1), this.huntSpot.y + rnd(-1, 1), why, 2.5);
  }
  grind() {
    // the best hunting for this level: bounty and quest kinds first, then anything fitting
    const lv = this.lv;
    const kinds = Object.keys(SPAWNS).filter((k) => !MOBS[k]?.boss && lvOf(k) <= lv + Math.round(this.trait.brave) && lvOf(k) >= lv - 4 && (this.mem.deaths[k] || 0) < 3);
    const fall = Object.keys(SPAWNS).filter((k) => !MOBS[k]?.boss && lvOf(k) <= lv).sort((a, b) => lvOf(b) - lvOf(a)).slice(0, 2);
    this.huntAt(kinds.length ? kinds : fall, 'hunting');
  }

  // ---------------------------------------------------------------- boss groups (the blackboard)
  wantGroup(boss, q) {
    let G = BB.groups.get(boss);
    if (!G) { G = { boss, q, leader: this.name, members: new Set([this.name]), at: Date.now(), formed: false }; BB.groups.set(boss, G); this.log('looking for a group for', boss); if (Math.random() < this.trait.chatty) this.say(`lfg ${MOBS[boss].name}, anyone?`); }
    else if (!G.members.has(this.name) && G.members.size < 4 && Math.abs((BB.bots.get(G.leader)?.lv || 0) - this.lv) <= 3) { G.members.add(this.name); }
    if (G.members.has(this.name)) return this.groupStep(G);
    this.mem.badQuest.set(q, Date.now() + 5 * 60000);
  }
  groupStep(G) {
    const me = this.me, now = Date.now(), L = BB.bots.get(G.leader);
    if (!L || !L.me || now - G.at > 15 * 60000) { this.leaveGroup(G); return; }
    // the leader invites everyone, waits for them at the boss's door, then pulls
    const lair = SPAWNS[G.boss]?.[0]; if (!lair) return this.leaveGroup(G);
    if (this === L) {
      for (const n of G.members) if (n !== this.name && !(this.invited ||= new Set()).has(n)) { this.invited.add(n); this.send({ t: 'party', op: 'invite', name: n }); }
      const ready = [...G.members].every((n) => { const b = BB.bots.get(n); return b?.me && dist(b.me, lair) < 12; });
      const enough = G.members.size >= 3 || (G.members.size >= 2 && now - G.at > 90000) || now - G.at > 180000;
      if (!G.formed && ready && enough) { G.formed = true; G.at = now; this.say(pick(['ok pulling', 'everyone ready? going in', "let's do this"])); }
    }
    const boss = this.mobs().find((m) => m.k === G.boss);
    if (G.formed && boss) {
      // everyone on the leader's target, warriors in front, ranged keep back
      return this.fight(boss.hp > 0 ? boss : null);
    }
    if (G.formed && !boss && dist(me, lair) < 8 && now - G.at > 30000) { this.leaveGroup(G); return; }   // dead (or gone)
    const spot = { x: lair.x + (this.ranged ? 6 : 4) * Math.cos(this.i), y: lair.y + (this.ranged ? 6 : 4) * Math.sin(this.i) };
    const safe = walkable(spot.x, spot.y) ? spot : lair;
    this.goTo(safe.x, safe.y, `grouping for ${MOBS[G.boss].name}`, 3);
  }
  leaveGroup(G) {
    G.members.delete(this.name);
    if (G.leader === this.name || !G.members.size) { BB.groups.delete(G.boss); for (const n of G.members) BB.bots.get(n)?.send({ t: 'party', op: 'leave' }); }
    this.send({ t: 'party', op: 'leave' }); this.invited = null;
  }

  // ---------------------------------------------------------------- errands
  needsTown() {
    if (!this.self || this.townBlock > Date.now()) return false;
    const gold = this.self.gold || 0;
    return (this.freeSlots() <= 2 && this.junk().length) || (this.potions() < 2 && gold >= 40) || this.townRun;
  }
  junk() {
    // anything sellable that isn't a potion, quest item, tool, or a gear upgrade for us
    const inv = this.self?.inv || [];
    return inv.map((s, i) => ({ s, i })).filter(({ s }) => {
      if (!s) return false; const d = ITEMS[s.item];
      if (!d || d.nosell || d.type === 'quest' || d.type === 'consumable' || d.type === 'hearth' || d.type === 'mount' || d.type === 'tool' || d.type === 'bait') return false;
      if (this.isUpgrade(s)) return false;
      // materials an active quest is collecting stay in the bag
      for (const [q, st] of Object.entries(this.self.quests || {})) if (st?.state === 'active' && QUESTS[q]?.item === s.item) return false;
      return true;
    });
  }
  gearScore(e) { if (!e) return 0; const st = itemStat(e); return st.atk * 1.3 + st.def * 1.1 + st.hp * 0.3 + Object.keys(e.b || {}).length * 4; }
  isUpgrade(s) { const d = ITEMS[s.item]; if (!d || !['weapon', 'armor', 'helm', 'gloves', 'boots', 'ring', 'amulet'].includes(d.type) || (d.cls && d.cls !== this.cls) || (d.lv && d.lv > this.lv)) return false; return this.gearScore(s) > this.gearScore(this.self.equip?.[d.type]); }
  townErrand() {
    const me = this.me, now = Date.now();
    if (!this.townRun) this.townSince = now;
    this.townRun = true;
    if (now - this.townSince > 150000) { this.townRun = false; this.townBlock = now + 300000; this.log('gave up on the town errand'); return; }
    // far away: hearthstone home
    if (dist(me, TOWN) > 70 && this.self.hearthReady && !this.attackers().length && now - (this.hearthAt || 0) > 30000) { this.hearthAt = now; this.send({ t: 'hearth' }); this.nextAt = now + 12000; return; }
    const stage = this.junk().length ? 'merchant' : 'apothecary';
    const n = this.ents.find((e) => e.ty === 'npc' && e.k === stage), at = n || NPC_AT[stage];
    if (!at) { this.townRun = false; return; }
    if (!n || dist(n, me) > 3.2) { const fr = NPCS[stage]?.front || [0, 1]; this.goTo(at.x + fr[0], at.y + fr[1], 'shopping', 0.9); return; }
    this.goal = null;
    if (stage === 'merchant') {
      // sell one thing at a time, like clicking through a bag
      const j = this.junk()[0];
      if (j) { this.send({ t: 'sell', slot: j.i }); this.self.inv[j.i] = j.s.qty > 1 ? { ...j.s, qty: j.s.qty - 1 } : null; this.nextAt = now + rnd(250, 500); }
      return;
    }
    const gold = this.self.gold || 0, want = Math.min(12, Math.floor(gold * 0.5 / 15));
    if (this.potions() < Math.max(3, want) && gold >= 15) {
      const big = this.lv >= 12 && gold >= 45 * 4;
      this.send({ t: 'buy', npc: n.i, item: big ? 'potion_big' : 'potion' }); this.nextAt = now + rnd(300, 600);
      if (this.potions() >= want) this.townRun = false;
      return;
    }
    this.townRun = false;
  }
  specDue() { return this.lv >= 10 && this.self && !this.self.spec && SPECS && (this.self.quests?.[`trial10_${this.cls}`]?.state === 'done') && !(this.specFail > Date.now()); }
  chooseSpec() {
    const trainer = NPC_AT['trainer_' + this.cls] ? 'trainer_' + this.cls : QUESTS[`trial10_${this.cls}`]?.giver;
    if (!trainer) { this.specFail = Date.now() + 600000; return; }
    const n = this.ents.find((e) => e.ty === 'npc' && e.k === trainer), at = n || NPC_AT[trainer];
    if (!at) return;
    if (!n || dist(n, this.me) > 16) { const fr = NPCS[trainer]?.front || [0, 1]; return this.goTo(at.x + fr[0], at.y + fr[1], 'choosing a path', 3); }
    const dlg = this.dialog;
    if (dlg && n && dlg.npc === n.i) {
      this.dialog = null;
      const specs = dlg.options.filter((o) => o.id.startsWith('spec:'));
      const o = specs.length ? specs[this.trait.brave > 0.6 ? 0 : specs.length - 1] : dlg.options.find((o) => o.id === 'spec') || dlg.options.find((o) => o.id === 'bye');
      setTimeout(() => this.send({ t: 'dialog', npc: n.i, choice: o.id }), rnd(800, 1800));
      if (!specs.length && o.id === 'bye') this.specFail = Date.now() + 600000;
      this.nextAt = Date.now() + 2000; return;
    }
    if (n && Date.now() - (this.talkAt || 0) > 4000) { this.talkAt = Date.now(); this.send({ t: 'interact', id: n.i }); }
  }
  // little things done between decisions: skill points, gear, the horse
  housekeeping(now) {
    if (!this.self || now - (this.houseAt || 0) < 2500) return;
    this.houseAt = now;
    const S = this.self;
    if (S.sp > 0) {
      // learn: the class's bread-and-butter skills first, then whatever's left
      const list = skillList(this.cls, S.spec, CLASSES).filter((k) => (S.skills?.[k] || 0) < 3 && (!SKILLS[k].unlock || (S.unlocks || []).includes(k)));
      const order = { warrior: ['cleave', 'battlecry', 'whirlwind'], ranger: ['multishot', 'dash', 'volley'], mage: ['fireball', 'heal', 'frostnova'] }[this.cls];
      list.sort((a, b) => ((S.skills?.[a] || 0) * 2 - (order.includes(a) ? 1 : 0)) - ((S.skills?.[b] || 0) * 2 - (order.includes(b) ? 1 : 0)));
      if (list[0]) { this.send({ t: 'learn', skill: list[0] }); S.sp--; }
    }
    if (!this.attackers().length) {
      const inv = S.inv || [];
      const up = inv.findIndex((s) => s && this.isUpgrade(s));
      if (up >= 0) { this.send({ t: 'use', slot: up }); this.log('equips', inv[up].item); }
      const horse = inv.findIndex((s) => s && ITEMS[s.item]?.type === 'mount');
      if (horse >= 0) this.send({ t: 'use', slot: horse });
    }
    if (S.mounted && this.attackers().length) this.send({ t: 'mount' });
  }
}

// ================================================================ start up
let port = 8080, stopping = false;
async function findPort() {
  for (let p = 8080; p <= 8120; p++) {
    const ok = await new Promise((r) => { const w = new WebSocket(`ws://127.0.0.1:${p}`); w.on('open', () => { w.close(); r(true); }); w.on('error', () => r(false)); });
    if (ok) return p;
  }
  return null;
}
port = Number(process.env.PORT) || await findPort();
if (!port) { console.log('The game host is not running. Start "Host Online Game.bat" first.'); process.exit(1); }
console.log(`Adding ${COUNT} bots to the game on port ${port}. Close this window to remove them.`);
for (let i = 0; i < COUNT; i++) setTimeout(() => new Bot(i), i * (COUNT > 50 ? 150 : 700));
// a short report every few minutes: who's where, doing what
setInterval(() => {
  const rows = [...BB.bots.values()].filter((b) => b.me).map((b) => `${b.name.padEnd(14)} L${String(b.lv).padStart(2)} ${(b.plan?.why || b.plan?.kind || '').slice(0, 40).padEnd(40)} ${b.placeName(b.me)}  deaths ${b.mem.deathsAt.length}`);
  if (rows.length) console.log(`\n--- ${new Date().toLocaleTimeString()} ---\n` + rows.slice(0, 40).join('\n'));
}, Number(process.env.BOTREPORT) || 180000);
process.on('SIGINT', () => { stopping = true; process.exit(0); });
