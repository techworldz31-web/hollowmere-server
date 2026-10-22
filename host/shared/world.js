// The authoritative game simulation. It has no idea whether it is running in
// a browser tab (single-player) or in Node behind a WebSocket server
// (multiplayer). It only:
//   - accepts clients via addClient / removeClient
//   - receives validated command messages via receive()
//   - advances a fixed tick via step(), returning outgoing messages
// Clients never touch this state directly; they render the snapshots it emits.
//
// The world is split into zones: the shared overworld ('world') plus private
// dungeon instances created per player run. Every entity carries its zone.

import { TICK_RATE, VIEW_RADIUS, dirFromVector, MAX_PLAYERS, PROTOCOL_VERSION, MAP_VERSION } from './constants.js';
import { C2S, S2C, validate } from './protocol.js';
import { generateMap, WORLD_SEED } from './mapgen.js';
import { generateDungeon } from './dungeon.js';
import { generateStarter, STARTER_NAME } from './starter.js';
import { findPath, lineClear, isBlocked } from './pathfind.js';
import { mulberry32, hash2 } from './rng.js';
import { hoursOf, between } from './town.js';
import { tradeMethods } from './world_trades.js';
import { townMethods } from './world_town.js';
import { farmMethods } from './world_farming.js';
import { questMethods } from './world_quests.js';
import { travelMethods, TRAVEL } from './world_travel.js';
import { partyMethods, PARTY_SHARE_RANGE } from './world_party.js';
import { progressMethods, freshProg } from './world_progress.js';
import { socialMethods } from './world_social.js';
import { tutorialMethods } from './world_tutorial.js';
import { bossMethods } from './world_bosses.js';
import { poiMethods } from './world_pois.js';
import { swapMethods } from './world_trade.js';
import { specMethods } from './world_specs.js';
import { SPECS, skillList } from './specs.js';
import { playerMods, GEAR_BONUS, GEAR_BONUS_KEYS } from './stats.js';
import { GEAR_SLOTS, DROP_SLOTS } from './gear.js';
import { TRADE_ORDER, FISH_ORDER, MEALS, NODES, TRADES } from './trades.js';
import { craftRarity, craftXp } from './crafting.js';
import {
  ITEMS, MOBS, NPCS, QUESTS, QUEST_ORDER, QUEST_DROPS, CLASSES, SKILLS, MAX_SKILL_RANK, RECIPES, PROJECTILES, RARITY,
  INVENTORY_SIZE, xpToNext, gearFor, itemStat, itemName, DAY_LENGTH_SEC, PETS, TITLES, DYES, FLOORS, BANK, INN_PRICE, DAWN, DUSK, MILESTONE_SKILLS,
  MOUNTS,
  buyPrice, sellPrice, npcBuys, QUEST_GOLD, xpScale, skillCost, maxManaFor } from './content.js';
const hash01 = (id) => hash2(id, 91, 5);
import { npcQuestState, questComplete, questProgress } from './quests.js';

const T = (seconds) => Math.round(seconds * TICK_RATE);
// cast bar names for monster spells
const CAST_NAMES = { bolt: 'Frost Bolt', shadowbolt: 'Shadow Bolt', arrow: 'Aimed Shot', web: 'Web Spit', fireball: 'Fireball' };
const BODY = 0.28;
const round2 = (v) => Math.round(v * 100) / 100;
const LEGACY_ITEMS = { sword_iron: 'sword_1', sword_steel: 'sword_2', armor_leather: 'armor_w1', armor_chain: 'armor_w2' };
const DYE_ITEMS = Object.keys(ITEMS).filter((k) => ITEMS[k].type === 'dye' && !ITEMS[k].special);

export class World {
  constructor({ seed = WORLD_SEED, trustClientSaves = false, hooks = {} } = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x5eed);
    this.tick = 0;
    this.nextId = 1;
    this.nextZone = 1;
    this.ents = new Map();          // id -> entity
    this.clients = new Map();       // clientId -> { entId, queue: [], ev: [] }
    this.trustClientSaves = trustClientSaves;  // true only for single-player
    this.hooks = hooks;             // { savePlayer(clientId, name, data), loadPlayer(name) }
    this.outbox = [];
    this.timers = [];               // delayed effects: { at, fn }
    this.tod = 0.32;                // time of day, 0 = midnight (starts mid-morning)
    this.weather = 0;               // 0 clear, 1 rain, 2 thunderstorm, 3 snow
    this.weatherUntil = T(60 * (4 + this.rng() * 5));
    this.zones = new Map();
    this.map = generateMap(seed);
    this.zones.set('world', { id: 'world', kind: 'world', map: this.map, seed });
    for (const s of this.map.spawns) this.spawnMob(s.kind, s.x, s.y, 'world');
    // how many of each kind stand in the world: a kind with few (they are spaced well apart) comes back sooner
    this.kindCount = {}; for (const s of this.map.spawns) this.kindCount[s.kind] = (this.kindCount[s.kind] || 0) + 1;
    this.initProgress();
    this.initSocial();
    this.seatTaken = new Set();      // town benches someone is sitting on
    this.danceTaken = new Set();     // festival dance spots
    for (const n of this.map.npcs) this.spawnNpc(n.kind, n.x, n.y, n.dir, { home: n.home, roam: n.roam, route: n.route, post: n.post });
    const cave = this.map.landmarks.cave;
    this.newEnt({ type: 'portal', kind: 'cave', x: cave.x, y: cave.y, zone: 'world', name: 'The Hollow Deep' });
    // herbs, ore veins and trees to chop; the hearth and the camp fire to cook at
    for (const n of this.map.nodes) this.newEnt({ type: 'node', kind: n.kind, x: n.x, y: n.y, name: NODES[n.kind].name, dep: 0 });
    for (const st of this.map.stations) this.newEnt({ type: 'station', kind: st.kind, x: st.x, y: st.y, name: NPCS[st.kind].name, ...(st.stone ? { stone: st.stone } : {}), ...(st.poi ? { poi: st.poi } : {}) });
    this.spawnWilds();               // foxes, wild horses and travellers on the roads (world_pois.js)
    this.day = 0;                    // counts whole days since the world started (market every 3rd, festival every 7th)
    this.town = { market: false, festival: false, raid: null, raidDay: -1, contest: null, ents: {} };
    this.initFarming();
    this.trades = new Map(); this.nextTrade = 1;   // player-to-player trades in progress
    this.parties = new Map();        // id -> { id, leader, members: [names] }
    this.partyByName = new Map();    // lower-case name -> party id (kept while someone is offline)
    this.nextParty = 1;
  }

  mapOf(e) { return this.zones.get(e.zone)?.map || this.map; }
  zoneInfo(z) { return { id: z.id, kind: z.kind, seed: z.seed, floor: z.floor ?? null, name: z.kind === 'world' ? 'Hollowmere' : z.kind === 'starter' ? STARTER_NAME : FLOORS[z.floor].name }; }

  // ---------------------------------------------------------------- clients
  addClient(clientId, hello) {
    if (!validate(hello) || hello.t !== C2S.HELLO) return this.send(clientId, { t: S2C.ERROR, message: 'This game version does not match the server. Refresh the page.' }), false;
    if (this.clients.size >= MAX_PLAYERS) return this.send(clientId, { t: S2C.ERROR, message: 'Server full' }), false;
    const name = hello.name.trim().slice(0, 16) || 'Wanderer';
    let save = null;
    if (this.trustClientSaves && hello.save && typeof hello.save === 'object') save = hello.save;
    else if (this.hooks.loadPlayer) save = this.hooks.loadPlayer(name);
    const cls = CLASSES[save?.cls] ? save.cls : save ? 'warrior' : CLASSES[hello.cls] ? hello.cls : 'warrior';
    const p = this.spawnPlayer(clientId, name, cls, save);
    p.tutClient = !!hello.tut;
    this.clients.set(clientId, { entId: p.id, queue: [], ev: [], lastSave: this.tick });
    // a hero bound for Tutorial Island is put there first, so the game opens straight onto it
    // (never a glimpse of the town before the island loads)
    p.quietZone = true; this.tutorialStart(p); p.quietZone = false;
    this.send(clientId, { t: S2C.WELCOME, id: p.id, seed: this.seed, tick: this.tick, proto: PROTOCOL_VERSION, tickRate: TICK_RATE, zone: this.zoneInfo(this.zones.get(p.zone) || this.zones.get('world')) });
    // a new hero starting on their own island is announced when they arrive in town instead
    if (!p.tutClient || p.tut?.done || p.level > 1) this.broadcastEvent({ e: 'sys', text: `${name} the ${CLASSES[cls].name} entered Hollowmere.` });
    if (this.skillPoints(p) > 0) this.privateEvent(p, { e: 'sys', text: `You have ${this.skillPoints(p)} skill point${this.skillPoints(p) > 1 ? 's' : ''} to spend. Press K to learn a skill.` });
    if (p.pet) this.summonPet(p);
    this.farmRestore(p, p.farmSave); p.farmSave = null;
    this.partyOnJoin(p);
    this.socialPresence(p, true);
    return true;
  }

  removeClient(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    const p = this.ents.get(c.entId);
    if (p) {
      this.savePlayer(clientId, p);
      this.tradeCancel(this.tradeOf(p), `${p.name} left, so the trade was cancelled.`);
      this.partyOnLeave(p);
      this.socialPresence(p, false);
      this.dismissPet(p);
      const zone = p.zone;
      this.ents.delete(p.id);
      this.cleanupZone(zone);
      this.broadcastEvent({ e: 'sys', text: `${p.name} left.` });
    }
    this.clients.delete(clientId);
  }

  receive(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || !validate(msg)) return;
    if (c.queue.length < 32) c.queue.push(msg);   // simple flood guard
  }

  send(clientId, msg) { this.outbox.push([clientId, msg]); }
  later(seconds, fn) { this.timers.push({ at: this.tick + T(seconds), fn }); }

  // ---------------------------------------------------------------- spawning
  newEnt(props) { const e = { id: this.nextId++, dir: 2, anim: 'idle', animT: this.tick, zone: 'world', ...props }; this.ents.set(e.id, e); return e; }

  spawnMob(kind, x, y, zone, extra = {}) {
    const d = MOBS[kind];
    return this.newEnt({ type: 'mob', kind, x, y, zone, hp: d.hp, maxHp: d.hp, spawn: { x, y }, state: 'idle', path: null, target: null,
      cdUntil: 0, swingAt: 0, slowUntil: 0, wanderAt: this.tick + T(1 + this.rng() * 4), damagers: new Map(), dir: Math.floor(this.rng() * 8),
      mechAt: {}, ...extra });
  }

  spawnNpc(kind, x, y, dir, extra = {}) { return this.newEnt({ type: 'npc', kind, x, y, dir, name: NPCS[kind].name, homeDir: dir, origin: { x, y }, ...extra }); }

  spawnPlayer(clientId, name, cls, save) {
    const s = this.map.playerSpawn;
    const p = this.newEnt({
      type: 'player', kind: cls, cls, clientId, name, x: s.x, y: s.y,
      level: 1, xp: 0, gold: 20, inv: new Array(INVENTORY_SIZE).fill(null),
      equip: { weapon: { item: CLASSES[cls].weapon, r: 0 }, armor: null },
      skills: {}, cds: {}, buffs: {}, titles: [], title: null, pets: [], pet: null, dye: 0, bosses: [],
      quests: {}, path: null, moveDir: null, target: null, pending: null, cdUntil: 0, swingAt: 0, animLock: 0,
      channel: null, dash: null, slowUntil: 0, lastHurt: -9999, deadAt: 0, selfDirty: true,
      bank: { size: BANK.start, items: new Array(BANK.start).fill(null), gold: 0 },
      trades: {}, fishLog: {}, recipes: [], fish: null, gather: null, act: null, castAt: null, unlocks: [], region: null,
      mounts: [], mount: null, mounted: null, travel: null, stones: [], hearthReady: 0, spec: null, prog: freshProg(), friends: [], tut: null,
    });
    p.inv[0] = { item: 'potion', qty: 3 };
    p.inv[1] = { item: 'hearthstone', qty: 1 };
    if (save) this.applySave(p, save);
    this.loadProg(p, save);
    this.recalcStats(p);
    p.hp = save && save.hp > 0 ? Math.min(save.hp, p.maxHp) : p.maxHp;
    return p;
  }

  applySave(p, s) {
    const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const okEntry = (it) => {
      if (!it || typeof it !== 'object') return null;
      const item = LEGACY_ITEMS[it.item] || it.item;
      if (!ITEMS[item]) return null;
      const r = okInt(it.r, 0, RARITY.length - 1) ? it.r : 0;
      const b = r && !ITEMS[item].stack ? this.okBonus(it.b) : null;
      return { item, qty: okInt(it.qty, 1, 999) ? it.qty : 1, ...(r ? { r } : {}), ...(b ? { b } : {}) };
    };
    if (Array.isArray(s.friends)) p.friends = s.friends.filter((f) => typeof f === 'string' && f.length <= 16).slice(0, 50);
    if (s.tut && typeof s.tut === 'object') p.tut = { s: Math.max(0, Math.min(99, s.tut.s | 0)), done: !!s.tut.done };
    if (s.guildSolo && !this.hooks.saveGuilds && !this.guilds?.has(String(s.guildSolo.name || '').toLowerCase())) this.restoreGuild?.(s.guildSolo);
    if (okInt(s.level, 1, 99)) p.level = s.level;
    if (okInt(s.xp, 0, 1e9)) p.xp = s.xp;
    if (okInt(s.gold, 0, 1e9)) p.gold = s.gold;
    if (Array.isArray(s.inv)) p.inv = new Array(INVENTORY_SIZE).fill(null).map((_, i) => okEntry(s.inv[i]));
    if (s.equip) for (const slot of GEAR_SLOTS) {
      let e = s.equip[slot];
      if (typeof e === 'string') e = { item: e };                        // v1 saves stored plain ids
      e = okEntry(e);
      if (e && ITEMS[e.item].type === slot) {
        if (!ITEMS[e.item].cls || ITEMS[e.item].cls === p.cls) p.equip[slot] = { item: e.item, r: e.r || 0, ...(e.b ? { b: e.b } : {}) };
        else { const i = p.inv.indexOf(null); if (i >= 0) p.inv[i] = { item: e.item, qty: 1, ...(e.r ? { r: e.r } : {}), ...(e.b ? { b: e.b } : {}) }; }
      }
    }
    if (!p.equip.weapon) p.equip.weapon = { item: CLASSES[p.cls].weapon, r: 0 };
    if (SPECS[s.spec]?.cls === p.cls) p.spec = s.spec;
    if (s.skills && typeof s.skills === 'object') {
      let spent = 0;
      const unl = Array.isArray(s.unlocks) ? s.unlocks : [];
      for (const sk of skillList(p.cls, p.spec, CLASSES)) {
        if (SKILLS[sk].unlock && !unl.includes(sk)) continue;
        const r = s.skills[sk];
        if (okInt(r, 1, MAX_SKILL_RANK) && spent + r <= p.level) { p.skills[sk] = r; spent += r; }
      }
    }
    if (s.quests && typeof s.quests === 'object') for (const q of QUEST_ORDER) {
      const v = s.quests[q]; if (v && (v.state === 'active' || v.state === 'done')) p.quests[q] = { state: v.state, count: okInt(v.count, 0, 999) ? v.count : 0 };
    }
    if (Array.isArray(s.titles)) p.titles = s.titles.filter((t) => TITLES[t]);
    if (TITLES[s.title] && p.titles.includes(s.title)) p.title = s.title;
    if (Array.isArray(s.pets)) p.pets = s.pets.filter((t) => PETS[t]);
    if (PETS[s.pet] && p.pets.includes(s.pet)) p.pet = s.pet;
    if (okInt(s.dye, 0, DYES.length - 1)) p.dye = s.dye;
    if (Array.isArray(s.bosses)) p.bosses = s.bosses.filter((b) => MOBS[b]?.boss);
    // older saves: grant titles for quests already finished
    for (const q of QUEST_ORDER) if (p.quests[q]?.state === 'done' && QUESTS[q].reward.title && !p.titles.includes(QUESTS[q].reward.title)) p.titles.push(QUESTS[q].reward.title);
    if (p.quests.chief?.state === 'done' && !p.quests.map && !p.inv.some((i) => i?.item === 'sealed_map')) this.addItem(p, 'sealed_map', 1);
    if (s.bank && typeof s.bank === 'object') {
      const size = okInt(s.bank.size, BANK.start, BANK.max) && (s.bank.size - BANK.start) % BANK.step === 0 ? s.bank.size : BANK.start;
      p.bank = { size, items: new Array(size).fill(null).map((_, i) => okEntry(Array.isArray(s.bank.items) ? s.bank.items[i] : null)), gold: okInt(s.bank.gold, 0, 1e9) ? s.bank.gold : 0 };
    }
    if (s.trades && typeof s.trades === 'object') for (const k of TRADE_ORDER) if (okInt(s.trades[k], 0, 1e8)) p.trades[k] = s.trades[k];
    if (s.fishLog && typeof s.fishLog === 'object') for (const k of FISH_ORDER) {
      const v = s.fishLog[k];
      if (Array.isArray(v) && okInt(v[0], 1, 1e7) && typeof v[1] === 'number' && v[1] > 0 && v[1] < 200) p.fishLog[k] = [v[0], Math.round(v[1] * 100) / 100];
    }
    if (Array.isArray(s.farm)) p.farmSave = s.farm;
    if (Array.isArray(s.unlocks)) p.unlocks = s.unlocks.filter((k, i, a) => SKILLS[k]?.unlock && SKILLS[k].cls === p.cls && a.indexOf(k) === i);
    if (Array.isArray(s.recipes)) p.recipes = s.recipes.filter((r, i, a) => MEALS[r]?.learned && a.indexOf(r) === i);
    // travel: mounts known, waystones attuned, hearthstone cooldown left
    if (Array.isArray(s.mounts)) p.mounts = s.mounts.filter((k, i, a) => MOUNTS[k] && a.indexOf(k) === i);
    if (MOUNTS[s.mount] && p.mounts.includes(s.mount)) p.mount = s.mount;
    if (Array.isArray(s.stones)) p.stones = s.stones.filter((k, i, a) => typeof k === 'string' && k.length < 24 && a.indexOf(k) === i);
    if (okInt(s.hearthLeft, 0, TRAVEL.hearthCd)) p.hearthReady = this.tick + T(s.hearthLeft);
    const owns = (item) => p.inv.some((i) => i?.item === item) || p.bank.items.some((i) => i?.item === item);
    if (!owns('hearthstone')) this.addItem(p, 'hearthstone', 1);
    // heroes who passed the level 10 trial before horses existed get theirs now
    if (QUEST_ORDER.some((q) => QUESTS[q].milestone === 10 && p.quests[q]?.state === 'done') && !p.mounts.includes('horse') && !owns('mount_horse')) this.addItem(p, 'mount_horse', 1);
    // a save from before the town grew lands you in the square instead of where the old map had you
    if (s.mapv === MAP_VERSION && typeof s.x === 'number' && typeof s.y === 'number' && !isBlocked(this.map, Math.floor(s.x), Math.floor(s.y))) { p.x = s.x; p.y = s.y; }
  }

  serializePlayer(p) {
    // progress inside a dungeon run isn't saved mid-run: you come back at the cave mouth
    const kind = this.zones.get(p.zone)?.kind;
    const pos = p.zone === 'world' ? p : kind === 'starter' ? this.map.playerSpawn : this.map.landmarks.cave;
    return { v: 3, name: p.name, cls: p.cls, level: p.level, xp: p.xp, gold: p.gold, hp: p.hp, inv: p.inv, equip: p.equip,
      skills: p.skills, quests: p.quests, titles: p.titles, title: p.title, pets: p.pets, pet: p.pet, dye: p.dye, bosses: p.bosses,
      bank: p.bank, trades: p.trades, fishLog: p.fishLog, recipes: p.recipes, farm: this.farmSave(p), unlocks: p.unlocks,
      spec: p.spec, mounts: p.mounts, mount: p.mount, stones: p.stones, prog: p.prog && { ...p.prog, lastSeen: Date.now() }, friends: p.friends, tut: p.tut, guildSolo: !this.hooks.saveGuilds && this.guildOf(p) ? this.guildOf(p) : undefined, hearthLeft: Math.max(0, Math.ceil((p.hearthReady - this.tick) / TICK_RATE)),
      x: round2(pos.x), y: round2(pos.y), mapv: MAP_VERSION };
  }

  savePlayer(clientId, p) { this.hooks.savePlayer?.(clientId, p.name, this.serializePlayer(p)); }

  skillPoints(p) { return p.level - Object.values(p.skills).reduce((a, b) => a + b, 0); }

  recalcStats(p) {
    const c = CLASSES[p.cls], L = p.level - 1;
    p.mods = playerMods(p);
    p.maxHp = Math.round((c.hp + L * c.gains.hp + p.mods.hpFlat) * (1 + p.mods.hp));
    let gAtk = 0, gDef = 0, gHp = 0;
    for (const slot of GEAR_SLOTS) { const e = p.equip[slot]; if (!e) continue; const st = itemStat(e); gAtk += st.atk; gDef += st.def; gHp += st.hp; }
    p.maxHp += Math.round(gHp * (1 + p.mods.hp));
    p.maxMp = maxManaFor(p.cls, p.level);
    p.mp = Math.min(p.mp ?? p.maxMp, p.maxMp);
    p.atk = c.atk + L * c.gains.atk + gAtk;
    p.def = c.def + L * c.gains.def + gDef;
    p.hp = Math.min(p.hp ?? p.maxHp, p.maxHp);
    p.selfDirty = true;
  }

  atkOf(e) {
    if (e.type !== 'player') return MOBS[e.kind].atk * (e.enraged ? 1.25 : 1) * (e.rareMul || 1);
    const b = e.buffs.battlecry, ee = e.buffs.eagleeye; return e.atk * (b && b.until > this.tick ? b.mul : 1) * (ee && ee.until > this.tick ? ee.mul : 1) * (1 + this.buffFx(e).atk + (e.mods?.atk || 0));
  }
  defOf(e) {
    if (e.type !== 'player') return MOBS[e.kind].def;
    const b = e.buffs.battlecry; return e.def * (b && b.until > this.tick ? b.mul : 1) * (1 + this.buffFx(e).def + (e.mods?.def || 0));
  }

  // ---------------------------------------------------------------- events
  // Positional events go to clients whose player is in that zone and can see the spot.
  event(ev, x, y, zone) {
    for (const [, c] of this.clients) {
      const p = this.ents.get(c.entId);
      if (p && p.zone === zone && Math.hypot(p.x - x, p.y - y) <= VIEW_RADIUS) c.ev.push(ev);
    }
  }
  evAt(e, ev) { this.event(ev, e.x, e.y, e.zone); }
  broadcastEvent(ev) { for (const [, c] of this.clients) c.ev.push(ev); }
  zoneEvent(zone, ev) { for (const [, c] of this.clients) { const p = this.ents.get(c.entId); if (p?.zone === zone) c.ev.push(ev); } }
  privateEvent(p, ev) { const c = this.clients.get(p.clientId); if (c) c.ev.push(ev); }

  setAnim(e, anim) { if (e.anim !== anim) { e.anim = anim; e.animT = this.tick; } }
  playAnim(e, anim, seconds) { e.anim = anim; e.animT = this.tick; e.animLock = this.tick + T(seconds); }

  // ---------------------------------------------------------------- zones / dungeon instances
  movePlayer(p, zoneId, x, y) {
    this.stopWork(p);
    const old = p.zone;
    p.zone = zoneId; p.x = x; p.y = y;
    p.path = null; p.target = null; p.moveDir = null; p.pending = null; p.channel = null; p.dash = null; p.swingAt = 0;
    const pet = this.petOf(p);
    if (pet) { pet.zone = zoneId; pet.x = x - 0.6; pet.y = y - 0.6; }
    if (!p.quietZone) this.send(p.clientId, { t: S2C.ZONE, zone: this.zoneInfo(this.zones.get(zoneId)) });
    if (old !== zoneId) this.cleanupZone(old);
    p.selfDirty = true;
  }

  enterDungeon(p, floor) {
    // a party shares one copy of each floor: join a party member's if there is one
    const party = this.partyOf(p);
    if (party) {
      for (const z of this.zones.values()) if (z.kind === 'dungeon' && z.partyId === party.id && z.floor === floor) {
        const sp = z.map.playerSpawn;
        this.movePlayer(p, z.id, sp.x, sp.y);
        this.privateEvent(p, { e: 'floor', floor, name: FLOORS[floor].name });
        return;
      }
    }
    const id = `deep${this.nextZone++}`, seed = Math.floor(this.rng() * 1e9);
    const map = generateDungeon(seed, floor);
    const z = { id, kind: 'dungeon', map, seed, floor, owner: p.id, partyId: party?.id ?? null, bossDead: false };
    this.zones.set(id, z);
    for (const s of map.spawns) {
      const m = this.spawnMob(s.kind, s.x, s.y, id);
      if (s.boss) { m.boss = true; z.bossId = m.id; }
    }
    for (const c of map.dungeon.chests) this.newEnt({ type: 'chest', kind: 'chest', x: c.x, y: c.y, zone: id, dir: 1 });
    for (const t of map.dungeon.traps) this.newEnt({ type: 'trap', kind: 'spikes', x: t.x, y: t.y, zone: id, phase: Math.floor(this.rng() * T(2.4)) });
    this.newEnt({ type: 'portal', kind: 'exit', x: map.dungeon.exit.x, y: map.dungeon.exit.y, zone: id, name: 'Rope to the surface' });
    if (floor < FLOORS.length - 1) this.newEnt({ type: 'portal', kind: 'stairs', x: map.dungeon.stairs.x, y: map.dungeon.stairs.y, zone: id, locked: true, name: 'Stairs down' });
    this.movePlayer(p, id, map.playerSpawn.x, map.playerSpawn.y);
    this.privateEvent(p, { e: 'floor', floor, name: FLOORS[floor].name });
  }

  leaveToWorld(p, where = 'cave') {
    const spot = where === 'cave' ? this.map.landmarks.cave : this.map.playerSpawn;
    this.movePlayer(p, 'world', spot.x, spot.y + (where === 'cave' ? 1 : 0));
  }

  // remove an empty dungeon instance and everything in it
  cleanupZone(zoneId) {
    if (!zoneId || zoneId === 'world') return;
    for (const e of this.ents.values()) if (e.zone === zoneId && e.type === 'player') return;
    for (const [id, e] of this.ents) if (e.zone === zoneId) this.ents.delete(id);
    this.timers = this.timers.filter((t) => t.zone !== zoneId);
    this.zones.delete(zoneId);
  }

  // ---------------------------------------------------------------- the tick
  step() {
    this.tick++;
    const tod = this.tod + 1 / (DAY_LENGTH_SEC * TICK_RATE);
    if (tod >= 1) this.day++;
    this.tod = tod % 1;
    if (this.tick % 10 === 0) this.updateTown();
    if (this.tick % 5 === 0 && (this.parties.size || this.tick % 20 === 0)) this.updateParties();
    if (this.tick % 5 === 2) this.updateTrades();
    if (this.tick % TICK_RATE === 5) this.rareTick();
    if (this.tick % TICK_RATE === 6) this.socialTick();
    if (this.tick % TICK_RATE === 3) this.updateCrops();
    if (this.tick >= this.weatherUntil) {
      if (this.weather) this.weather = 0;
      else { const r = this.rng(); this.weather = r < 0.55 ? 1 : r < 0.8 ? 2 : 3; }
      this.weatherUntil = this.tick + T(60 * (this.weather ? 1.5 + this.rng() * 2 : 5 + this.rng() * 7));
    }
    for (const [clientId, c] of this.clients) {
      const p = this.ents.get(c.entId);
      for (const m of c.queue) if (p) this.handle(clientId, p, m);
      c.queue.length = 0;
    }
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.tick);
      this.timers = this.timers.filter((t) => t.at > this.tick);
      for (const t of due) t.fn();
    }
    for (const e of [...this.ents.values()]) {
      if (!this.ents.has(e.id)) continue;
      switch (e.type) {
        case 'player': this.updatePlayer(e); break;
        case 'mob': this.updateMob(e); break;
        case 'proj': this.updateProjectile(e); break;
        case 'loot': this.updateLoot(e); break;
        case 'npc': this.updateNpc(e); break;
        case 'pet': this.updatePet(e); break;
        case 'trap': this.updateTrap(e); break;
        case 'snare': this.updateSnare(e); break;
        case 'ally': this.updateAlly(e); break;
      }
    }
    for (const [clientId, c] of this.clients) {
      const p = this.ents.get(c.entId);
      if (!p) continue;
      this.send(clientId, this.snapshotFor(p, c));
      if (this.tick - c.lastSave > T(10)) { c.lastSave = this.tick; this.savePlayer(clientId, p); }
    }
    const out = this.outbox; this.outbox = [];
    return out;
  }

  snapshotFor(p, c) {
    const ents = [];
    for (const e of this.ents.values()) {
      if (e.zone !== p.zone || e.hidden || Math.abs(e.x - p.x) > VIEW_RADIUS || Math.abs(e.y - p.y) > VIEW_RADIUS) continue;
      if (e.vanish && e !== p && !p.admin) continue;                 // an admin who has vanished
      if (e.type === 'node' && e.dep && this.tick >= e.dep) this.nodeRefresh(e);
      const o = { i: e.id, ty: e.type, k: e.kind, x: round2(e.x), y: round2(e.y), d: e.dir, a: e.anim, at: e.animT };
      if (e.type === 'player' || e.type === 'mob') { o.hp = e.hp; o.mh = e.maxHp; }
      if (e.rare) { o.rr = 1; o.n = e.rare.name; o.rl = e.rareLv; }
      if (e.type === 'player') { const g = this.guildOf(e); if (g) o.gt = g.tag; }
      if (e.type === 'player' || e.type === 'npc' || e.type === 'portal') o.n = e.name;
      if (e.type === 'player') {
        o.lv = e.level;
        const tier = (k) => e.equip[k] ? ITEMS[e.equip[k].item].tier : 0;
        o.g = [tier('weapon'), tier('armor'), e.dye, tier('helm'), tier('gloves'), tier('boots')];
        if (e.title) o.tt = e.title;
        if (e.mounted) o.mt = MOUNTS[e.mounted].sprite;
        if (e.buffs.ward?.until > this.tick || e.buffs.barrier?.until > this.tick) o.st = e.buffs.barrier?.until > this.tick ? 'ice' : 'ward';
        else if (e.buffs.shieldwall?.until > this.tick) o.st = 'wall';
        else if (e.buffs.rampage?.until > this.tick) o.st = 'rage';
        else if (e.buffs.battlecry?.until > this.tick) o.st = 'buff';
        else if (e.slowUntil > this.tick) o.st = 'slow';
      }
      if (e.type === 'mob') { if (e.slowUntil > this.tick) o.st = 'slow'; if (e.burn) o.st = 'burn'; if (e.markUntil > this.tick) o.st = 'mark'; if (e.enraged) o.st = 'rage'; if (e.bomb > this.tick) o.bm = e.bomb; if (e.cast && e.cast.end > this.tick && e.hp > 0 && !(e.stunUntil > this.tick)) o.cb = [e.cast.start, e.cast.end, e.cast.name]; }
      if (e.type === 'loot') { o.q = e.qty; if (e.r) o.r = e.r; }
      if (e.type === 'pet') o.n = PETS[e.kind].name;
      if (e.type === 'ally') { o.n = e.name; o.ow = e.owner; }
      if (e.type === 'portal' && e.locked) o.lk = 1;
      if (e.type === 'chest' && e.opened) o.op = 1;
      if (e.type === 'node' && e.dep > this.tick) o.dp = 1;
      if (e.type === 'prop') o.v = e.v;
      if (e.type === 'station') o.n = e.name;
      if (e.type === 'crop') { o.v = e.stage; o.n = e.owner; if (e.withered) o.wd = 1; if (e.fert) o.f = 1; }
      if (e.type === 'npc' && e.target) o.st = 'rage';
      ents.push(o);
    }
    const snap = { t: S2C.SNAP, tick: this.tick, tod: Math.round(this.tod * 1e4) / 1e4, wx: this.weather, ents };
    const tw = (this.town.market ? 1 : 0) | (this.town.festival ? 2 : 0) | (this.town.raid ? 4 : 0);
    if (tw) snap.tw = tw;
    if (p.zone === 'world' && this.ridgeSnowing(p)) snap.sf = 1;   // Frostridge's snow, yours and your party's alone
    if (c.ev.length) { snap.ev = c.ev; c.ev = []; }
    if (p.selfDirty) {
      p.selfDirty = false;
      const buffs = {};
      // the buff bar: when each runs out, who cast it and how long it lasted in all
      const binfo = {};
      for (const [k, b] of Object.entries(p.buffs)) if (b.until > this.tick) { buffs[k] = b.until; b.start ??= this.tick; binfo[k] = [b.from || null, b.until - b.start]; }
      if (p.slowUntil > this.tick) { buffs.slow = p.slowUntil; binfo.slow = [null, 0]; }
      snap.self = { cls: p.cls, hp: p.hp, maxHp: p.maxHp, mp: Math.floor(p.mp ?? 0), maxMp: p.maxMp || 0, level: p.level, xp: p.xp, xpNext: xpToNext(p.level), gold: p.gold,
        atk: Math.round(this.atkOf(p)), def: Math.round(this.defOf(p)), inv: p.inv, equip: p.equip, quests: p.quests,
        skills: p.skills, sp: this.skillPoints(p), cds: p.cds, buffs, dead: p.anim === 'die',
        titles: p.titles, title: p.title, pets: p.pets, pet: p.pet, dye: p.dye, zone: p.zone, bank: p.bank,
        trades: p.trades, fishLog: p.fishLog, recipes: p.recipes, act: p.act, unlocks: p.unlocks,
        spec: p.spec, mods: p.mods, mounts: p.mounts, mount: p.mount, mounted: p.mounted, stones: p.stones, hearthReady: p.hearthReady, travel: p.travel && { kind: p.travel.kind, start: p.travel.start, until: p.travel.until } };
      const bfx = {};
      for (const k of ['meal', 'elixir']) { const b = p.buffs[k]; if (b && b.until > this.tick) bfx[k] = { k: b.kind, until: b.until }; }
      snap.self.bfx = bfx; snap.self.binfo = binfo;
      snap.self.tut = this.tutView(p);
      if (p.prog) snap.self.prog = { rested: Math.round(p.prog.rested), daily: p.prog.daily, ach: Object.keys(p.prog.ach), disc: p.prog.stats.disc.length, discN: this.zoneList?.length || 0, found: p.prog.stats.disc.filter((id) => id.startsWith('poi_')), rares: p.prog.stats.rares, kills: p.prog.stats.kills };
      if (p.prog && this.tick - (p.achvSent || -1e9) > T(4)) { p.achvSent = this.tick; snap.self.prog.achv = this.achView(p); }
    }
    return snap;
  }

  // ---------------------------------------------------------------- commands
  handle(clientId, p, m) {
    const dead = p.anim === 'die';
    // held by an admin (frozen or jailed): no moving, fighting, working or travelling
    // on the ferry from Tutorial Island: along for the ride
    if (p.riding && [C2S.MOVE, C2S.DIR, C2S.TRAVEL, C2S.HEARTH, C2S.ATTACK, C2S.INTERACT, C2S.SKILL, C2S.FISH, C2S.FARM, C2S.MOUNT].includes(m.t)) return;
    if (p.frozen && [C2S.MOVE, C2S.DIR, C2S.TRAVEL, C2S.HEARTH, C2S.ATTACK, C2S.INTERACT, C2S.SKILL, C2S.FISH, C2S.FARM, C2S.MOUNT].includes(m.t)) {
      if (this.tick >= (p.frozenNote || 0)) { p.frozenNote = this.tick + T(4); this.privateEvent(p, { e: 'sys', text: p.frozen === 'jail' ? 'You are in jail and can\'t move until an admin lets you out.' : 'An admin has frozen you in place.' }); }
      return;
    }
    // fighting and working break a travel channel and get you off your horse
    if ([C2S.ATTACK, C2S.SKILL, C2S.FISH, C2S.FARM, C2S.INTERACT].includes(m.t)) {
      if (p.travel) this.cancelTravel(p);
      if (m.t !== C2S.INTERACT) this.dismount(p, true);
    }
    switch (m.t) {
      case C2S.MOUNT: return this.toggleMount(p);
      case C2S.PARTY: return this.partyCommand(p, m);
      case C2S.TRADE: return this.tradeCommand(p, m);
      case C2S.DESTROY: return this.destroyItem(p, m.slot, m.qty);
      case C2S.DROP: return this.dropItem(p, m.slot, m.qty);
      case C2S.HEARTH:
        if (!p.inv.some((i) => i?.item === 'hearthstone')) return this.privateEvent(p, { e: 'sys', text: 'Your hearthstone isn\'t in your pack.' });
        return this.useHearth(p);
      case C2S.TRAVEL: return dead ? undefined : this.travelTo(p, m.x, m.y);
      case C2S.MOVE:
        if (dead) return;
        this.stopWork(p);
        p.target = null; p.pending = null; p.moveDir = null;
        p.path = findPath(this.mapOf(p), p.x, p.y, m.x, m.y) || null;
        break;
      case C2S.DIR: {
        if (dead) return;
        const len = Math.hypot(m.dx, m.dy);
        p.moveDir = len > 0.01 ? { x: m.dx / len, y: m.dy / len } : null;
        if (p.moveDir) { p.path = null; p.target = null; p.pending = null; this.stopWork(p); }
        break;
      }
      case C2S.ATTACK: {
        if (dead) return;
        const t = this.ents.get(m.id);
        if (t && t.zone === p.zone && t.type === 'mob' && t.hp > 0) { this.stopWork(p); p.target = t.id; p.pending = null; p.moveDir = null; p.path = null; p.repathAt = 0; }
        break;
      }
      case C2S.INTERACT: {
        if (dead) return;
        const t = this.ents.get(m.id);
        if (t && t.zone === p.zone && ['npc', 'loot', 'chest', 'portal', 'node', 'station', 'crop'].includes(t.type) && !t.hidden) {
          this.stopWork(p);
          const fr = t.type === 'npc' ? t.front || NPCS[t.kind].front : null;
          p.pending = t.id; p.target = null; p.moveDir = null; p.path = findPath(this.mapOf(p), p.x, p.y, t.x + (fr ? fr[0] : 0), t.y + (fr ? fr[1] : 0));
        }
        break;
      }
      case C2S.SKILL: this.stopWork(p); p.aimId = Number.isFinite(m.id) ? m.id : null; return this.castSkill(p, m.slot, m.x, m.y);
      case C2S.FISH: if (dead) return; return this.startFishing(p, m.x, m.y);
      case C2S.HOOK: return this.hook(p);
      case C2S.FARM: return this.farmCommand(p, m);
      case C2S.LEARN: return this.learn(p, m.skill);
      case C2S.USE: return this.useItem(p, m.slot);
      case C2S.UNEQUIP: return this.unequip(p, m.slot);
      case C2S.SELL: return this.sell(p, m.slot);
      case C2S.BUY: return this.buy(p, m.npc, m.item);
      case C2S.CRAFT: return this.craft(p, m.npc, m.recipe);
      case C2S.DIALOG: return this.dialogChoice(p, m.npc, m.choice);
      case C2S.SETPET:
        if (m.pet && !p.pets.includes(m.pet)) return;
        this.dismissPet(p); p.pet = m.pet || null; if (p.pet) this.summonPet(p); p.selfDirty = true;
        break;
      case C2S.SETTITLE:
        if (m.title && !p.titles.includes(m.title)) return;
        p.title = m.title || null; p.selfDirty = true;
        break;
      case C2S.SETDYE: p.dye = 0; p.selfDirty = true; break;
      case C2S.CHAT: {
        const text = m.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
        if (/^\/admin\b/i.test(text)) break;                       // admin commands are the online server's business
        if (p.muted && text && !/^\/stuck\b/i.test(text)) { this.privateEvent(p, { e: 'sys', text: 'An admin has muted you: your messages aren\'t being sent.' }); break; }
        if (text.toLowerCase() === '/stuck') { if (!p.frozen) this.rescue(p); break; }
        // party: /invite Name, /leave, /kick Name, /promote Name, /p message (party chat)
        const tm = text.match(/^\/trade\s+(.+)$/i);
        if (tm) { this.tradeAsk(p, tm[1].trim()); break; }
        const pc = text.match(/^\/(invite|inv|kick|promote|leave|p|party)\b\s*(.*)$/i);
        if (pc) {
          const cmd = pc[1].toLowerCase(), arg = pc[2].trim();
          if (cmd === 'invite' || cmd === 'inv') this.partyInvite(p, arg);
          else if (cmd === 'kick') this.partyKick(p, arg);
          else if (cmd === 'promote') this.partyPromote(p, arg);
          else if (cmd === 'leave') this.partyLeave(p);
          else {
            const party = this.partyOf(p);
            if (!party) this.privateEvent(p, { e: 'sys', text: 'You\'re not in a party. Invite someone with /invite Name.' });
            else if (arg) this.partySay(party, { e: 'chat', from: p.name, text: arg, party: 1 });
          }
          break;
        }
        // /weather clear|rain|storm|snow — change the sky (handy for screenshots)
        const wm = text.toLowerCase().match(/^\/weather (clear|rain|storm|snow)$/);
        if (wm) { this.weather = ['clear', 'rain', 'storm', 'snow'].indexOf(wm[1]); this.weatherUntil = this.tick + T(60 * 4); this.broadcastEvent({ e: 'sys', text: `The weather turns: ${wm[1]}.` }); break; }
        if (text && this.chatChannel(p, text)) break;
        if (text) this.sayNear(p, text);
        break;
      }
      case C2S.GUILD: return this.guildOp(p, m);
      case C2S.FRIEND: return this.friendOp(p, m);
      case C2S.TUT: return this.tutorialOp(p, m);
      case C2S.PREFS: p.auto = m.auto; if (m.loot !== undefined) p.autoLoot = m.loot === 1; break;
      case C2S.LOOTALL: return this.lootAll(p);
      case C2S.SORT: return this.sortBag(p, m.where);
      case C2S.BANK: return this.bankOp(p, m);
      case C2S.PING: this.send(clientId, { t: S2C.PONG, t0: m.t }); break;
    }
  }

  // ---------------------------------------------------------------- movement
  moveBy(e, dx, dy) {
    const map = this.mapOf(e);
    const tryAxis = (nx, ny) => !(
      isBlocked(map, Math.floor(nx - BODY), Math.floor(ny - BODY)) || isBlocked(map, Math.floor(nx + BODY), Math.floor(ny - BODY)) ||
      isBlocked(map, Math.floor(nx - BODY), Math.floor(ny + BODY)) || isBlocked(map, Math.floor(nx + BODY), Math.floor(ny + BODY)));
    let moved = false;
    if (tryAxis(e.x + dx, e.y)) { e.x += dx; moved = true; }
    if (tryAxis(e.x, e.y + dy)) { e.y += dy; moved = true; }
    return moved;
  }

  // Follows e.path; returns true while still moving.
  followPath(e, speed) {
    if (!e.path || !e.path.length) { e.path = null; return false; }
    let budget = speed / TICK_RATE;
    while (budget > 0 && e.path.length) {
      const wp = e.path[0];
      const dx = wp.x - e.x, dy = wp.y - e.y, d = Math.hypot(dx, dy);
      if (d <= budget) { e.x = wp.x; e.y = wp.y; e.path.shift(); budget -= d; continue; }
      e.dir = dirFromVector(dx, dy);
      if (!this.moveBy(e, dx / d * budget, dy / d * budget)) {
        // snagged on a corner: step back to the middle of this tile first, then carry on
        const cx = Math.floor(e.x) + 0.5, cy = Math.floor(e.y) + 0.5;
        if (!e.unsnag && Math.hypot(cx - e.x, cy - e.y) > 0.02) { e.unsnag = true; e.path.unshift({ x: cx, y: cy }); continue; }
        e.path = null; e.unsnag = false; return false;
      }
      e.unsnag = false;
      budget = 0;
    }
    if (!e.path.length) e.path = null;
    return true;
  }

  playerSpeed(p) {
    const map = this.mapOf(p);
    const web = map.slow && map.slow[Math.floor(p.y) * map.w + Math.floor(p.x)];
    return CLASSES[p.cls].speed * (web || p.slowUntil > this.tick ? 0.55 : 1) * (1 + this.buffFx(p).spd + (p.mods?.spd || 0)) * this.mountSpeed(p);
  }

  // ---------------------------------------------------------------- players
  // "/stuck" in chat: back to the rope at the start of this dungeon level, or the village square.
  rescue(p) {
    if (p.anim === 'die') return;
    const map = this.mapOf(p), ex = map.dungeon?.exit;
    const to = ex ? { x: ex.x + 0.8, y: ex.y + 0.8 } : this.map.playerSpawn;
    p.x = to.x; p.y = to.y; p.path = null; p.target = null; p.moveDir = null; p.pending = null; p.channel = null; p.dash = null;
    this.unstick(p);
    p.selfDirty = true;
    this.privateEvent(p, { e: 'sys', text: ex ? 'You find your way back to the rope.' : 'You make your way back to the village square.' });
  }

  // Never leave a hero inside a wall (whatever put them there): hop to the nearest open tile.
  unstick(e) {
    const map = this.mapOf(e);
    const x0 = Math.floor(e.x), y0 = Math.floor(e.y);
    if (!isBlocked(map, x0, y0)) return;
    for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || isBlocked(map, x0 + dx, y0 + dy)) continue;
      e.x = x0 + dx + 0.5; e.y = y0 + dy + 0.5; e.path = null;
      return;
    }
  }

  updatePlayer(p) {
    if (this.tick % 10 === 0) this.unstick(p);
    if (this.tick % 10 === p.id % 10) { this.questTick(p); this.attuneStones(p); }
    if (this.tick % TICK_RATE === p.id % TICK_RATE) this.progressTick(p);
    if (p.anim === 'die') {
      if (this.tick - p.deadAt > T(3.5)) this.respawnPlayer(p);
      return;
    }
    const cls = CLASSES[p.cls], speed = this.playerSpeed(p), map = this.mapOf(p);
    let moving = false;
    if (p.travel) { if (p.path || p.moveDir || p.target != null || p.dash) this.cancelTravel(p, 'you moved'); else this.updateTravel(p); }
    if (p.mounted && p.zone !== 'world') this.dismount(p, true);

    if (p.dash) {
      const steps = 3;
      for (let i = 0; i < steps; i++) if (!this.moveBy(p, p.dash.vx / steps, p.dash.vy / steps)) { p.dash.ticks = 0; break; }
      p.dir = dirFromVector(p.dash.vx, p.dash.vy);
      if (--p.dash.ticks <= 0) p.dash = null;
      moving = true;
    } else if (p.target != null && !p.channel) {
      const t = this.ents.get(p.target);
      if (!t || t.hp <= 0 || t.zone !== p.zone) { p.target = null; }
      else {
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        const inRange = d <= cls.range && lineClear(map, p.x, p.y, t.x, t.y, 0.08);
        if (!inRange) {
          if (!p.path || this.tick >= (p.repathAt || 0)) { p.path = findPath(map, p.x, p.y, t.x, t.y, 3000); p.repathAt = this.tick + T(0.4); }
          moving = this.followPath(p, speed);
          if (!p.path && !moving) p.target = null;
        } else {
          p.path = null;
          p.dir = dirFromVector(t.x - p.x, t.y - p.y);
          if (this.tick >= p.cdUntil) this.beginSwing(p, cls);
        }
      }
    } else if (p.moveDir) {
      const s = speed / TICK_RATE;
      moving = this.moveBy(p, p.moveDir.x * s, p.moveDir.y * s);
      p.dir = dirFromVector(p.moveDir.x, p.moveDir.y);
    } else if (p.path) {
      moving = this.followPath(p, speed);
    }

    if (p.pending != null) {
      const t = this.ents.get(p.pending);
      const reach = t?.type === 'npc' ? (t.front || NPCS[t.kind].front ? 2.9 : NPCS[t.kind].big ? 3.2 : 2.2) : t?.type === 'loot' ? 1.0 : t?.type === 'node' ? 1.6 : t?.type === 'station' ? 2.4 : t?.type === 'crop' ? 1.5 : 1.7;
      if (!t || t.zone !== p.zone || t.hidden) p.pending = null;
      else if (Math.hypot(t.x - p.x, t.y - p.y) < reach) {
        p.pending = null; p.path = null; moving = false;
        if (t.type === 'npc') { p.dir = dirFromVector(t.x - p.x, t.y - p.y); if (t.anim !== 'sit' && !NPCS[t.kind].big) t.dir = dirFromVector(p.x - t.x, p.y - t.y); t.facingUntil = this.tick + T(t.anim === 'sit' ? 0 : 8); this.talk(p, t); }
        else if (t.type === 'loot') this.pickup(p, t);
        else if (t.type === 'chest') this.openChest(p, t);
        else if (t.type === 'portal') this.usePortal(p, t);
        else if (t.type === 'node') { this.dismount(p, true); this.startGather(p, t); }
        else if (t.type === 'crop') { this.dismount(p, true); this.farmInteract(p, t); }
        else if (t.type === 'station' && t.poi) this.poiUse(p, t);
        else if (t.type === 'station' && t.kind === 'waystone') { p.dir = dirFromVector(t.x - p.x, t.y - p.y); this.stoneMenu(p, t); }
        else if (t.type === 'station') { this.dismount(p, true); p.dir = dirFromVector(t.x - p.x, t.y - p.y); this.send(p.clientId, { t: S2C.CRAFT, npc: t.id, name: t.name, at: NPCS[t.kind].station || 'cook' }); }
        if (p.zone !== t.zone) return;   // went through a portal
      } else if (!p.path) p.pending = null;
    }

    // auto-attack option "attack enemies that come close"
    if (p.auto === 2 && !p.mounted && p.target == null && p.pending == null && !p.path && !p.moveDir && !p.dash && !p.channel && this.tick % 4 === 0) {
      let best = null, bd = Infinity;
      for (const m of this.mobsNear(p.x, p.y, 4, p.zone)) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (m.hp > 0 && d < bd && lineClear(map, p.x, p.y, m.x, m.y, 0.08)) { bd = d; best = m; }
      }
      if (best) { p.target = best.id; p.repathAt = 0; }
    }

    if (p.swingAt && this.tick >= p.swingAt) {
      p.swingAt = 0;
      const t = this.ents.get(p.target);
      if (t && t.hp > 0) {
        if (cls.projectile) this.shoot(p, cls.projectile, t.x, t.y, 1, t.id);
        else if (Math.hypot(t.x - p.x, t.y - p.y) <= cls.range + 0.6) this.hit(p, t, 1);
      }
    }

    if (p.channel) {
      if (this.tick >= p.channel.until) p.channel = null;
      else if (this.tick >= p.channel.next) {
        p.channel.next = this.tick + T(0.3);
        for (const m of this.mobsNear(p.x, p.y, 1.9, p.zone)) this.hit(p, m, p.channel.mult);
        this.evAt(p, { e: 'sfx', s: 'whoosh', x: p.x, y: p.y });
      }
    }

    // walked to the shore to cast; fishing; gathering
    if (p.castAt && !p.path && !p.moveDir) { const c = p.castAt; p.castAt = null; if (Math.hypot(c.x - p.x, c.y - p.y) <= 6) this.cast(p, c.x, c.y); }
    if (p.fish) this.updateFishing(p, moving);
    if (p.gather) this.updateGather(p, moving);
    if (p.farmGo && !p.path && !p.moveDir) this.arriveFarm(p);
    if (p.farm) this.updateFarmWork(p, moving);
    const work = !moving && this.workAnim(p);

    if (p.channel) this.setAnim(p, 'spin');
    else if (p.travel) this.setAnim(p, 'cast');
    else if (this.tick >= p.animLock) this.setAnim(p, moving ? 'walk' : work || 'idle');
    // a good meal keeps you healing, even in a fight
    if (this.tick % TICK_RATE === 7 && p.hp < p.maxHp) { const rg = this.buffFx(p).regen + (p.mods?.regen || 0); if (rg) { p.hp = Math.min(p.maxHp, p.hp + rg); p.selfDirty = true; } }

    if (p.maxMp && p.mp < p.maxMp && this.tick % TICK_RATE === 3) {
      const calm = this.tick - (p.lastHurt || 0) > T(5);
      p.mp = Math.min(p.maxMp, p.mp + Math.max(1, Math.round(p.maxMp * (calm ? 0.05 : 0.02)))); p.selfDirty = true;
    }
    if (this.tick - p.lastHurt > T(6) && p.hp < p.maxHp && this.tick % TICK_RATE === 0) {
      p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.02))); p.selfDirty = true;
    }
    for (const [k, b] of Object.entries(p.buffs)) if (b.until <= this.tick) { delete p.buffs[k]; p.selfDirty = true; }
    if (this.tick % 4 === 0) for (const e of this.ents.values()) {
      if (e.type !== 'loot' || e.zone !== p.zone) continue;
      const r = e.kind === 'gold' ? 1.4 : 0.6;
      if (Math.abs(e.x - p.x) < r && Math.abs(e.y - p.y) < r) this.pickup(p, e);
    }
  }

  respawnPlayer(p) {
    this.stopWork(p);
    p.hp = p.maxHp; p.mp = p.maxMp; p.channel = null; p.dash = null; p.slowUntil = 0;
    this.setAnim(p, 'idle'); p.animLock = 0; p.selfDirty = true;
    // during a raid you come round in the chapel, out of the fighting
    // on the starting island you come round at the survivors' camp
    const isle = this.zones.get(p.zone);
    if (isle?.kind === 'starter') {
      const c = isle.map.starter.areas.camp;
      p.x = c.x; p.y = c.y + 2; p.path = null; p.target = null; p.moveDir = null;
      // the first fall on the island: Mira is there when you come round, with a word of advice
      if (!p.isleDowned) { p.isleDowned = true; return this.later(0.8, () => this.isleFirstFall(p)); }
      return this.privateEvent(p, { e: 'sys', text: 'You come round by the campfire. Captain Harlan\'s men dragged you back to camp.' });
    }
    const raid = this.town.raid && p.zone === 'world';
    const s = raid ? { x: 116.5, y: 106.5 } : this.map.playerSpawn;
    if (p.zone !== 'world') this.movePlayer(p, 'world', s.x, s.y);
    else { p.x = s.x; p.y = s.y; p.path = null; p.target = null; p.moveDir = null; }
    this.privateEvent(p, { e: 'sys', text: raid ? 'Sister Wren dragged you into the chapel. Catch your breath.' : 'You wake up in the village square.' });
  }

  // ---------------------------------------------------------------- combat
  beginSwing(e, stats) {
    this.playAnim(e, 'attack', stats.cooldown * 0.9);
    e.swingAt = this.tick + T(stats.windup);
    // a monster's ranged attack shows a cast bar
    if (e.type === 'mob' && stats.ranged) e.cast = { name: CAST_NAMES[stats.ranged] || 'Casting', start: this.tick, end: e.swingAt };
    // attack speed: Eagle Eye halves the wait; gear, the path's passive and Rampage shorten it
    let fast = e.type === 'player' && e.buffs?.eagleeye?.until > this.tick ? 0.5 : 1;
    if (e.type === 'player') fast /= 1 + (e.mods?.haste || 0) + (e.buffs?.rampage?.until > this.tick ? e.buffs.rampage.haste : 0);
    e.cdUntil = this.tick + T(stats.cooldown * (e.enraged ? 0.7 : 1) * fast);
  }

  mobsNear(x, y, r, zone) {
    const out = [];
    for (const e of this.ents.values()) if (e.type === 'mob' && e.zone === zone && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= r) out.push(e);
    return out;
  }
  playersNear(x, y, r, zone) {
    const out = [];
    for (const e of this.ents.values()) if (e.type === 'player' && e.zone === zone && e.hp > 0 && !e.vanish && Math.hypot(e.x - x, e.y - y) <= r) out.push(e);
    return out;
  }

  hit(src, t, mult, critChance = 0.12) {
    this.applyDamage(t, this.atkOf(src) * mult, src, src.type === 'player' ? critChance : 0);
  }

  // critChance: the attack's own chance (players add their gear and path bonus); 1 = always
  applyDamage(t, raw, src, critChance = 0) {
    if (!t || t.hp <= 0) return;
    if (t.sceneSafe > this.tick) return;                 // watching a region's entry scene: not to be attacked
    let dmg = raw * (0.85 + this.rng() * 0.3) - this.defOf(t) * 0.6;
    // level gap: hitting something above your level does much less, and it hits you much harder
    const lvOf = (e) => e?.type === 'mob' ? (e.rareLv || MOBS[e.kind]?.lv || 1) : (e?.lv || e?.level || 1);
    if (src?.type === 'player' && t.type === 'mob') { const gap = lvOf(t) - lvOf(src); dmg *= 0.6 * (gap > 0 ? Math.max(0.2, 1 - gap * 0.15) : 1); }
    else if (src?.type === 'mob' && t.type === 'player') { const gap = lvOf(src) - lvOf(t); if (gap > 0) dmg *= Math.min(2.2, 1 + gap * 0.15); }
    const pm = src?.type === 'player' ? src.mods : null;
    if (pm && critChance > 0) critChance += pm.crit;
    const crit = this.rng() < critChance;
    if (crit) dmg *= 1.75 + (pm?.critDmg || 0);
    if (src?.type === 'player') {
      if (t.markUntil > this.tick) dmg *= t.markMul || 1;                                      // Hunter's Mark
      if (pm?.slowBonus && (t.slowUntil > this.tick || t.stunUntil > this.tick)) dmg *= 1 + pm.slowBonus;
      if (src.buffs?.rampage?.until > this.tick) dmg *= 1 + src.buffs.rampage.dmg;
    }
    this.damage(t, Math.max(1, Math.round(dmg)), src, crit);
  }

  // dot: damage over time (burning) - it doesn't set off lifesteal or more burning
  damage(t, amount, src, crit, dot = false) {
    if (t.type === 'player' && t.god) { this.evAt(t, { e: 'dmg', id: t.id, v: 0, c: 0, p: 1, ab: 1 }); return; }   // admin god mode
    if (t.type === 'player') {
      const now = this.tick, b = t.buffs;
      if (!dot && b.shieldwall?.until > now) amount = Math.max(1, Math.round(amount * (1 - b.shieldwall.cut)));
      if (!dot && t.mods?.block && this.rng() < t.mods.block) { amount = Math.max(1, Math.round(amount / 2)); this.evAt(t, { e: 'fx', k: 'block', x: round2(t.x), y: round2(t.y) }); }
      // wards and ice barriers soak up damage first
      for (const k of ['barrier', 'ward']) {
        const w = b[k];
        if (!w || w.until <= now || amount <= 0) continue;
        const soak = Math.min(w.amount, amount);
        w.amount -= soak; amount -= soak;
        if (k === 'barrier' && src?.type === 'mob') src.slowUntil = Math.max(src.slowUntil || 0, now + T(2));
        if (w.amount <= 0) { delete b[k]; this.evAt(t, { e: 'fx', k: 'wardbreak', x: round2(t.x), y: round2(t.y) }); }
        t.selfDirty = true;
      }
      if (amount <= 0) { this.evAt(t, { e: 'dmg', id: t.id, v: 0, c: 0, p: 1, ab: 1 }); return; }
    }
    t.hp = Math.max(0, t.hp - amount);
    this.evAt(t, { e: 'dmg', id: t.id, v: amount, c: crit ? 1 : 0, p: t.type === 'player' ? 1 : 0, ...(dot ? { dot: 1 } : {}) });
    if (src?.type === 'player' && t.type === 'mob' && !dot && src.mods) {
      if (src.mods.lifesteal && src.hp > 0 && src.hp < src.maxHp) { const v = Math.min(src.maxHp - src.hp, Math.max(1, Math.round(amount * src.mods.lifesteal))); src.hp += v; src.selfDirty = true; }
      if (src.mods.burn && t.hp > 0) this.ignite(t, src, src.mods.burn, amount);
    }
    if (t.type === 'player') {
      t.lastHurt = this.tick; t.selfDirty = true;
      if (t.hp <= 0) this.killPlayer(t);
      else if (src && src.type === 'mob' && !t.mounted && (t.auto ?? 1) >= 1 && t.target == null && !t.path && !t.moveDir && t.pending == null && !t.channel) t.target = src.id;
    } else if (t.type === 'mob') {
      if (src?.type === 'player') { t.damagers.set(src.id, (t.damagers.get(src.id) || 0) + amount); if (!t.target) { t.target = src.id; t.state = 'chase'; } }
      if (t.hp <= 0) this.killMob(t);
    }
  }

  // how many monsters are chasing each player, counted once per tick (cheap even with hundreds of players)
  // the two monsters allowed to fight this hero right now: bosses first, then the closest
  mayAttack(m, t) {
    if (this.slotTick !== this.tick) {
      // one pass a tick: every hero's chasers, ranked
      this.slotTick = this.tick; const by = new Map();
      for (const e of this.ents.values()) {
        if (e.type !== 'mob' || e.target == null || e.hp <= 0 || e.anim === 'die') continue;
        const h = this.ents.get(e.target); if (!h || h.zone !== e.zone) continue;
        const r = (MOBS[e.kind].boss ? -1000 : 0) + Math.hypot(e.x - h.x, e.y - h.y) - (e.swingAt ? 50 : 0);
        let L = by.get(e.target); if (!L) by.set(e.target, L = []); L.push([e.id, r]);
      }
      this.slots = new Map();
      for (const [id, L] of by) { L.sort((a, b) => a[1] - b[1]); this.slots.set(id, new Set(L.slice(0, 2).map((x) => x[0]))); }
    }
    return this.slots.get(t.id)?.has(m.id) ?? true;
  }

  chasersOf(id) {
    if (this.chaseTick !== this.tick) {
      this.chaseTick = this.tick; const c = this.chaseCount = new Map();
      for (const e of this.ents.values()) if (e.type === 'mob' && e.target != null && e.hp > 0) c.set(e.target, (c.get(e.target) || 0) + 1);
    }
    return this.chaseCount.get(id) || 0;
  }

  shoot(owner, kind, tx, ty, mult, homing = null, extra = {}) {
    // a player's single shots lock onto their target (or the enemy nearest their aim) so they never miss
    if (owner.type === 'player' && homing == null && !extra.pierce) {
      const ax = tx - owner.x, ay = ty - owner.y, ad = Math.hypot(ax, ay) || 1;
      const sel = owner.aimId != null && this.ents.get(owner.aimId);
      if (sel && sel.type === 'mob' && sel.hp > 0 && sel.zone === owner.zone && Math.hypot(sel.x - owner.x, sel.y - owner.y) < 14) homing = sel.id;
      else {
        let best = null, bs = Infinity;
        for (const m of this.mobsNear(owner.x, owner.y, 12, owner.zone)) {
          const mx = m.x - owner.x, my = m.y - owner.y, md = Math.hypot(mx, my) || 1;
          const cos = (mx * ax + my * ay) / (md * ad);
          if (cos < 0.75) continue;                       // within about 40 degrees of the aim
          const score = md * (2 - cos) + Math.hypot(m.x - tx, m.y - ty) * 0.5;
          if (score < bs) { bs = score; best = m; }
        }
        if (best) homing = best.id;
      }
      if (homing != null) { const t = this.ents.get(homing); tx = t.x; ty = t.y; }
    }
    const dx = tx - owner.x, dy = ty - owner.y, d = Math.hypot(dx, dy) || 1;
    return this.newEnt({ type: 'proj', kind, x: owner.x + dx / d * 0.4, y: owner.y + dy / d * 0.4, zone: owner.zone,
      vx: dx / d, vy: dy / d, dir: dirFromVector(dx, dy), owner: owner.id, ownerType: owner.type,
      power: this.atkOf(owner) * mult, homing, travelled: 0, ...extra });
  }

  updateProjectile(pr) {
    const P = PROJECTILES[pr.kind], map = this.mapOf(pr);
    if (pr.homing != null) {
      const t = this.ents.get(pr.homing);
      if (t && t.hp > 0) { const dx = t.x - pr.x, dy = t.y - pr.y, d = Math.hypot(dx, dy) || 1; pr.vx = dx / d; pr.vy = dy / d; pr.dir = dirFromVector(dx, dy); }
    }
    const step = P.speed / TICK_RATE, sub = 3;
    for (let i = 0; i < sub; i++) {
      pr.x += pr.vx * step / sub; pr.y += pr.vy * step / sub; pr.travelled += step / sub;
      if (isBlocked(map, Math.floor(pr.x), Math.floor(pr.y)) && !this.isWater(map, pr.x, pr.y)) return this.endProjectile(pr, null);
      const targets = pr.ownerType === 'mob' ? this.playersNear(pr.x, pr.y, P.radius * (pr.big ? 1.6 : 1), pr.zone) : this.mobsNear(pr.x, pr.y, P.radius * (pr.big ? 1.6 : 1), pr.zone);
      if (pr.pierce) {
        // a piercing shot goes on through everything in its path
        const src = this.ents.get(pr.owner) || { id: pr.owner, type: pr.ownerType, zone: pr.zone };
        for (const t of targets) if (!pr.pierce.has(t.id)) { pr.pierce.add(t.id); this.applyDamage(t, pr.power, src, pr.sureCrit ? 1 : 0.12); this.evAt(t, { e: 'fx', k: 'thunk', x: round2(t.x), y: round2(t.y) }); }
      } else if (targets.length) return this.endProjectile(pr, targets[0]);
      if (pr.travelled >= (pr.range || P.range)) return this.endProjectile(pr, null);
    }
  }

  isWater(map, x, y) { return map.terrain[Math.floor(y) * map.w + Math.floor(x)] === 0; }

  endProjectile(pr, target) {
    this.ents.delete(pr.id);
    const src = this.ents.get(pr.owner) || { id: pr.owner, type: pr.ownerType, zone: pr.zone };
    const P = PROJECTILES[pr.kind];
    if (P.aoe) {
      for (const m of this.mobsNear(pr.x, pr.y, P.aoe, pr.zone)) this.applyDamage(m, pr.power, src, 0.12);
      this.evAt(pr, { e: 'fx', k: 'boom', x: round2(pr.x), y: round2(pr.y), r: P.aoe });
    } else if (target) {
      this.applyDamage(target, pr.power, src, pr.ownerType === 'player' ? (pr.sureCrit ? 1 : 0.12) : 0);
      if (P.slow && target.type === 'player') { target.slowUntil = this.tick + T(P.slow); target.selfDirty = true; }
      this.evAt(pr, { e: 'fx', k: pr.kind === 'bolt' || pr.kind === 'shadowbolt' ? 'spark' : pr.kind === 'web' ? 'webhit' : 'thunk', x: round2(pr.x), y: round2(pr.y) });
    }
  }

  killPlayer(p) {
    this.stopWork(p);
    this.dismount(p, true); p.travel = null;
    this.setAnim(p, 'die'); p.deadAt = this.tick; p.path = null; p.target = null; p.moveDir = null; p.swingAt = 0; p.channel = null; p.dash = null;
    const lost = Math.floor(p.gold * 0.1); p.gold -= lost; p.selfDirty = true;
    this.privateEvent(p, { e: 'sys', text: lost ? `You have fallen and dropped ${lost} gold.` : 'You have fallen.' });
    for (const e of this.ents.values()) if (e.type === 'mob' && e.target === p.id) { e.target = null; e.state = e.raid ? 'march' : 'return'; }
  }

  killMob(m) {
    const def = MOBS[m.kind];
    this.setAnim(m, 'die'); m.deadAt = this.tick; m.target = null; m.path = null; m.swingAt = 0;
    // everyone who hurt it, and their party members close by, get the experience and the quest credit
    const credited = new Map();
    for (const [pid] of m.damagers) {
      const p = this.ents.get(pid);
      if (!p || p.type !== 'player') continue;
      for (const q of this.partyNear(p, m.x, m.y, m.zone)) credited.set(q.id, q);
    }
    for (const p of credited.values()) {
      this.privateEvent(p, { e: 'kill', id: m.id, k: m.kind, x: round2(m.x), y: round2(m.y), boss: def.boss || m.rare ? 1 : 0 });
      this.killXp(p, Math.max(1, Math.round((m.summoned ? def.xp * 0.4 : def.xp) * xpScale(m.rareLv || def.lv, p.lv || p.level || 1))));
      this.onKill(p, m);
      this.tutorialKill(p, m);
      if (def.boss && !p.bosses.includes(m.kind)) p.bosses.push(m.kind);
      for (const q of QUEST_ORDER) {
        const st = p.quests[q], Q = QUESTS[q];
        if (st?.state === 'active' && Q.kind === 'kill' && Q.target === m.kind && st.count < Q.count) {
          st.count++; p.selfDirty = true;
          this.privateEvent(p, { e: 'sys', text: `${Q.title}: ${st.count}/${Q.count}` });
        }
      }
    }
    if (m.raid && this.town.raid) for (const [pid] of m.damagers) this.town.raid.heroes.add(pid);
    const ownerId = [...m.damagers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const owner = this.ents.get(ownerId);
    m.damagers.clear();
    if (m.rare) this.rareKilled(m, [...credited.values()]);
    if (m.boss && m.zone !== 'world') this.bossDefeated(m);
    if (m.summoned) return;
    const [g0, g1] = def.gold;
    this.dropLoot('gold', g0 + Math.floor(this.rng() * (g1 - g0 + 1)), m.x, m.y, m.zone, ownerId);
    for (const [item, chance] of def.loot) if (this.rng() < chance) this.dropLoot(item, 1, m.x, m.y, m.zone, ownerId);
    for (const [item, chance, quest] of QUEST_DROPS[m.kind] || [])
      if (owner?.quests[quest]?.state === 'active' && this.countItem(owner, item) < (QUESTS[quest].count || 1) && this.rng() < chance) this.dropLoot(item, 1, m.x, m.y, m.zone, ownerId);
    const [gearChance, tiers] = def.gear;
    if (this.rng() < gearChance) {
      const classes = Object.keys(CLASSES);
      const cls = owner?.cls && (def.boss || this.rng() < 0.75) ? owner.cls : classes[Math.floor(this.rng() * classes.length)];
      const slot = this.dropSlot();
      const tier = Math.min(4, tiers[Math.floor(this.rng() * tiers.length)]);
      this.dropLoot(gearFor(cls, slot, tier), 1, m.x, m.y, m.zone, ownerId, this.rollRarity(def.rarity));
    }
    if (m.zone !== 'world' && this.rng() < (def.boss ? 0.5 : 0.03)) this.dropLoot(DYE_ITEMS[Math.floor(this.rng() * DYE_ITEMS.length)], 1, m.x, m.y, m.zone, ownerId);
  }

  bossDefeated(m) {
    const z = this.zones.get(m.zone);
    if (!z || z.kind !== 'dungeon' || z.bossDead) return;
    z.bossDead = true;
    for (const e of this.ents.values()) if (e.zone === z.id && (e.type === 'mob' && e.summoned)) { e.hp = 0; this.setAnim(e, 'die'); e.deadAt = this.tick; }
    const stairs = [...this.ents.values()].find((e) => e.zone === z.id && e.type === 'portal' && e.kind === 'stairs');
    if (stairs) { stairs.locked = false; this.zoneEvent(z.id, { e: 'sys', text: 'A rumble... the way down is open.' }); }
    if (z.floor === FLOORS.length - 1) {
      const s = z.map.dungeon.stairs;
      this.newEnt({ type: 'portal', kind: 'town', x: s.x, y: s.y, zone: z.id, name: 'Portal to Hollowmere' });
      this.newEnt({ type: 'chest', kind: 'chest_big', x: m.x, y: m.y + 1.5, zone: z.id, dir: 1 });
      this.zoneEvent(z.id, { e: 'sys', text: 'The Hollow King crumbles to dust. A portal shimmers open.' });
    }
    this.zoneEvent(z.id, { e: 'boss', name: MOBS[m.kind].name });
  }

  // which gear slot a random drop is for
  dropSlot() {
    let roll = this.rng() * DROP_SLOTS.reduce((a, d) => a + d[1], 0);
    for (const [k, w] of DROP_SLOTS) if ((roll -= w) < 0) return k;
    return 'weapon';
  }

  // Fine pieces roll one bonus stat, Masterwork two (each a little stronger)
  rollBonus(item, r) {
    const d = ITEMS[item];
    if (!r || !d || d.stack || !GEAR_SLOTS.includes(d.type)) return null;
    const keys = [...GEAR_BONUS_KEYS], b = {};
    for (let n = 0; n < (r >= 3 ? 3 : r >= 2 ? 2 : 1); n++) {
      const k = keys.splice(Math.floor(this.rng() * keys.length), 1)[0];
      const v = GEAR_BONUS[k].per(Math.min(6, d.tier || 1)) * (r >= 3 ? 1.5 : r >= 2 ? 1.3 : 1) * (0.85 + this.rng() * 0.3);
      b[k] = k === 'hpFlat' ? Math.round(v) : Math.round(v * 1000) / 1000;
    }
    return b;
  }
  okBonus(b) {
    if (!b || typeof b !== 'object') return null;
    const out = {};
    for (const k of GEAR_BONUS_KEYS) if (typeof b[k] === 'number' && b[k] > 0 && b[k] <= GEAR_BONUS[k].per(6) * 1.6) out[k] = b[k];
    return Object.keys(out).length ? out : null;
  }

  rollRarity(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < weights.length; i++) { if ((r -= weights[i]) < 0) return i; }
    return 0;
  }

  dropLoot(kind, qty, x, y, zone, owner, r = 0, b) {
    if (b === undefined && kind !== 'gold') b = this.rollBonus(kind, r);
    const map = this.zones.get(zone)?.map || this.map;
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * Math.PI * 2, rr = 0.3 + this.rng() * 0.7;
      const lx = x + Math.cos(a) * rr, ly = y + Math.sin(a) * rr;
      if (!isBlocked(map, Math.floor(lx), Math.floor(ly))) { x = lx; y = ly; break; }
    }
    const l = this.newEnt({ type: 'loot', kind, qty, r, b, x, y, zone, owner, ownerUntil: this.tick + T(20), expires: this.tick + T(120) });
    // auto-loot: what drops for you goes straight into your pack (or stays on the ground if it's full)
    const o = owner != null && this.ents.get(owner);
    if (o && o.type === 'player' && o.autoLoot !== false && o.zone === zone && o.anim !== 'die' && Math.hypot(o.x - x, o.y - y) < 16) this.pickup(o, l, true);
  }

  // "Loot all": everything you may take within reach
  lootAll(p) {
    if (p.anim === 'die') return;
    let n = 0, left = 0;
    for (const e of [...this.ents.values()]) {
      if (e.type !== 'loot' || e.zone !== p.zone || Math.hypot(e.x - p.x, e.y - p.y) > 6) continue;
      if (e.owner && e.owner !== p.id && this.tick < e.ownerUntil && this.ents.has(e.owner)) continue;
      if (this.pickup(p, e, true)) n++; else left++;
    }
    if (!n && !left) this.privateEvent(p, { e: 'sys', text: 'There is nothing here to pick up.' });
    else if (left) this.privateEvent(p, { e: 'sys', text: `Your pack is full: ${left} thing${left > 1 ? 's' : ''} left on the ground.` });
  }

  // tidy a bag: stacks topped up, then like with like (potions, food, gear best first, tools, seeds, materials, quest items)
  sortBag(p, where) {
    const bag = where === 'bank' ? p.bank?.items : p.inv;
    if (!bag) return;
    const ORDER = ['hearth', 'mount', 'consumable', 'elixir', 'meal', 'weapon', 'armor', 'helm', 'gloves', 'boots', 'ring', 'amulet', 'dye', 'tool', 'bait', 'seed', 'fertilizer', 'crop', 'food', 'fish', 'material', 'recipe', 'quest'];
    const rank = (it) => { const t = ITEMS[it.item].type, i = ORDER.indexOf(t); return i < 0 ? ORDER.length : i; };
    // merge partial stacks
    const items = bag.filter(Boolean).map((it) => ({ ...it }));
    const merged = [];
    for (const it of items) {
      const d = ITEMS[it.item];
      if (d.stack > 1) {
        for (const m of merged) if (m.item === it.item && (m.r || 0) === (it.r || 0) && m.qty < d.stack && it.qty > 0) { const add = Math.min(it.qty, d.stack - m.qty); m.qty += add; it.qty -= add; }
        if (it.qty > 0) merged.push(it);
      } else merged.push(it);
    }
    merged.sort((a, b) => rank(a) - rank(b)
      || (ITEMS[b.item].tier || 0) - (ITEMS[a.item].tier || 0)
      || (b.r || 0) - (a.r || 0)
      || ITEMS[a.item].name.localeCompare(ITEMS[b.item].name)
      || b.qty - a.qty);
    for (let i = 0; i < bag.length; i++) bag[i] = merged[i] || null;
    p.selfDirty = true;
    this.privateEvent(p, { e: 'sfx', s: 'click' });
  }

  grantXp(p, xp) {
    xp = Math.round(xp * (1 + this.buffFx(p).xp + (p.mods?.xp || 0)));
    p.xp += xp; p.selfDirty = true;
    this.privateEvent(p, { e: 'xp', v: xp });
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level); p.level++;
      this.recalcStats(p); p.hp = p.maxHp;
      this.evAt(p, { e: 'lvl', id: p.id, lv: p.level });
      this.privateEvent(p, { e: 'sys', text: `Level up! You are now level ${p.level}. You have a skill point to spend (K).` });
      if (p.level === 10 || p.level === 20) {
        const tr = Object.keys(NPCS).find((k) => NPCS[k].trainer === p.cls);
        this.broadcastEvent({ e: 'town', k: 'milestone', text: `${p.name} has reached level ${p.level}!` });
        this.privateEvent(p, { e: 'milestone', lv: p.level, text: `Level ${p.level}! A milestone. ${NPCS[tr].name} in town has a trial for you: pass it to earn a new skill and the level ${p.level} armour set.` });
      }
    }
  }

  // ---------------------------------------------------------------- dungeon things
  openChest(p, c) {
    if (!c.opened) this.bumpStat(p, 'chests');
    if (c.opened) return;
    c.opened = true; this.setAnim(c, 'open');
    if (c.raid) { this.evAt(c, { e: 'fx', k: 'chest', x: c.x, y: c.y }); return this.openRaidChest(p, c); }
    if (c.isleReward) { this.evAt(c, { e: 'fx', k: 'chest', x: c.x, y: c.y }); return this.openIsleChest(p, c); }
    const z = this.zones.get(c.zone), floor = z?.floor ?? 0, big = c.kind === 'chest_big';
    this.evAt(c, { e: 'fx', k: 'chest', x: c.x, y: c.y });
    this.dropLoot('gold', Math.round((30 + floor * 25) * (big ? 4 : 1) * (0.7 + this.rng() * 0.6)), c.x, c.y + 0.6, c.zone, p.id);
    const mats = ['deep_iron', 'silk', 'bone'][floor];
    this.dropLoot(this.rng() < 0.5 ? 'potion' : mats, 1 + Math.floor(this.rng() * 2), c.x, c.y + 0.6, c.zone, p.id);
    if (big || this.rng() < 0.4) {
      const tier = big ? 4 : Math.min(3, 2 + floor);
      this.dropLoot(gearFor(p.cls, this.dropSlot(), tier), 1, c.x, c.y + 0.6, c.zone, p.id, this.rollRarity(big ? [10, 50, 40] : [50, 35, 15]));
    }
    if (big || this.rng() < 0.12) this.dropLoot(DYE_ITEMS[Math.floor(this.rng() * DYE_ITEMS.length)], 1, c.x, c.y + 0.6, c.zone, p.id);
  }

  updateTrap(t) {
    const period = T(2.4), up = T(0.7);
    const ph = (this.tick + t.phase) % period;
    const isUp = ph < up;
    if (isUp && ph === 0) {
      this.setAnim(t, 'up');
      const floor = this.zones.get(t.zone)?.floor ?? 0;
      for (const p of this.playersNear(t.x, t.y, 0.65, t.zone)) this.damage(p, 10 + floor * 9, null, false);
      this.evAt(t, { e: 'sfx', s: 'spikes', x: t.x, y: t.y });
    } else if (!isUp) this.setAnim(t, 'idle');
  }

  usePortal(p, g) {
    if (g.kind === 'cave') {
      if (!p.quests.deep1) return this.privateEvent(p, { e: 'sys', text: 'Rubble and goblin barricades block the tunnel. Sister Wren at the shrine may know more.' });
      return this.enterDungeon(p, 0);
    }
    if (g.kind === 'exit') return this.leaveToWorld(p, 'cave');
    if (g.kind === 'town') return this.leaveToWorld(p, 'town');
    if (g.kind === 'ferry') return this.isleBoard(p);
    if (g.kind === 'stairs') {
      if (g.locked) return this.privateEvent(p, { e: 'sys', text: 'The stairs are sealed. Something powerful on this floor holds the way shut.' });
      const z = this.zones.get(g.zone);
      return this.enterDungeon(p, z.floor + 1);
    }
  }

  // ---------------------------------------------------------------- pets
  petOf(p) { return p.petId != null ? this.ents.get(p.petId) : null; }
  summonPet(p) {
    if (!p.pet || this.petOf(p)) return;
    const pet = this.newEnt({ type: 'pet', kind: p.pet, x: p.x - 0.7, y: p.y - 0.7, zone: p.zone, owner: p.id, dir: p.dir });
    p.petId = pet.id;
  }
  dismissPet(p) { if (p.petId != null) { this.ents.delete(p.petId); p.petId = null; } }

  updatePet(pet) {
    const o = this.ents.get(pet.owner);
    if (!o) { this.ents.delete(pet.id); return; }
    if (pet.zone !== o.zone) { pet.zone = o.zone; pet.x = o.x - 0.6; pet.y = o.y - 0.6; }
    let tx, ty, speed = this.playerSpeed(o) * 1.25;   // keeps up with a horse too
    // fetch gold near its owner
    if (!pet.fetch || !this.ents.has(pet.fetch)) {
      pet.fetch = null;
      if (this.tick % 10 === pet.id % 10) for (const e of this.ents.values()) {
        if (e.type === 'loot' && e.kind === 'gold' && e.zone === o.zone && Math.hypot(e.x - o.x, e.y - o.y) < 5 && (!e.owner || e.owner === o.id)) { pet.fetch = e.id; break; }
      }
    }
    if (pet.fetch) {
      const g = this.ents.get(pet.fetch);
      tx = g.x; ty = g.y; speed *= 1.3;
      if (Math.hypot(g.x - pet.x, g.y - pet.y) < 0.5) { this.pickup(o, g); pet.fetch = null; }
    } else {
      const a = (o.dir * Math.PI / 4) + Math.PI;   // trail behind the owner
      tx = o.x + Math.cos(a) * 1.1 + Math.cos(a + 1.6) * 0.5; ty = o.y + Math.sin(a) * 1.1 + Math.sin(a + 1.6) * 0.5;
    }
    const dx = tx - pet.x, dy = ty - pet.y, d = Math.hypot(dx, dy);
    if (d > 9) { pet.x = o.x; pet.y = o.y; return; }
    if (d > 0.25) {
      const s = Math.min(d, speed / TICK_RATE * (d > 3 ? 1.5 : 1));
      if (!this.moveBy(pet, dx / d * s, dy / d * s)) { pet.x += dx / d * s; pet.y += dy / d * s; }   // pets can squeeze through
      pet.dir = dirFromVector(dx, dy);
      this.setAnim(pet, 'walk');
    } else this.setAnim(pet, 'idle');
  }

  // ---------------------------------------------------------------- skills
  learn(p, skill) {
    if (!skillList(p.cls, p.spec, CLASSES).includes(skill)) return;
    if (SKILLS[skill].unlock && !p.unlocks.includes(skill)) return this.privateEvent(p, { e: 'sys', text: `${SKILLS[skill].name} is taught by your trainer at level ${SKILLS[skill].unlock}, after a trial.` });
    const r = p.skills[skill] || 0;
    if (r >= MAX_SKILL_RANK || this.skillPoints(p) <= 0) return;
    p.skills[skill] = r + 1; p.selfDirty = true;
    this.privateEvent(p, { e: 'sys', text: `${SKILLS[skill].name} is now rank ${r + 1}.` });
  }

  castSkill(p, slot, tx, ty) {
    if (p.anim === 'die' || p.dash || p.channel) return;
    const name = skillList(p.cls, p.spec, CLASSES)[slot];
    if (!name) return;
    const S = SKILLS[name], r = p.skills[name] || 0;
    if (!r) return this.privateEvent(p, { e: 'sys', text: `You haven't learned ${S.name} yet. Press K to spend skill points.` });
    if ((p.cds[name] || 0) > this.tick) return;
    const cost = skillCost(name);
    if ((p.mp ?? 0) < cost) {
      if (this.tick - (p.noManaAt || -1e9) > T(1)) { p.noManaAt = this.tick; this.privateEvent(p, { e: 'nomana', s: name, need: cost }); }
      return;
    }
    p.mp -= cost;
    let dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { const a = p.dir * Math.PI / 4; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
    const ux = dx / d, uy = dy / d, zone = p.zone;
    if (S.target !== 'self') p.dir = dirFromVector(ux, uy);
    p.path = null; p.target = null; p.moveDir = null; p.pending = null; p.swingAt = 0;
    p.cds[name] = this.tick + T(name === 'dash' ? S.cd - r : S.cd);
    p.selfDirty = true;
    this.evAt(p, { e: 'cast', id: p.id, s: name });
    const alive = () => p.anim !== 'die' && p.zone === zone && this.ents.has(p.id);
    if (this.castMilestone(p, name, r, ux, uy, d, tx, ty, alive)) return;
    if (this.castSpec(p, name, r, ux, uy, d, alive)) return;

    switch (name) {
      case 'cleave': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (130 + 20 * r) / 100;
        this.later(0.25, () => {
          if (!alive()) return;
          for (const m of this.mobsNear(p.x, p.y, 2.1, zone)) {
            const mx = m.x - p.x, my = m.y - p.y, md = Math.hypot(mx, my) || 1;
            if ((mx * ux + my * uy) / md > 0.35) this.hit(p, m, mult);
          }
          this.evAt(p, { e: 'fx', k: 'cleave', x: round2(p.x), y: round2(p.y), d: p.dir });
        });
        break;
      }
      case 'whirlwind':
        p.channel = { until: this.tick + T(1.2 + 0.3 * r), next: this.tick + T(0.1), mult: (55 + 10 * r) / 100 };
        break;
      case 'battlecry': {
        this.playAnim(p, 'cast', 0.7);
        p.buffs.battlecry = { mul: 1 + (20 + 10 * r) / 100, until: this.tick + T(6 + 2 * r) };
        // the roar carries: party members close by are rallied too (shown on their buff bar, "from" you)
        for (const q of this.partyNear(p, p.x, p.y, p.zone)) if (q !== p && Math.hypot(q.x - p.x, q.y - p.y) <= 8 && q.hp > 0) {
          q.buffs.battlecry = { mul: 1 + (10 + 5 * r) / 100, until: this.tick + T(6 + 2 * r), from: p.name }; q.selfDirty = true;
          this.privateEvent(q, { e: 'sys', text: `${p.name}'s Battle Cry rallies you: attack and defense up.` });
        }
        const heal = Math.round(p.maxHp * (10 + 5 * r) / 100);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        this.evAt(p, { e: 'fx', k: 'roar', x: round2(p.x), y: round2(p.y) });
        this.evAt(p, { e: 'heal', id: p.id, v: heal });
        break;
      }
      case 'multishot': {
        this.playAnim(p, 'attack', 0.7);
        const n = 3 + 2 * r, spread = 0.9, base = Math.atan2(uy, ux), mult = (70 + 10 * r) / 100;
        this.later(0.3, () => {
          if (!alive()) return;
          for (let i = 0; i < n; i++) {
            const a = base - spread / 2 + spread * (i / (n - 1));
            this.shoot(p, 'arrow', p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 5, mult);
          }
        });
        break;
      }
      case 'dash': {
        const dist = Math.min(S.range, d), ticks = Math.max(2, Math.round(dist / 0.9));
        p.dash = { vx: ux * dist / ticks, vy: uy * dist / ticks, ticks };
        this.playAnim(p, 'walk', ticks / TICK_RATE);
        this.evAt(p, { e: 'fx', k: 'dash', x: round2(p.x), y: round2(p.y), d: p.dir });
        break;
      }
      case 'volley': {
        this.playAnim(p, 'cast', 0.7);
        const dist = Math.min(S.range, d), px = p.x + ux * dist, py = p.y + uy * dist, mult = (80 + 15 * r) / 100;
        for (let w = 0; w < 2 + r; w++) this.later(0.6 + w * 0.45, () => {
          if (!alive()) return;
          this.event({ e: 'fx', k: 'rain', x: round2(px), y: round2(py), r: 2 }, px, py, zone);
          for (const m of this.mobsNear(px, py, 2, zone)) this.hit(p, m, mult);
        });
        break;
      }
      case 'fireball': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (150 + 25 * r) / 100;
        this.later(0.3, () => { if (alive()) this.shoot(p, 'fireball', p.x + ux * 5, p.y + uy * 5, mult); });
        break;
      }
      case 'frostnova': {
        this.playAnim(p, 'cast', 0.6);
        const mult = (80 + 15 * r) / 100;
        for (const m of this.mobsNear(p.x, p.y, 3.2, zone)) { this.hit(p, m, mult); m.slowUntil = this.tick + T(2 + r); }
        this.evAt(p, { e: 'fx', k: 'nova', x: round2(p.x), y: round2(p.y), r: 3.2 });
        break;
      }
      case 'heal': {
        this.playAnim(p, 'cast', 0.7);
        for (const e of this.playersNear(p.x, p.y, 5, zone)) {
          const v = Math.min(e.maxHp - e.hp, Math.round(e.maxHp * (25 + 10 * r) / 100));
          e.hp += v; e.selfDirty = true;
          this.evAt(e, { e: 'heal', id: e.id, v });
          this.evAt(e, { e: 'fx', k: 'heal', x: round2(e.x), y: round2(e.y) });
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- mobs
  updateMob(m) {
    const def = MOBS[m.kind], map = this.mapOf(m);
    if (m.burn || m.markUntil) this.updateMobEffects(m);
    if (m.anim === 'die') {
      if (m.zone !== 'world' || m.summoned || m.raid || m.rare || m.tutFor) { if (this.tick - m.deadAt > T(4)) this.ents.delete(m.id); return; }
      if (this.tick - m.deadAt > T(def.boss ? Math.max(def.respawn || 0, 600) : m.zone === "world" ? Math.max(30, Math.min(240, 240 * (this.kindCount?.[m.kind] || 20) / 20)) + (m.id % 7) * 5 : Math.max(def.respawn || 0, 120))) {
        m.x = m.spawn.x; m.y = m.spawn.y; m.hp = m.maxHp; m.state = 'idle'; m.slowUntil = 0;
        this.setAnim(m, 'idle'); m.wanderAt = this.tick + T(2);
      }
      return;
    }
    if (m.stunUntil > this.tick) { m.swingAt = 0; if (this.tick >= (m.animLock || 0)) this.setAnim(m, 'idle'); return; }
    let moving = false;
    const speed = def.speed * (m.slowUntil > this.tick ? 0.5 : 1) * (m.enraged ? 1.35 : 1);
    const leashD = Math.hypot(m.x - m.spawn.x, m.y - m.spawn.y);

    if (!m.target && m.state !== 'return' && this.tick % 5 === m.id % 5) {
      // a smaller sight range than before, and a monster won't pile onto someone who already has
      // two or more on them (unless it's a boss) - so fights stay at one or two at a time
      const sight = def.boss ? def.aggro : Math.min(def.aggro * 0.65, 5.5);
      let best = null, bd = sight;
      for (const e of this.playersNear(m.x, m.y, sight, m.zone)) {
        const d = Math.hypot(e.x - m.x, e.y - m.y);
        if (e.sceneSafe > this.tick) continue;
        if (!def.boss && this.chasersOf(e.id, m.zone) >= 2) continue;
        if (d < bd && lineClear(map, m.x, m.y, e.x, e.y, 0.1)) { bd = d; best = e; }
      }
      if (best) { m.target = best.id; m.state = 'chase'; m.path = null; if (def.boss) { if (m.zone === 'world') this.evAt(m, { e: 'bossstart', id: m.id }); else this.zoneEvent(m.zone, { e: 'bossstart', id: m.id }); } }
    }

    if (m.target) {
      const t = this.ents.get(m.target);
      if (!t || t.hp <= 0 || t.zone !== m.zone || leashD > def.leash) { m.target = null; m.state = m.raid ? 'march' : 'return'; m.path = null; }
      else {
        if (def.mech) this.bossMechanics(m, t, def);
        const d = Math.hypot(t.x - m.x, t.y - m.y);
        // only two monsters fight one hero at a time: any more wait their turn a few steps back
        const wait = t.type === 'player' && !def.boss && !this.mayAttack(m, t);
        const inRange = !wait && d <= def.range && lineClear(map, m.x, m.y, t.x, t.y, 0.08);
        if (wait && d < 3.2) { m.path = null; m.swingAt = 0; m.dir = dirFromVector(t.x - m.x, t.y - m.y); }
        else if (!inRange) {
          if (lineClear(map, m.x, m.y, t.x, t.y, BODY)) {
            m.path = null;
            const s = speed / TICK_RATE;
            moving = this.moveBy(m, (t.x - m.x) / d * s, (t.y - m.y) / d * s);
            m.dir = dirFromVector(t.x - m.x, t.y - m.y);
          } else {
            if (!m.path || this.tick >= (m.repathAt || 0)) { m.path = findPath(map, m.x, m.y, t.x, t.y, 900); m.repathAt = this.tick + T(0.75); }
            moving = this.followPath(m, speed);
          }
        } else {
          m.dir = dirFromVector(t.x - m.x, t.y - m.y);
          if (this.tick >= m.cdUntil && this.tick >= (m.animLock || 0)) this.beginSwing(m, def);
        }
      }
    } else if (m.state === 'march') {
      // raiders: straight for the square, fighting anyone in the way
      if (!m.path || this.tick >= (m.repathAt || 0)) { m.path = findPath(map, m.x, m.y, m.spawn.x, m.spawn.y, 4000); m.repathAt = this.tick + T(4); }
      moving = this.followPath(m, speed * 0.85);
      if (leashD < 1.5) { m.state = 'idle'; m.path = null; }
    } else if (m.state === 'return') {
      if (!m.path) m.path = findPath(map, m.x, m.y, m.spawn.x, m.spawn.y, 1500);
      moving = this.followPath(m, speed * 1.4);
      if (m.hp < m.maxHp && this.tick % 4 === 0) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.05));
      if (!moving || leashD < 0.5) { m.state = 'idle'; m.path = null; m.hp = m.maxHp; m.damagers.clear(); }
    } else {
      if (this.tick >= m.wanderAt) {
        m.wanderAt = this.tick + T(3 + this.rng() * 5);
        const a = this.rng() * Math.PI * 2, r = 1 + this.rng() * (def.boss ? 1 : 3);
        const tx = m.spawn.x + Math.cos(a) * r, ty = m.spawn.y + Math.sin(a) * r;
        if (lineClear(map, m.x, m.y, tx, ty, BODY)) m.path = [{ x: tx, y: ty }];
      }
      moving = this.followPath(m, speed * 0.45);
    }

    if (m.swingAt && this.tick >= m.swingAt) {
      m.swingAt = 0;
      const t = this.ents.get(m.target);
      if (t && t.hp > 0 && t.zone === m.zone) {
        if (def.ranged) this.shoot(m, def.ranged, t.x, t.y, 1, def.ranged === 'shadowbolt' ? t.id : null);
        else if (Math.hypot(t.x - m.x, t.y - m.y) <= def.range + 0.7) this.hit(m, t, 1);
      }
    }
    if (this.tick >= (m.animLock || 0)) this.setAnim(m, moving ? 'walk' : 'idle');
  }

  summon(boss, kind, n) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      let x = boss.x + Math.cos(a) * 1.8, y = boss.y + Math.sin(a) * 1.8;
      if (isBlocked(this.mapOf(boss), Math.floor(x), Math.floor(y))) { x = boss.x; y = boss.y; }
      const m = this.spawnMob(kind, x, y, boss.zone, { summoned: true });
      m.target = boss.target; m.state = 'chase';
      this.evAt(m, { e: 'fx', k: 'summon', x: round2(x), y: round2(y) });
    }
  }

  bossMechanics(m, t, def) {
    const at = m.mechAt, now = this.tick;
    const ready = (k, sec) => { if ((at[k] ?? now + T(3)) <= now) { at[k] = now + T(sec); return true; } if (at[k] == null) at[k] = now + T(3); return false; };
    if (this.bossFight(m, t, def, ready)) return;           // world_bosses.js
    if (def.mech === 'foreman') {
      if (!m.enraged && m.hp < m.maxHp * 0.5) {
        m.enraged = true;
        this.zoneEvent(m.zone, { e: 'sys', text: 'Skarg bellows: "MINERS! TO ME!"' });
        this.evAt(m, { e: 'fx', k: 'roar', x: m.x, y: m.y });
        this.summon(m, 'goblin_miner', 3);
      }
      if (ready('slam', 8)) {
        this.playAnim(m, 'attack', 1.0); m.swingAt = 0;
        this.telegraph(m, m.x, m.y, 2.4, 1.0, 1.4);
      }
    } else if (def.mech === 'snikt') {
      // Tutorial Island's last fight: at half health he calls his scouts, and he winds up a ground slam to dodge
      if (!m.enraged && m.hp < m.maxHp * 0.5) {
        m.enraged = true;
        this.zoneEvent(m.zone, { e: 'sys', text: 'Snikt screeches: "SCOUTS! Get the soft one!"' });
        this.zoneEvent(m.zone, { e: 'bossyell', id: m.id, text: 'SCOUTS! Get the soft one!' });
        this.evAt(m, { e: 'fx', k: 'roar', x: m.x, y: m.y });
        this.summon(m, 'goblin_scout', 2);
      }
      if (ready('slam', 9)) { this.playAnim(m, 'attack', 1.0); m.swingAt = 0; this.telegraph(m, m.x, m.y, 2.2, 1.3, 1.25); }
    } else if (def.mech === 'queen') {
      if (ready('web', 5)) { this.playAnim(m, 'attack', 0.5); this.shoot(m, 'web', t.x, t.y, 0.6); }
      if (ready('brood', 13)) { this.summon(m, 'spiderling', 3); this.zoneEvent(m.zone, { e: 'sys', text: 'Vethra shrieks, and her brood answers.' }); }
    } else if (def.mech === 'champion') {
      this.championMechanics(m, t, def, ready);
    } else if (def.mech === 'king') {
      if (ready('nova', 8)) { this.playAnim(m, 'cast', 1.2); this.telegraph(m, t.x, t.y, 2.3, 1.2, 1.7); }
      if (ready('raise', 14)) { this.playAnim(m, 'cast', 1.0); this.summon(m, 'skeleton', 2); this.zoneEvent(m.zone, { e: 'sys', text: 'The Hollow King raises the dead.' }); }
      if (m.hp < m.maxHp * 0.4 && ready('volley', 6)) {
        this.playAnim(m, 'cast', 0.8);
        const base = Math.atan2(t.y - m.y, t.x - m.x);
        for (let i = -2; i <= 2; i++) this.shoot(m, 'shadowbolt', m.x + Math.cos(base + i * 0.25) * 6, m.y + Math.sin(base + i * 0.25) * 6, 0.8);
      }
    }
  }

  // a marked circle on the ground, then damage everyone still inside it
  telegraph(m, x, y, r, delay, mult, name) {
    const zone = m.zone;
    m.cast = { name: name || (MOBS[m.kind].mech === 'king' ? 'Death Nova' : 'Crushing Slam'), start: this.tick, end: this.tick + T(delay) };
    this.event({ e: 'fx', k: 'warn', x: round2(x), y: round2(y), r, t: delay }, x, y, zone);
    const timer = { at: this.tick + T(delay), zone, fn: () => {
      if (!this.ents.has(m.id) || m.hp <= 0) return;
      this.event({ e: 'fx', k: 'slam', x: round2(x), y: round2(y), r }, x, y, zone);
      for (const p of this.playersNear(x, y, r, zone)) this.applyDamage(p, this.atkOf(m) * mult, m, 0);
    } };
    this.timers.push(timer);
  }

  updateNpc(n) {
    const def = NPCS[n.kind];
    if (n.kind === 'carter') return this.updateCarter(n, def);
    if (n.kind === 'watchman') return this.updateWatch(n, def);
    if (def.guard) return this.updateGuard(n, def);
    if (def.role === 'critter') return this.updateCritter(n, def);
    if (def.wander) return this.updateFolk(n, def);
    if (def.role === 'isle') return this.isleIdle(n);
    if (def.role === 'wild') return this.updateWild(n, def);
    if (def.role === 'traveller') return this.updateTraveller(n, def);
    if (n.facingUntil && this.tick > n.facingUntil) { n.dir = n.homeDir; n.facingUntil = 0; }
  }

  // night for town life purposes, with a per-person nudge so not everyone moves at once
  isNight(n, early = 0) { const k = hash01(n.id); return between(this.tod, DUSK + early + k * 0.02, DAWN + 0.01 + k * 0.03); }

  // walk a path; -> 'walk' while moving, 'done' on arrival, 'stuck' if it failed
  walkTo(n, x, y, speed, limit = 2500) {
    if (!n.path || n.goal?.x !== x || n.goal?.y !== y) {
      if (Math.hypot(x - n.x, y - n.y) < 0.15) { n.path = null; return 'done'; }
      n.path = findPath(this.map, n.x, n.y, x, y, limit); n.goal = { x, y };
      if (!n.path) { n.goal = null; return 'stuck'; }
    }
    const moving = this.followPath(n, speed);
    if (n.path) { this.setAnim(n, moving ? 'walk' : 'idle'); return moving ? 'walk' : 'stuck'; }
    n.goal = null;
    return Math.hypot(x - n.x, y - n.y) < 0.6 ? 'done' : 'stuck';
  }
  stopWalking(n) { n.path = null; n.goal = null; }
  talking(n) { if (n.facingUntil && this.tick < n.facingUntil) { this.stopWalking(n); if (n.anim !== 'sit') this.setAnim(n, 'idle'); return true; } return false; }
  standUp(n) {
    if (n.seat == null) return;
    const st = this.map.seats[n.seat];
    this.seatTaken.delete(n.seat); n.seat = null;
    n.x = st.fx; n.y = st.fy; this.setAnim(n, 'idle');
  }

  // townsfolk: stroll about near home, sit on a bench now and then, and go indoors when their lamps are lit
  updateFolk(n, def) {
    if (this.talking(n)) return;
    const home = n.home, H = home && hoursOf(home.kind, home.hid);
    const k = hash01(n.id);
    // market visitors head back out through the nearest gate when the day is done
    if (n.leaving) {
      const g = n.y < 101 ? { x: 96.5, y: 55.5 } : { x: 96.5, y: 146.5 };
      if (this.walkTo(n, g.x, g.y, def.speed || 1.5, 8000) !== 'walk') this.ents.delete(n.id);
      return;
    }
    const raid = !!this.town.raid, fest = this.town.festival;
    // everyone hurries indoors when the alarm rings; on festival night they stay out late
    const indoors = H && (raid || between(this.tod, fest ? 0.975 : H.on - 0.012, DAWN + 0.03 + k * 0.08));
    if (n.dance && (!fest || indoors)) { this.danceTaken.delete(n.dance); n.dance = null; }
    if (n.hidden) {
      if (indoors) return;
      n.hidden = false; n.x = home.x; n.y = home.y; n.dir = 2; this.setAnim(n, 'idle'); n.wanderAt = this.tick + T(1 + k * 4);
      return;
    }
    if (indoors) {
      this.standUp(n);
      const r = this.walkTo(n, home.x, home.y, def.speed || 1.5, 6000);
      if (r === 'done' || (r === 'stuck' && (n.stuck = (n.stuck || 0) + 1) > 40)) { n.hidden = true; n.stuck = 0; this.stopWalking(n); }
      return;
    }
    // festival evening: dance round the fountain, a while in one spot, then another
    if (fest && this.tod >= 0.62) {
      this.standUp(n);
      if (!n.dance || this.tick >= n.danceUntil) {
        if (n.dance) this.danceTaken.delete(n.dance);
        const free = this.map.events.dance.filter((d) => !this.danceTaken.has(d));
        n.dance = free.length ? free[Math.floor(this.rng() * free.length)] : null;
        if (n.dance) this.danceTaken.add(n.dance);
        n.danceUntil = this.tick + T(25 + this.rng() * 30);
        this.stopWalking(n);
      }
      if (n.dance) {
        const r = this.walkTo(n, n.dance.x, n.dance.y, def.speed || 1.5, 6000);
        if (r === 'done') { n.dir = dirFromVector(95.5 - n.x, 101.5 - n.y); this.setAnim(n, 'dance'); }
        else if (r === 'stuck') n.danceUntil = this.tick;
        return;
      }
    }
    if (n.seat != null) {
      if (this.tick >= n.sitUntil) { this.standUp(n); n.wanderAt = this.tick + T(1 + this.rng() * 3); }
      return;
    }
    if (n.goal) {
      const r = this.walkTo(n, n.goal.x, n.goal.y, def.speed || 1.5);
      if (r === 'walk') return;
      if (r === 'done' && n.toSeat != null && !this.seatTaken.has(n.toSeat)) {
        const st = this.map.seats[n.toSeat];
        n.seat = n.toSeat; this.seatTaken.add(n.seat);
        n.x = st.x; n.y = st.y; n.dir = st.dir; this.setAnim(n, 'sit'); n.sitUntil = this.tick + T(12 + this.rng() * 26);
      }
      n.toSeat = null; this.stopWalking(n); this.setAnim(n, n.seat != null ? 'sit' : 'idle');
      n.wanderAt = this.tick + T(2 + this.rng() * 6);
      return;
    }
    if (this.tick < (n.wanderAt || 0)) { this.setAnim(n, 'idle'); return; }
    n.wanderAt = this.tick + T(3);
    // a free bench nearby?
    if (this.rng() < 0.15) {
      const seats = this.map.seats.map((st, i) => [st, i]).filter(([st, i]) => !this.seatTaken.has(i) && Math.hypot(st.fx - n.x, st.fy - n.y) < 24);
      if (seats.length) {
        const [st, i] = seats[Math.floor(this.rng() * seats.length)];
        if (this.walkTo(n, st.fx, st.fy, def.speed || 1.5) === 'walk') { n.toSeat = i; return; }
      }
    }
    const st = this.map.streets;
    for (let tries = 0; tries < 6; tries++) {
      const [x, y] = st[Math.floor(this.rng() * st.length)];
      if (Math.hypot(x - n.x, y - n.y) > 22 || (home && Math.hypot(x - home.x, y - home.y) > 28)) continue;
      if (this.walkTo(n, x, y, def.speed || 1.5) === 'walk') return;
    }
    this.stopWalking(n);
  }

  // cats, the dog and the hens: potter about a little patch, sit, peck; hens go in at night
  updateCritter(n, def) {
    if (this.talking(n)) return;
    if (def.roost) {
      const night = this.isNight(n, 0.01);
      if (night && !n.hidden) { n.hidden = true; this.stopWalking(n); n.x = n.origin.x; n.y = n.origin.y; }
      if (!night && n.hidden) { n.hidden = false; n.wanderAt = this.tick + T(this.rng() * 4); }
      if (n.hidden) return;
    }
    if (n.goal) {
      const r = this.walkTo(n, n.goal.x, n.goal.y, n.run || def.speed || 1.2, 600);
      if (r === 'walk') return;
      this.stopWalking(n); n.run = 0;
      // cats and dogs often settle down where they stop
      if (def.sits && this.rng() < 0.55) { this.setAnim(n, 'sit'); n.wanderAt = this.tick + T(6 + this.rng() * 18); }
      else { this.setAnim(n, 'idle'); n.wanderAt = this.tick + T(1.5 + this.rng() * (def.roost ? 3 : 6)); }
      return;
    }
    if (this.tick < (n.wanderAt || 0)) { if (n.anim === 'walk') this.setAnim(n, 'idle'); return; }
    n.wanderAt = this.tick + T(2);
    const R = n.roam || 6;
    // the dog trots over to see anyone who comes near
    if (n.kind.startsWith('dog') && this.rng() < 0.5) {
      const p = this.playersNear(n.x, n.y, 8, n.zone).find((q) => Math.hypot(q.x - n.origin.x, q.y - n.origin.y) < R * 1.6);
      if (p) {
        const a = this.rng() * Math.PI * 2, tx = Math.floor(p.x + Math.cos(a) * 1.3) + 0.5, ty = Math.floor(p.y + Math.sin(a) * 1.3) + 0.5;
        if (!isBlocked(this.map, Math.floor(tx), Math.floor(ty))) { n.run = 2.6; if (this.walkTo(n, tx, ty, 2.6, 600) === 'walk') return; }
      }
    }
    for (let tries = 0; tries < 6; tries++) {
      const a = this.rng() * Math.PI * 2, d = 1 + this.rng() * Math.min(R, 6);
      const tx = Math.floor(n.x + Math.cos(a) * d) + 0.5, ty = Math.floor(n.y + Math.sin(a) * d) + 0.5;
      if (Math.hypot(tx - n.origin.x, ty - n.origin.y) > R || isBlocked(this.map, Math.floor(tx), Math.floor(ty))) continue;
      if (this.walkTo(n, tx, ty, def.speed || 1.2, 600) === 'walk') return;
    }
    this.stopWalking(n);
  }

  // the horse and cart: round every street by day, off down the nearest road at night
  updateCarter(n, def) {
    if (this.talking(n)) return;
    const R = n.route, half = R.length / 2;     // R[0] is the north road, R[half] the south road
    const night = this.isNight(n, 0.015);
    if (n.hidden) {
      if (night) return;
      n.hidden = false; n.ri = (n.ri + 1) % R.length; return;
    }
    if (this.tick < (n.pauseUntil || 0)) { this.setAnim(n, 'idle'); return; }
    n.ri ??= 1;
    if (night) {
      // head out by whichever road is nearer along the round
      const toN = (R.length - n.ri) % R.length, toS = (half - n.ri + R.length) % R.length;
      n.ri = toN <= toS ? 0 : half;
    }
    const wp = R[n.ri];
    const r = this.walkTo(n, wp.x, wp.y, def.speed, 8000);
    if (r === 'walk') return;
    if (r === 'stuck') { n.x = wp.x; n.y = wp.y; this.stopWalking(n); }
    if ((n.ri === 0 || n.ri === half) && night) { n.hidden = true; this.setAnim(n, 'idle'); return; }
    n.ri = (n.ri + 1) % R.length;
    // a breather now and then (the plaza corners get a proper stop: deliveries)
    n.pauseUntil = this.tick + T(Math.abs(wp.y - 102) < 11 && Math.abs(wp.x - 96) > 6 ? 8 + this.rng() * 8 : 0.6 + this.rng() * 1.2);
    this.setAnim(n, 'idle');
  }

  // the watch: at the north gate by day; a lantern round of the streets at night
  updateWatch(n, def) {
    if (this.talking(n)) return;
    if (this.town.raid) {
      // ringing the alarm from the square
      const r = this.walkTo(n, 96.5, 99.5, def.speed * 1.6, 9000);
      if (r !== 'walk') { this.stopWalking(n); this.setAnim(n, 'idle'); n.dir = 0; }
      return;
    }
    const night = between(this.tod, DUSK - 0.015, DAWN + 0.01);
    if (!night) {
      const P = n.post;
      if (Math.hypot(P.x - n.x, P.y - n.y) < 0.2) {
        this.stopWalking(n); this.setAnim(n, 'idle');
        if (n.facingUntil && this.tick > n.facingUntil) n.facingUntil = 0;
        if (!n.facingUntil) n.dir = P.dir;
        return;
      }
      const r = this.walkTo(n, P.x, P.y, def.speed, 9000);
      if (r === 'stuck') { n.x = P.x; n.y = P.y; this.stopWalking(n); }
      return;
    }
    if (this.tick < (n.pauseUntil || 0)) { this.setAnim(n, 'idle'); return; }
    const R = n.route;
    n.wi ??= 0;
    const wp = R[n.wi];
    const r = this.walkTo(n, wp.x, wp.y, def.speed, 8000);
    if (r === 'walk') return;
    if (r === 'stuck') { n.x = wp.x; n.y = wp.y; this.stopWalking(n); }
    n.wi = (n.wi + 1) % R.length;
    n.pauseUntil = this.tick + T(1 + this.rng() * 3);
    this.setAnim(n, 'idle');
  }

  // ---------------------------------------------------------------- the bank
  // ops: dep (inventory slot -> vault, whole stack or one), wd (vault slot -> pack), depgold / wdgold (amount), buy (20 more slots)
  bankOp(p, m) {
    const near = [...this.ents.values()].some((e) => e.type === 'npc' && e.zone === p.zone && NPCS[e.kind].role === 'bank' && Math.hypot(e.x - p.x, e.y - p.y) < 4.5);
    if (!near) return this.privateEvent(p, { e: 'sys', text: 'Speak to a bank clerk to use your vault.' });
    const b = p.bank, say = (text) => this.privateEvent(p, { e: 'sys', text });
    if (m.op === 'dep') {
      const it = p.inv[m.slot];
      if (!it) return;
      if (ITEMS[it.item].type === 'quest') return say('Better keep that with you.');
      const def = ITEMS[it.item], qty = m.one ? 1 : it.qty;
      let left = qty;
      if (def.stack) for (const s2 of b.items) if (s2 && s2.item === it.item && left > 0 && s2.qty < def.stack) { const add = Math.min(left, def.stack - s2.qty); s2.qty += add; left -= add; }
      while (left > 0) {
        const i = b.items.indexOf(null);
        if (i < 0) break;
        const add = def.stack ? Math.min(left, def.stack) : 1;
        b.items[i] = { item: it.item, qty: add, ...(it.r ? { r: it.r } : {}), ...(it.b ? { b: it.b } : {}) }; left -= add;
      }
      const moved = qty - left;
      if (!moved) return say('Your vault is full. A clerk can sell you more space.');
      it.qty -= moved; if (it.qty <= 0) p.inv[m.slot] = null;
      this.privateEvent(p, { e: 'sfx', s: 'pickup' });
    } else if (m.op === 'wd') {
      const it = b.items[m.slot];
      if (!it) return;
      const qty = m.one ? 1 : it.qty;
      const before = this.countItem(p, it.item);
      if (ITEMS[it.item].stack) this.addItem(p, it.item, qty);
      else if (!this.addItem(p, it.item, 1, it.r || 0, it.b || null)) return say('Your pack is full.');
      const moved = ITEMS[it.item].stack ? this.countItem(p, it.item) - before : 1;
      if (!moved) return say('Your pack is full.');
      it.qty -= moved; if (it.qty <= 0) b.items[m.slot] = null;
      this.privateEvent(p, { e: 'sfx', s: 'pickup' });
    } else if (m.op === 'depgold') {
      const v = Math.min(p.gold, Math.max(0, Math.floor(m.amount)));
      if (!v) return;
      p.gold -= v; b.gold += v;
      this.privateEvent(p, { e: 'sfx', s: 'coin' });
    } else if (m.op === 'wdgold') {
      const v = Math.min(b.gold, Math.max(0, Math.floor(m.amount)));
      if (!v) return;
      b.gold -= v; p.gold += v;
      this.privateEvent(p, { e: 'sfx', s: 'coin' });
    } else if (m.op === 'buy') {
      if (b.size >= BANK.max) return say('Your vault is as big as it gets.');
      const price = BANK.prices[(b.size - BANK.start) / BANK.step];
      if (p.gold + b.gold < price) return say(`That will be ${price} gold, and you don't have it.`);
      // pay from your purse first, then from the vault
      const fromPurse = Math.min(p.gold, price); p.gold -= fromPurse; b.gold -= price - fromPurse;
      b.size += BANK.step; while (b.items.length < b.size) b.items.push(null);
      this.privateEvent(p, { e: 'gold', v: -price });
      this.privateEvent(p, { e: 'loot', text: `Your vault now holds ${b.size} slots.`, r: 1 });
    } else return;
    p.selfDirty = true;
  }

  updateLoot(l) { if (this.tick > l.expires) this.ents.delete(l.id); }

  // ---------------------------------------------------------------- items
  pickup(p, l, quietFull = false) {
    if (!this.ents.has(l.id)) return false;
    if (l.owner && l.owner !== p.id && this.tick < l.ownerUntil && this.ents.has(l.owner)) return false;
    if (l.kind === 'gold') {
      p.gold += l.qty; this.privateEvent(p, { e: 'gold', v: l.qty });
      this.tutorialEvent(p, 'loot');
    } else {
      if (!this.addItem(p, l.kind, l.qty, l.r, l.b || null)) { if (!quietFull || !p.fullWarnAt || this.tick - p.fullWarnAt > T(8)) { p.fullWarnAt = this.tick; this.privateEvent(p, { e: 'sys', text: 'Your pack is full: the loot stays on the ground.' }); } return false; }
      const entry = { item: l.kind, r: l.r };
      this.privateEvent(p, { e: 'loot', text: `Picked up ${itemName(entry)}${l.qty > 1 ? ' x' + l.qty : ''}.`, r: l.r || 0 });
      this.tutorialEvent(p, 'loot');
    }
    p.selfDirty = true;
    this.ents.delete(l.id);
    return true;
  }

  // b: the piece's bonus stats; leave it out for a newly made piece and Fine/Masterwork gear rolls its own
  addItem(p, item, qty = 1, r = 0, b) {
    const def = ITEMS[item];
    if (b === undefined) b = this.rollBonus(item, r);
    if (def.stack) {
      let left = qty;
      for (const s of p.inv) if (s && s.item === item && s.qty < def.stack && left > 0) { const add = Math.min(left, def.stack - s.qty); s.qty += add; left -= add; }
      while (left > 0) {
        const i = p.inv.indexOf(null);
        if (i < 0) { p.selfDirty = true; return left < qty; }
        const add = Math.min(left, def.stack); p.inv[i] = { item, qty: add }; left -= add;
      }
      p.selfDirty = true;
      return true;
    }
    for (let n = 0; n < qty; n++) {
      const i = p.inv.indexOf(null);
      if (i < 0) return n > 0;
      p.inv[i] = { item, qty: 1, ...(r ? { r } : {}), ...(b ? { b } : {}) };
      if (qty > 1) b = this.rollBonus(item, r);
    }
    p.selfDirty = true;
    return true;
  }

  countItem(p, item) { return p.inv.reduce((n, s) => n + (s?.item === item ? s.qty : 0), 0); }
  removeItem(p, item, qty) {
    for (let i = p.inv.length - 1; i >= 0 && qty > 0; i--) {
      const s = p.inv[i];
      if (s?.item !== item) continue;
      const take = Math.min(qty, s.qty); s.qty -= take; qty -= take;
      if (!s.qty) p.inv[i] = null;
    }
    p.selfDirty = true;
  }

  useItem(p, slot) {
    const it = p.inv[slot];
    if (!it || p.anim === 'die') return;
    const def = ITEMS[it.item];
    if (def.type === 'consumable') {
      if (p.hp >= p.maxHp) return this.privateEvent(p, { e: 'sys', text: 'You are already at full health.' });
      const heal = Math.min(def.heal, p.maxHp - p.hp);
      p.hp += heal;
      if (--it.qty <= 0) p.inv[slot] = null;
      this.evAt(p, { e: 'heal', id: p.id, v: heal, potion: 1 });
    } else if (def.type === 'dye') {
      if (!p.equip.armor) return this.privateEvent(p, { e: 'sys', text: 'Put on some armor first, then dye it.' });
      p.dye = def.dye;
      if (--it.qty <= 0) p.inv[slot] = null;
      this.privateEvent(p, { e: 'equip', text: `Your armor is now ${DYES[def.dye].name}.` });
    } else if (def.type === 'meal' || def.type === 'elixir' || def.type === 'kit') {
      return this.eat(p, slot);
    } else if (def.type === 'bandage') {
      return this.bandage(p, slot);
    } else if (def.type === 'recipe') {
      if (p.recipes.includes(def.recipe)) return this.privateEvent(p, { e: 'sys', text: 'You already know that recipe.' });
      p.recipes.push(def.recipe);
      if (--it.qty <= 0) p.inv[slot] = null;
      this.privateEvent(p, { e: 'quest', text: `Recipe learned: ${MEALS[def.recipe].name}` });
    } else if (def.type === 'seed' || def.type === 'fertilizer') {
      return this.useFarmItem(p, slot);
    } else if (def.type === 'hearth') {
      return this.useHearth(p);
    } else if (def.type === 'mount') {
      return this.learnMount(p, slot);
    } else if (def.type === 'tool' || def.type === 'bait') {
      const hint = def.rod ? 'Click on the water to cast your line.' : def.type === 'bait' ? 'Bait is used up one at a time as you fish, the best first.'
        
        : it.item === 'shovel' ? 'Click the tilled earth in the fields at Hollowmere Farms to dig a hole, then click the hole to plant.' : it.item === 'scythe' ? 'Click your ripe wheat or barley to cut it.' : it.item === 'foraging_stick' ? 'Click wild flowers, ferns and grass tufts out in the country to search them for seeds.'
        : it.item === 'pickaxe' ? 'Click an ore vein in the hills or by the cliffs to mine it.' : it.item === 'hatchet' ? 'Click one of the young oaks, tall pines or elder ashes to chop it.' : 'Click a herb in the wild to pick it.';
      return this.privateEvent(p, { e: 'sys', text: hint });
    } else if (GEAR_SLOTS.includes(def.type)) {
      if (def.cls && def.cls !== p.cls) return this.privateEvent(p, { e: 'sys', text: `Only a ${CLASSES[def.cls].name} can use ${def.name}.` });
      const prev = p.equip[def.type];
      p.equip[def.type] = { item: it.item, r: it.r || 0, ...(it.b ? { b: it.b } : {}) };
      p.inv[slot] = prev ? { item: prev.item, qty: 1, ...(prev.r ? { r: prev.r } : {}), ...(prev.b ? { b: prev.b } : {}) } : null;
      this.recalcStats(p);
      this.privateEvent(p, { e: 'equip', text: `Equipped ${itemName(p.equip[def.type])}.` });
    } else return;
    p.selfDirty = true;
  }

  unequip(p, slot) {
    const e = p.equip[slot];
    if (!e) return;
    if (!this.addItem(p, e.item, 1, e.r, e.b || null)) return this.privateEvent(p, { e: 'sys', text: 'Your pack is full.' });
    p.equip[slot] = null; this.recalcStats(p);
  }

  nearNpc(p, npcId, role) {
    const n = this.ents.get(npcId);
    if (!n || n.type !== 'npc' || n.zone !== p.zone || (role && NPCS[n.kind].role !== role)) return null;
    return Math.hypot(n.x - p.x, n.y - p.y) < 3.5 ? n : null;
  }

  sell(p, slot) {
    const it = p.inv[slot];
    if (!it) return;
    if (ITEMS[it.item].type === 'quest') return this.privateEvent(p, { e: 'sys', text: 'Someone is waiting for that.' });
    if (ITEMS[it.item].nosell) return this.privateEvent(p, { e: 'sys', text: 'You would never part with that.' });
    const near = [...this.ents.values()].find((e) => e.type === 'npc' && e.zone === p.zone && npcBuys(e.kind) && Math.hypot(e.x - p.x, e.y - p.y) < 3.5);
    if (!near) return this.privateEvent(p, { e: 'sys', text: 'Stand next to a trader, shopkeeper or townsperson to sell.' });
    const price = sellPrice(it);
    p.gold += price;
    if (--it.qty <= 0) p.inv[slot] = null;
    p.selfDirty = true;
    this.privateEvent(p, { e: 'gold', v: price });
  }

  buy(p, npcId, item) {
    const n = this.nearNpc(p, npcId, 'shop');
    if (!n) return;
    if (item.startsWith('sp:')) {
      const sp = n.special?.[Number(item.slice(3))];
      if (!sp) return;
      if (p.gold < sp.price) return this.privateEvent(p, { e: 'sys', text: 'Not enough gold.' });
      if (!this.addItem(p, sp.item, 1, sp.r)) return this.privateEvent(p, { e: 'sys', text: 'Your pack is full.' });
      p.gold -= sp.price; p.selfDirty = true;
      this.privateEvent(p, { e: 'gold', v: -sp.price });
      return this.privateEvent(p, { e: 'loot', text: `Bought ${itemName(sp)}.`, r: sp.r });
    }
    if (!NPCS[n.kind].stock.includes(item)) return;
    const price = buyPrice(item);
    if (p.gold < price) return this.privateEvent(p, { e: 'sys', text: 'Not enough gold.' });
    if (!this.addItem(p, item, 1)) return this.privateEvent(p, { e: 'sys', text: 'Your pack is full.' });
    p.gold -= price; p.selfDirty = true;
    this.privateEvent(p, { e: 'gold', v: -price });
    this.privateEvent(p, { e: 'sys', text: `Bought ${ITEMS[item].name}.` });
  }

  craft(p, npcId, recipeId) {
    const R = RECIPES[recipeId], n = this.ents.get(npcId);
    if (!R || !this.craftAt(p, n, R) || (R.cls && R.cls !== p.cls)) return;
    const say = (text) => this.privateEvent(p, { e: 'sys', text });
    if (R.requires && p.quests[R.requires]?.state !== 'done') return say('Hilda does not know how to work that metal yet.');
    if (R.learned && !p.recipes.includes(R.out)) return say('You have not learned that recipe yet.');
    if (R.at === 'cook' && this.tradeLv(p, 'cooking') < R.lv) return say(`You need Cooking level ${R.lv} for that.`);
    if (R.trade && this.tradeLv(p, R.trade) < R.lv) return say(`You need ${TRADES[R.trade].name} level ${R.lv} for that.`);
    for (const [mat, q] of Object.entries(R.mats)) if (this.countItem(p, mat) < q) return say(`You need ${q} ${ITEMS[mat].name}.`);
    if (p.gold < R.gold) return say('Not enough gold.');
    if (!p.inv.includes(null) && !p.inv.some((s) => s?.item === R.out && s.qty < (ITEMS[R.out].stack || 1))) return say('Your pack is full.');
    for (const [mat, q] of Object.entries(R.mats)) this.removeItem(p, mat, q);
    p.gold -= R.gold;
    const out = R.at === 'cook' ? this.cookResult(p, R) : R.out;
    const r = ITEMS[out].stack ? 0 : this.rollRarity(R.trade ? craftRarity(this.tradeLv(p, R.trade), R.lv) : [55, 33, 12]);
    this.addItem(p, out, R.qty || 1, r);
    if (R.trade) this.gainTrade(p, R.trade, craftXp(R));
    p.selfDirty = true;
    const what = `${R.qty > 1 ? R.qty + ' x ' : ''}${itemName({ item: out, r })}`;
    if (R.at === 'cook') {
      this.evAt(n, { e: 'sfx', s: 'sizzle', x: round2(n.x), y: round2(n.y) });
      this.privateEvent(p, out === 'burnt_food' ? { e: 'sys', text: 'Oops. It burned. Practice makes perfect.' } : { e: 'loot', text: `You cooked ${what}.`, r: 0 });
    } else if (R.at === 'mill') {
      this.evAt(n, { e: 'sfx', s: 'dig', x: round2(n.x), y: round2(n.y) });
      this.privateEvent(p, { e: 'loot', text: `The mill grinds you ${what}.`, r: 0 });
    } else if (R.at === 'craft') {
      this.evAt(n, { e: 'fx', k: 'anvil', x: round2(n.x), y: round2(n.y) });
      this.evAt(n, { e: 'sfx', s: R.trade === 'blacksmithing' ? 'anvil' : 'pickup', x: round2(n.x), y: round2(n.y) });
      this.privateEvent(p, { e: 'loot', text: `You crafted ${what}.`, r });
    } else if (R.at === 'brew') {
      this.evAt(n, { e: 'sfx', s: 'brew', x: round2(n.x), y: round2(n.y) });
      this.privateEvent(p, { e: 'loot', text: `Mira brewed you ${what}.`, r: 0 });
    } else {
      this.evAt(n, { e: 'fx', k: 'anvil', x: round2(n.x), y: round2(n.y) });
      this.privateEvent(p, { e: 'loot', text: `Hilda forged you ${what}.`, r });
    }
  }

  // ---------------------------------------------------------------- dialog & quests
  grantReward(p, q) {
    const R = QUESTS[q].reward, got = [];
    if (R.gold) { const g = Math.max(5, Math.round(R.gold * QUEST_GOLD / 5) * 5); p.gold += g; got.push(`+${g} gold`); }
    for (const [item, qty] of R.items || []) { if (!this.addItem(p, item, qty)) this.dropLoot(item, qty, p.x, p.y, p.zone, p.id); got.push(ITEMS[item].name + (qty > 1 ? ` x${qty}` : '')); }
    for (const [slot, tier, r] of R.gear || []) {
      const item = gearFor(p.cls, slot, tier);
      if (!this.addItem(p, item, 1, r)) this.dropLoot(item, 1, p.x, p.y, p.zone, p.id, r);
      got.push(itemName({ item, r }));
    }
    if (R.dye) { const item = DYE_ITEMS.find((k) => ITEMS[k].dye === R.dye); if (!this.addItem(p, item, 1)) this.dropLoot(item, 1, p.x, p.y, p.zone, p.id); got.push(ITEMS[item].name); }
    if (R.title && !p.titles.includes(R.title)) { p.titles.push(R.title); if (!p.title) p.title = R.title; got.push(`title "${TITLES[R.title]}"`); this.privateEvent(p, { e: 'title', text: TITLES[R.title] }); }
    if (R.pet && !p.pets.includes(R.pet)) {
      p.pets.push(R.pet); got.push(`pet ${PETS[R.pet].kind.toLowerCase()} ${PETS[R.pet].name}`);
      this.dismissPet(p); p.pet = R.pet; this.summonPet(p);
      this.privateEvent(p, { e: 'pet', text: `${PETS[R.pet].name} the ${PETS[R.pet].kind} is now following you!` });
    }
    if (R.skill) {
      const sk = MILESTONE_SKILLS[R.skill][p.cls];
      if (sk && !p.unlocks.includes(sk)) {
        p.unlocks.push(sk); got.push(`new skill: ${SKILLS[sk].name}`);
        this.privateEvent(p, { e: 'milestone', lv: R.skill, trial: 1, skill: sk, text: `${SKILLS[sk].name} unlocked! Press K to learn it, then use it from your skill bar.` });
        this.evAt(p, { e: 'fx', k: 'ascend', x: round2(p.x), y: round2(p.y) });
      }
    }
    if (R.xp) { this.grantXp(p, R.xp); got.push(`+${R.xp} xp`); }
    p.selfDirty = true;
    return got;
  }

  talk(p, n) {
    const npc = NPCS[n.kind];
    if (npc.role === 'isle') return this.isleTalk(p, n);
    const say = (text, options) => this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: npc.name, text, options });
    if (n.kind.startsWith('hen_') && this.tick >= (n.eggAt || 0) && this.rng() < 0.55 && this.addItem(p, 'egg', 1)) {
      n.eggAt = this.tick + T(50);
      return say('She clucks and shuffles aside. There is a warm egg underneath! (+1 Egg)', [{ id: 'bye', label: 'Thank you, hen' }]);
    }
    const specOpts = this.specOptions(p, n);
    const roleOpts0 = npc.role === 'shop' ? [{ id: 'shop', label: 'Show me your wares' }, ...(npc.brew ? [{ id: 'brew', label: 'Could you brew something for me?' }] : [])] : npc.role === 'craft' ? [{ id: 'craft', label: 'Show me the forge and the workbench' }]
      : npc.role === 'bank' ? [{ id: 'bank', label: 'Open my vault' }] : npc.role === 'inn' ? [{ id: 'rest', label: `Rent a bed and rest (${INN_PRICE} gold)` }]
      : npc.heal && p.hp < p.maxHp ? [{ id: 'heal', label: 'Could you tend my wounds?' }] : [];
    const roleOpts = [...specOpts, ...roleOpts0];
    const st = npcQuestState(n.kind, p.quests, p.inv, p);
    if (st.turnin) {
      const q = st.turnin, d = QUESTS[q];
      if (d.kind === 'collect') this.removeItem(p, d.item, d.count);
      for (const [item, qty] of d.take || []) this.removeItem(p, item, qty);
      p.quests[q].state = 'done';
      const got = this.grantReward(p, q);
      if (d.repeat) { delete p.quests[q]; p.bounties = (p.bounties || 0) + 1; }
      this.privateEvent(p, { e: 'quest', text: `Quest complete: ${d.title}` });
      const nowSpec = specOpts.length ? [] : this.specOptions(p, n);   // the level 10 trial opens the paths right away
      return say(`${d.done}\n\n(${got.join(', ')})`, [...nowSpec, { id: 'talk', label: 'Anything else?' }, ...roleOpts, { id: 'bye', label: 'Farewell' }]);
    }
    if (st.offer) {
      const d = QUESTS[st.offer];
      return say(d.offer, [{ id: 'accept:' + st.offer, label: `Accept: ${d.title}` }, ...roleOpts, { id: 'bye', label: 'Not now' }]);
    }
    if (st.progress) {
      const q = st.progress, d = QUESTS[q];
      const prog = d.kind === 'talk' ? '' : ` (${questProgress(q, p.quests[q], p.inv)}/${d.count})`;
      if (d.giver === n.kind || d.kind !== 'talk') return say(d.progress + prog, [...roleOpts, { id: 'bye', label: 'On my way' }]);
    }
    if (npc.role === 'shop') return say(npc.greet || "Welcome, welcome! Bram's got the finest goods this side of the lake. Well. The only goods.", [...roleOpts, { id: 'bye', label: 'Goodbye' }]);
    if (npc.role === 'bank') {
      // talking to a clerk opens the vault straight away
      return this.send(p.clientId, { t: S2C.BANK, npc: n.id, name: 'Bank of Hollowmere', clerk: npc.name });
    }
    if (npc.role === 'inn') return say(`Welcome to the Sleeping Goat! A warm bed and a hot supper for ${INN_PRICE} gold. You'll wake up good as new.`, [...roleOpts, { id: 'bye', label: 'Maybe later' }]);
    if (npc.heal && p.hp < p.maxHp) return say('You are hurt. Sit a moment and let me see to that.', [...roleOpts, { id: 'bye', label: "I'm fine" }]);
    if (npc.role === 'craft') return say("Bring me goblin scrap and slime gel and I'll hammer out something worth carrying. Bring me Grukk's horn and I'll make you something worth bragging about.\n\nOr use my bench yourself: smithing, leatherwork and tailoring. Helms, gloves, boots, rings... the camps out in the wilds have workbenches too.", [...roleOpts, { id: 'bye', label: 'Goodbye' }]);
    if (n.kind === 'elder' && p.quests.deep3?.state === 'done') return say('The Hollow King sleeps, and Hollowmere with him, peacefully this time. You have done more than any warden before you.', [{ id: 'bye', label: 'Farewell' }]);
    const lines = npc.lines || ['Good day.'];
    say(lines[Math.floor(this.rng() * lines.length)], [...specOpts, { id: 'bye', label: 'Goodbye' }]);
  }

  dialogChoice(p, npcId, choice) {
    if (choice.startsWith('stone:') && this.stoneChoice(p, npcId, choice)) return;
    const n = this.nearNpc(p, npcId);
    if (!n) return;
    const role = NPCS[n.kind].role;
    if (role === 'isle') return this.isleDialog(p, choice);
    if (choice === 'shop' && role === 'shop') {
      const stock = NPCS[n.kind].stock.map((item) => ({ item, price: buyPrice(item) }));
      (n.special || []).forEach((sp, i) => stock.push({ item: sp.item, r: sp.r, price: sp.price, id: 'sp:' + i }));
      return this.send(p.clientId, { t: S2C.SHOP, npc: n.id, name: NPCS[n.kind].name, stock });
    }
    if (choice === 'craft' && role === 'craft') return this.send(p.clientId, { t: S2C.CRAFT, npc: n.id, name: NPCS[n.kind].name, at: 'forge' });
    if (choice === 'brew' && NPCS[n.kind].brew) return this.send(p.clientId, { t: S2C.CRAFT, npc: n.id, name: NPCS[n.kind].name, at: 'brew' });
    if (choice === 'bank' && role === 'bank') return this.send(p.clientId, { t: S2C.BANK, npc: n.id, name: 'Bank of Hollowmere', clerk: NPCS[n.kind].name });
    if (choice === 'rest' && role === 'inn') {
      if (p.gold < INN_PRICE) return this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text: "No coin, no bed, love. Come back when your purse is heavier.", options: [{ id: 'bye', label: 'Goodbye' }] });
      p.gold -= INN_PRICE; const heal = p.maxHp - p.hp; p.hp = p.maxHp; p.mp = p.maxMp; p.selfDirty = true;
      this.privateEvent(p, { e: 'gold', v: -INN_PRICE });
      if (heal > 0) this.evAt(p, { e: 'heal', id: p.id, v: heal });
      this.evAt(p, { e: 'fx', k: 'heal', x: round2(p.x), y: round2(p.y) });
      return this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text: 'You sleep like a log and wake to the smell of fresh bread. You feel completely rested.', options: [{ id: 'bye', label: 'Thank you, Bess' }] });
    }
    if (choice === 'heal' && NPCS[n.kind].heal) {
      const heal = p.maxHp - p.hp; if (heal <= 0) return;
      p.hp = p.maxHp; p.selfDirty = true;
      this.evAt(p, { e: 'heal', id: p.id, v: heal });
      this.evAt(p, { e: 'fx', k: 'heal', x: round2(p.x), y: round2(p.y) });
      return this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text: 'There. The light keeps its own. Go carefully.', options: [{ id: 'bye', label: 'Thank you, Sister' }] });
    }
    if (choice === 'talk') return this.talk(p, n);
    if (choice === 'spec') return this.specOptions(p, n).length ? this.specMenu(p, n) : undefined;
    if (choice.startsWith('spec:')) return this.chooseSpec(p, n, choice.slice(5));
    if (choice.startsWith('accept:')) {
      const q = choice.slice(7);
      if (QUESTS[q] && QUESTS[q].giver === n.kind && npcQuestState(n.kind, p.quests, p.inv, p).offer === q) {
        // a boss you already beat counts right away
        const Q = QUESTS[q], already = Q.kind === 'kill' && MOBS[Q.target]?.boss && p.bosses.includes(Q.target);
        p.quests[q] = { state: 'active', count: already ? Q.count : 0 }; p.selfDirty = true;
        this.privateEvent(p, { e: 'quest', text: `New quest: ${QUESTS[q].title}` });
        for (const [item, qty] of Q.start || []) if (!this.countItem(p, item) && !this.addItem(p, item, qty)) this.dropLoot(item, qty, p.x, p.y, p.zone, p.id);
      }
    }
  }
}

// trades (fishing, gathering, cooking) and town events live in their own files
Object.assign(World.prototype, tradeMethods, townMethods, farmMethods, questMethods, travelMethods, specMethods, partyMethods, swapMethods, progressMethods, socialMethods, tutorialMethods, bossMethods, poiMethods);
