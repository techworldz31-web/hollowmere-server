// Admin tools for the online server (never part of single-player).
//
// Becoming an admin: type  /admin <password>  in chat once. The password lives in
// "ADMIN PASSWORD.txt" (made the first time the server starts; the host keeps it in the host
// folder, which is never handed out to players). That hero is an admin from then on, every
// time they log in with their own hero password. Owners (who used the password) can also make
// other heroes admins from the panel.
//
// Everything is checked here, on the server: a player who isn't an admin gets no answer at
// all, so there's nothing to find. Every admin action is written to admin-log.txt.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { ITEMS, MOBS, NPCS, CLASSES, FLOORS, RARITY, itemStat } from '../shared/content.js';
import { GEAR_SLOTS } from '../shared/gear.js';
import { REGIONS, SPOT_NAMES, MAX_LEVEL } from '../shared/questline.js';
import { isBlocked } from '../shared/pathfind.js';
import { TERRAIN, TICK_RATE } from '../shared/constants.js';

const WORDS = ['amber', 'falcon', 'willow', 'ember', 'frost', 'harbor', 'thistle', 'copper', 'raven', 'meadow', 'granite', 'lantern', 'badger', 'cinder', 'maple', 'otter', 'saffron', 'tundra', 'velvet', 'walnut'];
const key = (n) => String(n || '').trim().toLowerCase();
const now = () => Date.now();
const mins = (m) => m * 60 * 1000;

export function createAdmin({ world, send, kickSocket, dataDir, passFile, meta }) {
  const STATE_FILE = join(dataDir, 'moderation.json');
  const LOG_FILE = join(dataDir, 'admin-log.txt');
  const ensureDir = () => { if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true }); };

  // ---------------------------------------------------------------- the password
  function readPassword() {
    try {
      const txt = readFileSync(passFile, 'utf8');
      const m = txt.match(/^\s*password\s*:\s*(\S+)/im);
      if (m) return m[1];
    } catch { /* make one */ }
    const a = randomInt(WORDS.length), b = (a + 1 + randomInt(WORDS.length - 1)) % WORDS.length;
    const pw = `${WORDS[a]}-${WORDS[b]}-${randomInt(1000, 9999)}`;
    try {
      writeFileSync(passFile, [
        'HOLLOWMERE ADMIN PASSWORD',
        '=========================',
        '',
        `password: ${pw}`,
        '',
        'To become an admin: log in to the online game as your hero, then type this in chat:',
        `    /admin ${pw}`,
        'You only have to do that once: your hero stays an admin. Then press F8 (or type /admin)',
        'to open the admin panel.',
        '',
        'Keep this password secret. To change it, edit the "password:" line above and restart the host.',
        'Players can never see this file.',
        '',
      ].join('\r\n'));
    } catch (e) { console.log('Could not write the admin password file:', e.message); }
    return pw;
  }
  let PASSWORD = readPassword();
  console.log(`  admin password: in "${passFile}"`);

  // ---------------------------------------------------------------- saved state
  let S = { admins: {}, bans: {}, ipBans: {}, mutes: {}, jails: {} };
  try { S = { ...S, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* first run */ }
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { ensureDir(); writeFileSync(STATE_FILE, JSON.stringify(S, null, 1)); }, 300); };
  const log = (who, what) => {
    ensureDir();
    const line = `${new Date().toLocaleString()} | ${who} | ${what}`;
    appendFileSync(LOG_FILE, line + '\n');
    recent.push(line); if (recent.length > 60) recent.shift();
    console.log(`[admin] ${who}: ${what}`);
  };
  const recent = [];
  try { recent.push(...readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-40).filter(Boolean)); } catch { /* none yet */ }

  // ---------------------------------------------------------------- helpers
  const playerOf = (cid) => { const c = world.clients.get(cid); return c ? world.ents.get(c.entId) : null; };
  const isAdmin = (p) => !!(p && S.admins[key(p.name)]);
  const isOwner = (p) => S.admins[key(p.name)]?.rank === 'owner';
  const sys = (p, text) => world.privateEvent(p, { e: 'sys', text });
  const reply = (cid, m) => send(cid, { t: 'admin', ...m });
  const byId = (id) => { const e = world.ents.get(id); return e && e.type === 'player' ? e : null; };
  const nameOf = (p) => p?.name || '?';
  const fmtLeft = (until) => { if (!until) return 'forever'; const m = Math.max(1, Math.round((until - now()) / 60000)); return m >= 120 ? `${Math.round(m / 60)} hours` : `${m} min`; };

  // where someone is, in words
  function placeOf(p) {
    if (p.zone !== 'world') { const z = world.zones.get(p.zone); return z ? `The Hollow Deep: ${FLOORS[z.floor]?.name || 'floor ' + (z.floor + 1)}` : 'a dungeon'; }
    const T = world.map.town;
    if (p.x >= T.x0 && p.x <= T.x1 && p.y >= T.y0 && p.y <= T.y1) return 'Hollowmere (town)';
    let best = null, bd = Infinity;
    for (const [id, sp] of Object.entries(world.map.spots || {})) { const d = Math.hypot(sp.x - p.x, sp.y - p.y); if (d < (sp.r || 4) + 3 && d < bd) { bd = d; best = SPOT_NAMES[id] || id; } }
    if (best) return best.replace(/^the /, 'The ');
    for (const R of Object.values(REGIONS)) if (Math.hypot(R.x - p.x, R.y - p.y) < R.r) return R.name;
    const L = world.map.landmarks;
    if (L.lake && Math.hypot(L.lake.x - p.x, L.lake.y - p.y) < 22) return 'By the lake';
    if (L.camp && Math.hypot(L.camp.x - p.x, L.camp.y - p.y) < 18) return 'The goblin camp';
    if (L.meadow && Math.hypot(L.meadow.x - p.x, L.meadow.y - p.y) < 18) return 'The meadow';
    return 'Out in the wilds';
  }
  // what someone is doing right now
  function activity(p) {
    if (p.anim === 'die') return 'Dead';
    if (p.frozen === 'jail') return 'In jail';
    if (p.frozen) return 'Frozen';
    if (p.fish) return 'Fishing';
    if (p.gather) return 'Gathering';
    if (p.act) return typeof p.act === 'object' && p.act.k ? `Working (${p.act.k})` : 'Working';
    if (p.travel) return p.travel.kind === 'hearth' ? 'Using the hearthstone' : 'Travelling';
    if (p.target != null) { const t = world.ents.get(p.target); if (t?.type === 'mob') return `Fighting ${MOBS[t.kind]?.name || t.kind}`; }
    if (world.tick - (p.lastHurt || -1e9) < TICK_RATE * 4) return 'In combat';
    if (p.channel) return 'Casting';
    if (p.pending != null) { const t = world.ents.get(p.pending); if (t?.type === 'npc') return `Going to ${t.name}`; }
    if (p.mounted) return p.path || p.moveDir ? 'Riding' : 'On horseback';
    if (p.path || p.moveDir) return 'Walking';
    if (p.anim === 'sit') return 'Sitting';
    return 'Standing still';
  }
  const gearName = (e) => e ? `${RARITY[e.r || 0]?.name ? RARITY[e.r].name + ' ' : ''}${ITEMS[e.item]?.name || e.item}` : null;

  function playerRow(p) {
    const c = [...world.clients.entries()].find(([, cc]) => cc.entId === p.id);
    const m = c ? meta.get(c[0]) : null;
    const party = world.partyOf?.(p);
    return {
      id: p.id, n: p.name, cls: p.cls, lv: p.level, hp: Math.round(p.hp), mh: p.maxHp, gold: p.gold, bankGold: p.bank?.gold || 0,
      zone: p.zone, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, place: placeOf(p), doing: activity(p),
      party: party ? party.members.join(', ') : '', since: m?.joinedAt || null, ip: m?.ip || '',
      admin: S.admins[key(p.name)]?.rank || '', god: !!p.god, vanish: !!p.vanish, frozen: p.frozen === true, jail: p.frozen === 'jail',
      muted: !!p.muted, muteLeft: S.mutes[key(p.name)] ? fmtLeft(S.mutes[key(p.name)]) : '', jailLeft: S.jails[key(p.name)] ? fmtLeft(S.jails[key(p.name)].until) : '',
      mounted: !!p.mounted, dead: p.anim === 'die',
    };
  }
  function detail(p) {
    return {
      ...playerRow(p),
      xp: p.xp, atk: Math.round(world.atkOf(p)), def: Math.round(world.defOf(p)), spec: p.spec || '',
      equip: Object.fromEntries(GEAR_SLOTS.map((s) => [s, gearName(p.equip[s])])),
      bag: p.inv.filter(Boolean).map((s) => `${gearName(s)}${s.qty > 1 ? ' ×' + s.qty : ''}`),
      quests: Object.values(p.quests).filter((q) => q.state === 'done').length,
      active: Object.entries(p.quests).filter(([, q]) => q.state === 'active').map(([k]) => k),
      titles: p.titles.length, mounts: p.mounts.join(', '),
    };
  }
  function overview() {
    const players = [];
    for (const c of world.clients.values()) { const p = world.ents.get(c.entId); if (p) players.push(playerRow(p)); }
    players.sort((a, b) => a.n.localeCompare(b.n));
    const bans = Object.entries(S.bans).map(([n, b]) => ({ n: b.name || n, key: n, reason: b.reason, by: b.by, left: fmtLeft(b.until), at: b.at }))
      .concat(Object.entries(S.ipBans).map(([ip, b]) => ({ n: `${b.name || '?'} (internet address)`, ip, reason: b.reason, by: b.by, left: fmtLeft(b.until), at: b.at })));
    const admins = Object.entries(S.admins).map(([n, a]) => ({ n: a.name || n, rank: a.rank, by: a.by }));
    return { players, bans, admins, log: recent.slice(-40), tod: world.tod, weather: world.weather, day: world.day };
  }

  // best gear for a class: per slot, the item with the strongest stats at the best quality
  function bestGear(cls) {
    const out = {};
    for (const slot of GEAR_SLOTS) {
      let best = null, bs = -1;
      for (const [k, v] of Object.entries(ITEMS)) {
        if (v.type !== slot || (v.cls && v.cls !== cls)) continue;
        const st = itemStat({ item: k, r: RARITY.length - 1 });
        const score = (st.atk || 0) * 3 + (st.def || 0) * 2 + (st.hp || 0) * 0.25 + (v.tier || 0) * 0.5;
        if (score > bs) { bs = score; best = k; }
      }
      if (best) out[slot] = best;
    }
    return out;
  }
  function equipBest(p) {
    const set = bestGear(p.cls), r = RARITY.length - 1;
    for (const [slot, item] of Object.entries(set)) {
      const prev = p.equip[slot];
      if (prev && prev.item !== item) world.addItem(p, prev.item, 1, prev.r || 0, prev.b || null);
      p.equip[slot] = { item, r, b: world.rollBonus(item, r) || undefined };
      if (!p.equip[slot].b) delete p.equip[slot].b;
    }
    world.recalcStats(p); p.hp = p.maxHp; p.selfDirty = true;
  }
  function setLevel(p, lv) {
    lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(lv)));
    p.level = lv; p.xp = 0;
    // skills above the new level's points are refunded
    let spent = Object.values(p.skills).reduce((a, b) => a + b, 0);
    if (spent > lv) { p.skills = {}; spent = 0; }
    world.recalcStats(p); p.hp = p.maxHp; p.selfDirty = true;
    world.evAt(p, { e: 'lvl', id: p.id, lv: p.level });
  }

  // a quiet, out-of-the-way patch of ground for the jail: walkable and as far from everything as can be
  let JAIL = null;
  function jailSpot() {
    if (JAIL) return JAIL;
    const m = world.map, T = m.town, places = [{ x: (T.x0 + T.x1) / 2, y: (T.y0 + T.y1) / 2 }, ...Object.values(m.spots || {})];
    let best = null, bd = -1;
    for (let y = 4; y < m.h - 4; y += 2) for (let x = 4; x < m.w - 4; x += 2) {
      if (isBlocked(m, x, y) || m.terrain[y * m.w + x] === TERRAIN.WATER) continue;
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (isBlocked(m, x + i, y + j)) { ok = false; break; }
      if (!ok) continue;
      const d = Math.min(...places.map((s) => Math.hypot(s.x - x, s.y - y)));
      if (d > bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    JAIL = best || world.map.playerSpawn;
    return JAIL;
  }

  // ---------------------------------------------------------------- holds on players
  function freeze(p, on) {
    p.frozen = on ? (on === 'jail' ? 'jail' : true) : false;
    if (on) { world.stopWork?.(p); world.dismount?.(p, true); p.travel = null; p.path = null; p.moveDir = null; p.target = null; p.pending = null; p.dash = null; }
    p.selfDirty = true;
  }
  function jail(p, minutes, by) {
    const until = minutes ? now() + mins(minutes) : 0;
    S.jails[key(p.name)] = { until, by, name: p.name }; save();
    const J = jailSpot();
    if (p.zone !== 'world') world.movePlayer(p, 'world', J.x, J.y); else world.teleport(p, J.x, J.y);
    freeze(p, 'jail');
    sys(p, `You have been put in jail by an admin${minutes ? ` for ${fmtLeft(until)}` : ''}.`);
  }
  function release(p, quiet) {
    delete S.jails[key(p.name)]; save();
    if (p.frozen === 'jail') {
      freeze(p, false);
      const s = world.map.playerSpawn;
      if (p.zone !== 'world') world.movePlayer(p, 'world', s.x, s.y); else world.teleport(p, s.x, s.y);
      if (!quiet) sys(p, 'You have been let out of jail. Behave!');
    }
  }
  function mute(p, minutes) { const until = minutes ? now() + mins(minutes) : 0; S.mutes[key(p.name)] = until || -1; save(); p.muted = true; sys(p, `An admin has muted you${minutes ? ` for ${fmtLeft(until)}` : ''}.`); }
  function unmute(p) { delete S.mutes[key(p.name)]; save(); p.muted = false; sys(p, 'You can chat again.'); }
  function godMode(p, on, restore) {
    if (on) {
      if (!p.godSave) p.godSave = { level: p.level, xp: p.xp, equip: JSON.parse(JSON.stringify(p.equip)), inv: JSON.parse(JSON.stringify(p.inv)) };
      p.god = true;
      setLevel(p, MAX_LEVEL);
      equipBest(p);
      p.hp = p.maxHp;
      sys(p, 'God mode: maximum level, the best gear for your class, and nothing can hurt you.');
    } else {
      p.god = false;
      if (restore && p.godSave) { p.level = p.godSave.level; p.xp = p.godSave.xp; p.equip = p.godSave.equip; p.inv = p.godSave.inv; world.recalcStats(p); p.hp = p.maxHp; }
      p.godSave = null; p.selfDirty = true;
      sys(p, restore ? 'God mode off: you are back to how you were before.' : 'God mode off: you keep your level and gear, but you can be hurt again.');
    }
  }

  // ---------------------------------------------------------------- joining
  // -> a reason to refuse the login, or null
  function checkBan(name, ip) {
    const b = S.bans[key(name)];
    if (b) { if (b.until && b.until < now()) { delete S.bans[key(name)]; save(); } else return `You are banned from this server${b.until ? ` for ${fmtLeft(b.until)} more` : ''}.${b.reason ? ` Reason: ${b.reason}` : ''}`; }
    const ib = ip && S.ipBans[ip];
    if (ib) { if (ib.until && ib.until < now()) { delete S.ipBans[ip]; save(); } else return `You are banned from this server${ib.until ? ` for ${fmtLeft(ib.until)} more` : ''}.${ib.reason ? ` Reason: ${ib.reason}` : ''}`; }
    return null;
  }
  function afterJoin(cid) {
    const p = playerOf(cid);
    if (!p) return;
    const k = key(p.name);
    if (S.admins[k]) { p.admin = true; sys(p, 'You are an admin here: press F8 (or type /admin) for the admin panel.'); }
    const mu = S.mutes[k];
    if (mu) { if (mu > 0 && mu < now()) { delete S.mutes[k]; save(); } else { p.muted = true; sys(p, 'You are muted by an admin.'); } }
    const j = S.jails[k];
    if (j) { if (j.until && j.until < now()) { delete S.jails[k]; save(); } else { const J = jailSpot(); world.teleport(p, J.x, J.y); freeze(p, 'jail'); sys(p, `You are still in jail${j.until ? ` for ${fmtLeft(j.until)}` : ''}.`); } }
  }

  // every few seconds: let people out when their time is up
  setInterval(() => {
    const t = now();
    for (const c of world.clients.values()) {
      const p = world.ents.get(c.entId); if (!p) continue;
      const k = key(p.name);
      if (p.muted && S.mutes[k] > 0 && S.mutes[k] < t) unmute(p);
      if (p.frozen === 'jail' && S.jails[k]?.until && S.jails[k].until < t) release(p);
    }
  }, 3000);

  // whispers: an admin's message to one player, who can answer with /r
  const lastWhisper = new Map();     // player name -> admin name
  function whisper(from, to, text) {
    world.privateEvent(to, { e: 'chat', from: `[Admin] ${from.name} whispers`, text, whisper: 1 });
    world.privateEvent(from, { e: 'chat', from: `To ${to.name}`, text, whisper: 1 });
    lastWhisper.set(key(to.name), from.name);
  }

  // ---------------------------------------------------------------- chat commands
  // -> true when handled (the text never reaches the public chat)
  const tries = new Map();
  function onChat(cid, text) {
    const p = playerOf(cid);
    if (!p) return false;
    const t = text.trim();
    const r = t.match(/^\/r(?:eply)?\s+(.+)$/i);
    if (r && lastWhisper.has(key(p.name))) {
      const adm = world.playerByName(lastWhisper.get(key(p.name)));
      if (!adm) { sys(p, 'That admin is offline.'); return true; }
      world.privateEvent(adm, { e: 'chat', from: `${p.name} replies`, text: r[1].slice(0, 200), whisper: 1 });
      world.privateEvent(p, { e: 'chat', from: `To [Admin] ${adm.name}`, text: r[1].slice(0, 200), whisper: 1 });
      return true;
    }
    const m = t.match(/^\/admin(?:\s+(\S+))?\s*$/i);
    if (!m) return false;
    if (!m[1]) { if (isAdmin(p)) reply(cid, { op: 'open' }); return true; }      // non-admins: nothing happens
    const tr = tries.get(cid) || { n: 0, until: 0 };
    if (tr.until > now()) { sys(p, 'Too many tries. Wait a few minutes.'); return true; }
    if (m[1] !== PASSWORD) {
      tr.n++; if (tr.n >= 5) { tr.until = now() + mins(10); tr.n = 0; }
      tries.set(cid, tr);
      log(p.name, 'tried a wrong admin password');
      sys(p, 'That isn\'t right.');
      return true;
    }
    S.admins[key(p.name)] = { name: p.name, rank: 'owner', by: 'password', at: new Date().toISOString() }; save();
    p.admin = true;
    log(p.name, 'became an admin (password)');
    sys(p, 'You are now an admin. Press F8 or type /admin to open the admin panel.');
    reply(cid, { op: 'open' });
    return true;
  }

  // ---------------------------------------------------------------- the panel's requests
  function onMessage(cid, m) {
    const me = playerOf(cid);
    if (!me || !isAdmin(me) || typeof m.op !== 'string') return;          // silence for everyone else
    me.admin = true;
    const t = Number.isInteger(m.id) ? byId(m.id) : null;
    const need = () => { if (!t) { reply(cid, { op: 'note', text: 'That player isn\'t online any more.' }); return false; } return true; };
    const done = (what, text) => { log(me.name, what); reply(cid, { op: 'note', text: text || what, ...overview() }); };
    const str = (v, n = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
    const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

    switch (m.op) {
      case 'resetme': { world.resetHero(me); return done(`reset ${me.name} to a new level 1 hero on Tutorial Island`); }
      case 'hello': return reply(cid, { op: 'hello', me: me.name, owner: isOwner(me), items: null, ...overview() });
      case 'list': return reply(cid, { op: 'list', ...overview() });
      case 'info': if (!need()) return; return reply(cid, { op: 'info', p: detail(t) });

      // ---- moving around
      case 'tp': {
        let x = num(m.x, 1, world.map.w - 2), y = num(m.y, 1, world.map.h - 2);
        // a wall, water or cliff: the nearest open ground instead
        if (isBlocked(world.map, Math.floor(x), Math.floor(y))) {
          let got = null;
          for (let r = 1; r <= 10 && !got; r++) for (let j = -r; j <= r && !got; j++) for (let i = -r; i <= r; i++) {
            if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
            if (!isBlocked(world.map, Math.floor(x) + i, Math.floor(y) + j)) { got = { x: Math.floor(x) + i + 0.5, y: Math.floor(y) + j + 0.5 }; break; }
          }
          if (!got) return reply(cid, { op: 'note', text: 'There\'s no open ground near there. Pick another spot.' });
          x = got.x; y = got.y;
        }
        if (me.zone !== 'world') world.movePlayer(me, 'world', x, y); else world.teleport(me, x, y);
        return done(`teleported to ${x.toFixed(0)}, ${y.toFixed(0)}`, `Teleported to ${x.toFixed(0)}, ${y.toFixed(0)}.`);
      }
      case 'floor': {
        const f = num(m.floor, 0, FLOORS.length - 1);
        world.enterDungeon(me, Math.round(f));
        return done(`went to dungeon floor ${f + 1}`, `Teleported to ${FLOORS[f].name}.`);
      }
      case 'goto': {
        if (!need()) return;
        if (t.zone !== me.zone || t.zone !== 'world') { if (!world.zones.get(t.zone)) return; world.movePlayer(me, t.zone, t.x + 0.8, t.y + 0.4); }
        else world.teleport(me, t.x + 0.8, t.y + 0.4);
        return done(`teleported to ${t.name}`, `Teleported to ${t.name}.`);
      }
      case 'summon': {
        if (!need()) return;
        if (t.zone !== me.zone) world.movePlayer(t, me.zone, me.x + 0.8, me.y + 0.4); else world.teleport(t, me.x + 0.8, me.y + 0.4);
        sys(t, 'An admin has brought you to them.');
        return done(`summoned ${t.name}`, `Brought ${t.name} to you.`);
      }
      case 'vanish': {
        me.vanish = !!m.on;
        if (me.vanish) for (const e of world.ents.values()) if (e.type === 'mob' && e.target === me.id) { e.target = null; e.state = 'return'; }
        return done(me.vanish ? 'vanished' : 'became visible', me.vanish ? 'You are invisible to players and monsters.' : 'Everyone can see you again.');
      }

      // ---- talking
      case 'whisper': {
        if (!need()) return; const text = str(m.text); if (!text) return;
        whisper(me, t, text);
        return done(`whispered to ${t.name}: ${text}`, `Whispered to ${t.name}.`);
      }
      case 'announce': {
        const text = str(m.text, 240); if (!text) return;
        world.broadcastEvent({ e: 'town', k: 'announce', text: `📣 ${text}` });
        return done(`announced: ${text}`, 'Announcement sent to everyone.');
      }

      // ---- moderation
      case 'kick': {
        if (!need()) return; if (t === me) return;
        const why = str(m.reason, 120);
        log(me.name, `kicked ${t.name}${why ? ` (${why})` : ''}`);
        kickSocket(t, `An admin removed you from the server.${why ? ` Reason: ${why}` : ''} You can join again.`);
        return reply(cid, { op: 'note', text: `Kicked ${t.name}.`, ...overview() });
      }
      case 'ban': {
        const name = t ? t.name : str(m.name, 16); if (!name) return;
        if (key(name) === key(me.name)) return reply(cid, { op: 'note', text: 'You can\'t ban yourself.' });
        if (S.admins[key(name)]?.rank === 'owner' && !isOwner(me)) return reply(cid, { op: 'note', text: 'Only an owner can ban an owner.' });
        const M = num(m.mins, 0, 60 * 24 * 365), until = M ? now() + mins(M) : 0, why = str(m.reason, 120);
        S.bans[key(name)] = { name, until, reason: why, by: me.name, at: new Date().toLocaleString() };
        let ipNote = '';
        if (m.ip && t) {
          const c = [...world.clients.entries()].find(([, cc]) => cc.entId === t.id), ip = c && meta.get(c[0])?.ip;
          if (ip && !/^(127\.|::1|::ffff:127\.)/.test(ip)) { S.ipBans[ip] = { name, until, reason: why, by: me.name, at: new Date().toLocaleString() }; ipNote = ' and their internet address'; }
          else ipNote = ' (their internet address couldn\'t be read, so only the hero is banned)';
        }
        save();
        if (t) kickSocket(t, `You have been banned from this server${M ? ` for ${fmtLeft(until)}` : ''}.${why ? ` Reason: ${why}` : ''}`);
        return done(`banned ${name}${ipNote} for ${M ? fmtLeft(until) : 'ever'}${why ? ` (${why})` : ''}`, `Banned ${name}${ipNote}.`);
      }
      case 'unban': {
        if (typeof m.ip === 'string' && S.ipBans[m.ip]) { const n = S.ipBans[m.ip].name; delete S.ipBans[m.ip]; save(); return done(`lifted the internet-address ban on ${n}`); }
        const k = key(m.name); if (!S.bans[k]) return;
        const n = S.bans[k].name; delete S.bans[k]; save();
        return done(`unbanned ${n}`, `${n} can play again.`);
      }
      case 'mute': if (!need()) return; mute(t, num(m.mins, 0, 60 * 24 * 30)); return done(`muted ${t.name} for ${m.mins ? m.mins + ' min' : 'ever'}`, `Muted ${t.name}.`);
      case 'unmute': if (!need()) return; unmute(t); return done(`unmuted ${t.name}`);
      case 'freeze': if (!need()) return; freeze(t, !!m.on); sys(t, m.on ? 'An admin has frozen you in place.' : 'You can move again.'); return done(`${m.on ? 'froze' : 'unfroze'} ${t.name}`);
      case 'jail': if (!need()) return; jail(t, num(m.mins, 0, 60 * 24 * 30), me.name); return done(`jailed ${t.name} for ${m.mins ? m.mins + ' min' : 'until released'}`, `${t.name} is in jail.`);
      case 'unjail': if (!need()) return; release(t); return done(`let ${t.name} out of jail`);
      case 'kill': {
        if (!need()) return; if (t.god) t.god = false;
        t.hp = 0; world.killPlayer(t); world.evAt(t, { e: 'fx', k: 'boom', x: t.x, y: t.y, r: 1 });
        return done(`killed ${t.name}`);
      }
      case 'clearbag': {
        if (!need()) return;
        t.inv = t.inv.map((s) => (s && ['hearthstone', 'mount_horse'].includes(s.item) ? s : null)); t.selfDirty = true;
        sys(t, 'An admin has emptied your bags.');
        return done(`emptied ${t.name}'s bags`);
      }

      // ---- gifts
      case 'heal': {
        if (!need()) return;
        if (t.anim === 'die') { t.hp = t.maxHp; world.setAnim(t, 'idle'); t.animLock = 0; }
        t.hp = t.maxHp; t.selfDirty = true;
        world.evAt(t, { e: 'heal', id: t.id, v: t.maxHp, potion: 1 });
        return done(`healed ${t.name}`);
      }
      case 'level': {
        if (!need()) return; setLevel(t, num(m.level, 1, MAX_LEVEL, t.level));
        sys(t, `An admin set you to level ${t.level}.`);
        return done(`set ${t.name} to level ${t.level}`);
      }
      case 'gold': {
        if (!need()) return;
        const a = Math.round(num(m.amount, -1e9, 1e9));
        t.gold = Math.max(0, t.gold + a); t.selfDirty = true;
        sys(t, a >= 0 ? `An admin gave you ${a} gold.` : `An admin took ${-a} gold from you.`);
        return done(`${a >= 0 ? 'gave' : 'took'} ${Math.abs(a)} gold ${a >= 0 ? 'to' : 'from'} ${t.name}`);
      }
      case 'item': {
        if (!need()) return;
        const item = str(m.item, 40); if (!ITEMS[item]) return reply(cid, { op: 'note', text: 'No such item.' });
        const def = ITEMS[item], qty = Math.round(num(m.qty, 1, def.stack ? 999 : 20, 1)), r = def.stack ? 0 : Math.round(num(m.r, 0, RARITY.length - 1));
        const ok = world.addItem(t, item, qty, r);
        if (!ok) return reply(cid, { op: 'note', text: `${t.name}'s bags are full.` });
        sys(t, `An admin gave you ${qty > 1 ? qty + ' × ' : ''}${gearName({ item, r })}.`);
        return done(`gave ${t.name} ${qty} × ${gearName({ item, r })}`);
      }
      case 'gear': {
        if (!need()) return; equipBest(t);
        sys(t, 'An admin gave you the best gear for your class. Your old gear is in your bags (if there was room).');
        return done(`gave ${t.name} the best ${CLASSES[t.cls].name} gear`);
      }
      case 'god': {
        if (!need()) return;
        if (!isAdmin(t)) return reply(cid, { op: 'note', text: 'God mode is only for admins. Make them an admin first.' });
        godMode(t, !!m.on, !!m.restore);
        return done(`${m.on ? 'turned on' : 'turned off'} god mode for ${t.name}${!m.on && m.restore ? ' (restored)' : ''}`);
      }
      case 'spawn': {
        const kind = str(m.kind, 30); if (!MOBS[kind]) return;
        const at = t || me, n = Math.round(num(m.n, 1, 10, 1));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 2;
          let x = at.x + Math.cos(a) * d, y = at.y + Math.sin(a) * d;
          if (isBlocked(world.mapOf(at), Math.floor(x), Math.floor(y))) { x = at.x + 1.5; y = at.y; }
          world.spawnMob(kind, x, y, at.zone, { summoned: true });
        }
        return done(`spawned ${n} × ${MOBS[kind].name} near ${at.name}`);
      }

      // ---- the server
      case 'weather': { const w = Math.round(num(m.w, 0, 3)); world.weather = w; world.weatherUntil = world.tick + TICK_RATE * 60 * 5; world.broadcastEvent({ e: 'sys', text: `The weather turns: ${['clear', 'rain', 'storm', 'snow'][w]}.` }); return done(`set the weather to ${['clear', 'rain', 'storm', 'snow'][w]}`); }
      case 'time': { world.tod = num(m.tod, 0, 0.999); return done(`set the time of day`); }
      case 'addadmin': {
        if (!isOwner(me)) return reply(cid, { op: 'note', text: 'Only an owner (someone who used the admin password) can make admins.' });
        const name = t ? t.name : str(m.name, 16); if (!name) return;
        S.admins[key(name)] = { name, rank: 'admin', by: me.name, at: new Date().toISOString() }; save();
        const p = world.playerByName(name); if (p) { p.admin = true; sys(p, 'You are now an admin: press F8 (or type /admin) for the admin panel.'); }
        return done(`made ${name} an admin`);
      }
      case 'deladmin': {
        if (!isOwner(me)) return reply(cid, { op: 'note', text: 'Only an owner can remove admins.' });
        const k = key(m.name); if (!S.admins[k] || k === key(me.name)) return;
        const n = S.admins[k].name; delete S.admins[k]; save();
        const p = world.playerByName(n); if (p) { p.admin = false; p.vanish = false; if (p.god) godMode(p, false, false); }
        return done(`removed ${n} as an admin`);
      }
    }
  }

  return { checkBan, afterJoin, onChat, onMessage, isAdmin: (cid) => isAdmin(playerOf(cid)) };
}
