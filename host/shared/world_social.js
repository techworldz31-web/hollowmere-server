// Guilds, friends and chat channels: the community side of Hollowmere.
// Installed onto World's prototype (see the bottom of world.js).
//
// Guilds: a name and a tag shown with members' names, five ranks (Guild Master, Officer,
// Veteran, Member, Recruit), guild chat (/g), a message of the day and a shared guild bank.
// They are kept by member name, so they survive logging out; the online server stores them
// in guilds.json (hooks.loadGuilds / saveGuilds). In single-player your guild travels in
// your own save.
//
// Friends: a list of names per hero, with who is online and where, and a note when one logs in.
// Chat: Say (people around you), World (/1, everyone), Trade (/2), Party (/p), Guild (/g),
// and whispers (/w Name message, /r to reply).
import { TICK_RATE } from './constants.js';
import { ITEMS, itemName } from './content.js';
import { REGIONS } from './questline.js';

const T = (s) => Math.round(s * TICK_RATE);
const key = (name) => String(name || '').trim().toLowerCase();
export const GUILD_RANKS = ['Guild Master', 'Officer', 'Veteran', 'Member', 'Recruit'];
export const GUILD_COST = 50;            // gold to found a guild
export const GUILD_BANK_SLOTS = 40;
const SAY_RANGE = 30;
const MAX_FRIENDS = 50;
// what each rank may do (lower number = higher rank)
const CAN = {
  invite: (r) => r <= 1, kick: (r) => r <= 1, promote: (r) => r <= 1, motd: (r) => r <= 1,
  withdraw: (r) => r <= 2, deposit: (r) => r <= 4, gold: (r) => r <= 1,
};

export const socialMethods = {
  // ---------------------------------------------------------------- setup and storage
  initSocial() {
    this.guilds = new Map();           // key(name) -> guild
    this.guildInvites = new Map();     // invitee key -> { guild, from, until }
    this.guildGen = 1;
    const saved = this.hooks.loadGuilds?.();
    if (saved && typeof saved === 'object') for (const g of Object.values(saved)) this.restoreGuild(g);
  },
  restoreGuild(g) {
    if (!g || typeof g.name !== 'string' || typeof g.tag !== 'string') return null;
    const G = { name: g.name.slice(0, 24), tag: g.tag.slice(0, 5), motd: String(g.motd || '').slice(0, 140), created: g.created || Date.now(), members: {}, bank: { items: new Array(GUILD_BANK_SLOTS).fill(null), gold: 0 }, log: [] };
    for (const [k, m] of Object.entries(g.members || {})) if (m && typeof m.name === 'string') G.members[key(k)] = { name: m.name, rank: Math.max(0, Math.min(4, m.rank | 0)), joined: m.joined || Date.now() };
    if (!Object.keys(G.members).length) return null;
    if (g.bank) {
      if (Number.isInteger(g.bank.gold) && g.bank.gold >= 0) G.bank.gold = g.bank.gold;
      (g.bank.items || []).slice(0, GUILD_BANK_SLOTS).forEach((it, i) => { if (it && ITEMS[it.item]) G.bank.items[i] = { item: it.item, qty: Math.max(1, it.qty | 0), ...(it.r ? { r: it.r } : {}), ...(it.b ? { b: it.b } : {}) }; });
    }
    if (Array.isArray(g.log)) G.log = g.log.slice(-30).map(String);
    this.guilds.set(key(G.name), G);
    return G;
  },
  saveGuilds() {
    this.guildsDirty = false;
    this.guildGen = (this.guildGen || 0) + 1;          // membership may have changed: look again
    if (this.hooks.saveGuilds) this.hooks.saveGuilds(Object.fromEntries([...this.guilds].map(([k, g]) => [k, g])));
  },
  guildOf(p) {
    if (!p) return null;
    const k = key(p.name);
    if (p.guildKey) { const g = this.guilds.get(p.guildKey); if (g?.members[k]) return g; p.guildKey = null; }
    if (p.noGuildGen === this.guildGen) return null;          // checked already since the last change
    for (const [gk, g] of this.guilds) if (g.members[k]) { p.guildKey = gk; return g; }
    p.noGuildGen = this.guildGen;
    return null;
  },
  guildMembersOnline(g) {
    const out = [];
    for (const c of this.clients.values()) { const e = this.ents.get(c.entId); if (e && g.members[key(e.name)]) out.push(e); }
    return out;
  },
  guildLog(g, text) { g.log.push(`${new Date().toISOString().slice(0, 10)} ${text}`); if (g.log.length > 30) g.log.shift(); },
  // who is in it, their rank, and who is online right now (sent to every member when it changes)
  guildView(g, forP) {
    const online = new Map(this.guildMembersOnline(g).map((e) => [key(e.name), e]));
    const members = Object.entries(g.members).map(([k, m]) => { const e = online.get(k); return { n: m.name, r: m.rank, on: e ? 1 : 0, lv: e?.level, c: e?.cls, z: e ? this.whereName(e) : '' }; })
      .sort((a, b) => b.on - a.on || a.r - b.r || a.n.localeCompare(b.n));
    const me = g.members[key(forP.name)];
    return { name: g.name, tag: g.tag, motd: g.motd, rank: me?.rank ?? 4, members, bank: g.bank, log: g.log.slice(-12), created: g.created };
  },
  whereName(e) {
    if (e.zone !== 'world') return this.zones.get(e.zone)?.kind === 'starter' ? 'Tutorial Island' : 'The Hollow Deep';
    return e.region && REGIONS[e.region] ? REGIONS[e.region].name : 'Hollowmere';
  },
  pushGuild(g) {
    for (const e of this.guildMembersOnline(g)) this.privateEvent(e, { e: 'guild', g: this.guildView(g, e) });
    this.guildsDirty = true;
  },
  guildSay(g, ev) { for (const e of this.guildMembersOnline(g)) this.privateEvent(e, ev); },

  // ---------------------------------------------------------------- guild actions
  guildOp(p, m) {
    const g = this.guildOf(p), myRank = g ? g.members[key(p.name)].rank : 9;
    const say = (text) => this.privateEvent(p, { e: 'sys', text });
    switch (m.op) {
      case 'create': {
        if (g) return say('You are already in a guild. Leave it first.');
        const name = String(m.name || '').replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
        const tag = String(m.tag || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase();
        if (name.length < 3) return say('A guild name needs at least 3 letters.');
        if (tag.length < 2) return say('A guild tag needs 2 to 5 letters or numbers.');
        if (this.guilds.has(key(name))) return say('There is already a guild by that name.');
        if ([...this.guilds.values()].some((x) => x.tag === tag)) return say('That tag is taken. Pick another.');
        if (p.gold < GUILD_COST) return say(`Founding a guild costs ${GUILD_COST} gold.`);
        p.gold -= GUILD_COST; p.selfDirty = true;
        this.privateEvent(p, { e: 'gold', v: -GUILD_COST });
        const G = this.restoreGuild({ name, tag, motd: `Welcome to ${name}!`, members: { [key(p.name)]: { name: p.name, rank: 0 } } });
        this.guildLog(G, `${p.name} founded the guild.`);
        p.guildKey = key(name);
        this.broadcastEvent({ e: 'town', k: 'guild', text: `${p.name} has founded the guild <${tag}> ${name}!` });
        this.pushGuild(G); this.saveGuilds(); p.tagDirty = true;
        return;
      }
      case 'invite': {
        if (!g || !CAN.invite(myRank)) return say('Only the Guild Master and officers can invite.');
        const t = this.playerByName(m.name);
        if (!t) return say(`${m.name || 'They'} isn't online.`);
        if (this.guildOf(t)) return say(`${t.name} is already in a guild.`);
        this.guildInvites.set(key(t.name), { guild: key(g.name), from: p.name, until: this.tick + T(60) });
        this.privateEvent(t, { e: 'ginvite', from: p.name, guild: g.name, tag: g.tag, sec: 60 });
        return say(`You invited ${t.name} to <${g.tag}> ${g.name}.`);
      }
      case 'accept': case 'decline': {
        const inv = this.guildInvites.get(key(p.name));
        this.guildInvites.delete(key(p.name));
        if (!inv || inv.until < this.tick) return say('That invitation has run out.');
        const G = this.guilds.get(inv.guild); if (!G) return say('That guild no longer exists.');
        const from = this.playerByName(inv.from);
        if (m.op === 'decline') { if (from) this.privateEvent(from, { e: 'sys', text: `${p.name} declined your guild invitation.` }); return; }
        if (g) return say('You are already in a guild.');
        G.members[key(p.name)] = { name: p.name, rank: 4, joined: Date.now() };
        p.guildKey = inv.guild; p.tagDirty = true;
        this.guildLog(G, `${p.name} joined (invited by ${inv.from}).`);
        this.guildSay(G, { e: 'chat', from: '', text: `${p.name} has joined the guild!`, guild: 1, sys: 1 });
        this.pushGuild(G); this.saveGuilds();
        return;
      }
      case 'leave': {
        if (!g) return say('You are not in a guild.');
        const k = key(p.name);
        if (myRank === 0 && Object.keys(g.members).length > 1) {
          // the Guild Master leaving hands the guild to the highest-ranked member who stays
          const heir = Object.entries(g.members).filter(([mk]) => mk !== k).sort((a, b) => a[1].rank - b[1].rank)[0];
          heir[1].rank = 0;
          this.guildSay(g, { e: 'chat', from: '', text: `${heir[1].name} is the new Guild Master.`, guild: 1, sys: 1 });
        }
        delete g.members[k];
        this.guildSay(g, { e: 'chat', from: '', text: `${p.name} has left the guild.`, guild: 1, sys: 1 });
        this.guildLog(g, `${p.name} left.`);
        p.guildKey = null; p.tagDirty = true;
        this.privateEvent(p, { e: 'guild', g: null });
        if (!Object.keys(g.members).length) this.guilds.delete(key(g.name)); else this.pushGuild(g);
        this.saveGuilds();
        return;
      }
      case 'kick': case 'promote': case 'demote': {
        if (!g || !CAN[m.op === 'kick' ? 'kick' : 'promote'](myRank)) return say('Your rank cannot do that.');
        const k = key(m.name), t = g.members[k];
        if (!t || k === key(p.name)) return say('No such member.');
        if (t.rank <= myRank) return say('You can only manage members ranked below you.');
        if (m.op === 'kick') {
          delete g.members[k];
          const te = this.playerByName(t.name);
          if (te) { te.guildKey = null; te.tagDirty = true; this.privateEvent(te, { e: 'guild', g: null }); this.privateEvent(te, { e: 'sys', text: `You were removed from ${g.name}.` }); }
          this.guildSay(g, { e: 'chat', from: '', text: `${t.name} was removed from the guild by ${p.name}.`, guild: 1, sys: 1 });
          this.guildLog(g, `${p.name} removed ${t.name}.`);
        } else {
          const nr = Math.max(myRank + 1, Math.min(4, t.rank + (m.op === 'promote' ? -1 : 1)));
          if (nr === t.rank) return say(`${t.name} is already ${GUILD_RANKS[t.rank]}.`);
          t.rank = nr;
          this.guildSay(g, { e: 'chat', from: '', text: `${t.name} is now ${GUILD_RANKS[nr]}.`, guild: 1, sys: 1 });
          this.guildLog(g, `${p.name} made ${t.name} ${GUILD_RANKS[nr]}.`);
        }
        this.pushGuild(g); this.saveGuilds();
        return;
      }
      case 'lead': {
        if (!g || myRank !== 0) return say('Only the Guild Master can hand over the guild.');
        const t = g.members[key(m.name)]; if (!t || key(m.name) === key(p.name)) return say('No such member.');
        t.rank = 0; g.members[key(p.name)].rank = 1;
        this.guildSay(g, { e: 'chat', from: '', text: `${t.name} is the new Guild Master.`, guild: 1, sys: 1 });
        this.guildLog(g, `${p.name} handed the guild to ${t.name}.`);
        this.pushGuild(g); this.saveGuilds();
        return;
      }
      case 'motd': {
        if (!g || !CAN.motd(myRank)) return say('Only the Guild Master and officers can set the message of the day.');
        g.motd = String(m.text || '').replace(/[\u0000-\u001f]/g, '').slice(0, 140);
        this.guildSay(g, { e: 'chat', from: '', text: `Guild message: ${g.motd}`, guild: 1, sys: 1 });
        this.pushGuild(g); this.saveGuilds();
        return;
      }
      case 'disband': {
        if (!g || myRank !== 0) return say('Only the Guild Master can disband the guild.');
        for (const e of this.guildMembersOnline(g)) { e.guildKey = null; e.tagDirty = true; this.privateEvent(e, { e: 'guild', g: null }); this.privateEvent(e, { e: 'sys', text: `${g.name} has been disbanded.` }); }
        // what was in the bank goes back to the Guild Master's vault as gold (items are lost)
        p.bank.gold += g.bank.gold; p.selfDirty = true;
        this.guilds.delete(key(g.name)); this.saveGuilds();
        return;
      }
      // ---- the guild bank
      case 'dep': {
        if (!g || !CAN.deposit(myRank)) return say('You cannot use the guild bank.');
        if (!this.nearBanker(p)) return say('The guild bank is kept at the Bank of Hollowmere. Speak to a clerk there.');
        const it = p.inv[m.slot]; if (!it) return;
        const d = ITEMS[it.item];
        if (d.type === 'quest' || d.nosell || d.type === 'hearth') return say("That can't go in the guild bank.");
        let i = d.stack ? g.bank.items.findIndex((x) => x && x.item === it.item && !x.r && (x.qty + it.qty) <= (d.stack || 1)) : -1;
        if (i < 0) i = g.bank.items.findIndex((x) => !x);
        if (i < 0) return say('The guild bank is full.');
        if (g.bank.items[i]) g.bank.items[i].qty += it.qty; else g.bank.items[i] = { ...it };
        p.inv[m.slot] = null; p.selfDirty = true;
        this.guildLog(g, `${p.name} deposited ${itemName(it)}${it.qty > 1 ? ' x' + it.qty : ''}.`);
        this.pushGuild(g);
        return;
      }
      case 'wd': {
        if (!g || !CAN.withdraw(myRank)) return say('Only Veterans and above can take from the guild bank.');
        if (!this.nearBanker(p)) return say('The guild bank is kept at the Bank of Hollowmere. Speak to a clerk there.');
        const it = g.bank.items[m.i]; if (!it) return;
        if (!this.addItem(p, it.item, it.qty, it.r, it.b)) return say('Your pack is full.');
        g.bank.items[m.i] = null;
        this.guildLog(g, `${p.name} took ${itemName(it)}${it.qty > 1 ? ' x' + it.qty : ''}.`);
        this.pushGuild(g);
        return;
      }
      case 'depgold': case 'wdgold': {
        const amt = Math.floor(Number(m.amount) || 0);
        if (!g || amt <= 0) return;
        if (!this.nearBanker(p)) return say('The guild bank is kept at the Bank of Hollowmere. Speak to a clerk there.');
        if (m.op === 'depgold') {
          if (!CAN.deposit(myRank) || p.gold < amt) return say('Not enough gold.');
          p.gold -= amt; g.bank.gold += amt;
          this.guildLog(g, `${p.name} deposited ${amt} gold.`);
        } else {
          if (!CAN.gold(myRank)) return say('Only the Guild Master and officers can take gold from the guild bank.');
          if (g.bank.gold < amt) return say('The guild bank does not hold that much.');
          g.bank.gold -= amt; p.gold += amt;
          this.guildLog(g, `${p.name} took ${amt} gold.`);
        }
        p.selfDirty = true;
        this.pushGuild(g);
        return;
      }
      case 'view': if (g) this.privateEvent(p, { e: 'guild', g: this.guildView(g, p) }); else this.privateEvent(p, { e: 'guild', g: null }); return;
    }
  },
  nearBanker(p) {
    for (const e of this.ents.values()) if (e.type === 'npc' && e.zone === p.zone && /clerk|banker/.test(e.kind) && Math.hypot(e.x - p.x, e.y - p.y) < 5) return true;
    return false;
  },

  // ---------------------------------------------------------------- friends
  friendOp(p, m) {
    const say = (text) => this.privateEvent(p, { e: 'sys', text });
    p.friends ||= [];
    const name = String(m.name || '').trim().slice(0, 16);
    if (m.op === 'add') {
      if (!name || key(name) === key(p.name)) return;
      if (p.friends.some((f) => key(f) === key(name))) return say(`${name} is already your friend.`);
      if (p.friends.length >= MAX_FRIENDS) return say('Your friends list is full.');
      const t = this.playerByName(name);
      if (!t && !this.hooks.loadPlayer?.(name) && !this.trustClientSaves) return say(`There is no hero called ${name}.`);
      p.friends.push(t ? t.name : name);
      say(`${t ? t.name : name} is now on your friends list.`);
      if (t) this.privateEvent(t, { e: 'sys', text: `${p.name} added you as a friend.` });
    } else if (m.op === 'remove') {
      p.friends = p.friends.filter((f) => key(f) !== key(name));
      say(`${name} was removed from your friends list.`);
    }
    p.selfDirty = true;
    this.pushFriends(p);
  },
  friendsView(p) {
    return (p.friends || []).map((n) => { const e = this.playerByName(n); return { n: e ? e.name : n, on: e ? 1 : 0, afk: e?.afk ? 1 : 0, lv: e?.level, c: e?.cls, z: e ? this.whereName(e) : '' }; })
      .sort((a, b) => b.on - a.on || a.n.localeCompare(b.n));
  },
  pushFriends(p) { this.privateEvent(p, { e: 'friends', f: this.friendsView(p) }); },
  // someone came online or left: their friends and guild hear about it
  socialPresence(p, online) {
    for (const c of this.clients.values()) {
      const e = this.ents.get(c.entId);
      if (!e || e === p) continue;
      if ((e.friends || []).some((f) => key(f) === key(p.name))) {
        this.privateEvent(e, { e: 'sys', text: `Your friend ${p.name} has ${online ? 'come online' : 'gone offline'}.`, friend: 1 });
        this.privateEvent(e, { e: 'friendon', name: p.name, on: online ? 1 : 0 });
        this.pushFriends(e);
      }
    }
    const g = this.guildOf(p);
    if (g) {
      this.guildSay(g, { e: 'chat', from: '', text: `${p.name} has ${online ? 'come online' : 'gone offline'}.`, guild: 1, sys: 1 });
      if (online) {
        this.privateEvent(p, { e: 'guild', g: this.guildView(g, p) });
        if (g.motd) this.privateEvent(p, { e: 'chat', from: '', text: `Guild message: ${g.motd}`, guild: 1, sys: 1 });
      }
      for (const e of this.guildMembersOnline(g)) if (e !== p) this.privateEvent(e, { e: 'guild', g: this.guildView(g, e) });
    }
    if (online) this.pushFriends(p);
  },
  socialTick() {
    if (this.guildsDirty && this.tick % T(5) === 0) this.saveGuilds();
    for (const [k, inv] of this.guildInvites) if (inv.until < this.tick) this.guildInvites.delete(k);
  },

  // ---------------------------------------------------------------- chat channels
  // -> true when the text was a channel message (and has been sent)
  chatChannel(p, text) {
    let m;
    if ((m = text.match(/^\/(1|world|w1)\s+(.+)$/i))) { this.broadcastEvent({ e: 'chat', from: p.name, text: m[2], ch: 'world', tag: this.guildOf(p)?.tag }); return true; }
    if ((m = text.match(/^\/(2|tr)\s+(.+)$/i))) { this.broadcastEvent({ e: 'chat', from: p.name, text: m[2], ch: 'trade', tag: this.guildOf(p)?.tag }); return true; }
    if ((m = text.match(/^\/(g|guild|gc)\s+(.+)$/i))) {
      const g = this.guildOf(p);
      if (!g) this.privateEvent(p, { e: 'sys', text: 'You are not in a guild. Open the Social window (X) to found or join one.' });
      else this.guildSay(g, { e: 'chat', from: p.name, text: m[2], guild: 1 });
      return true;
    }
    if ((m = text.match(/^\/(s|say)\s+(.+)$/i))) { this.sayNear(p, m[2]); return true; }
    if ((m = text.match(/^\/(w|whisper|tell|msg)\s+(\S+)\s+(.+)$/i)) || (m = text.match(/^\/(r|reply)\s+()(.+)$/i))) {
      const toName = m[1].toLowerCase().startsWith('r') ? p.replyTo : m[2];
      const t = toName && this.playerByName(toName);
      if (!t) { this.privateEvent(p, { e: 'sys', text: toName ? `${toName} isn't online.` : 'Nobody has whispered to you yet.' }); return true; }
      this.privateEvent(t, { e: 'chat', from: p.name, text: m[3], whisper: 1 });
      if (t.afk) this.privateEvent(p, { e: 'chat', from: t.name, text: '(away from keyboard, will reply later)', whisper: 1, auto: 1 });
      this.privateEvent(p, { e: 'chat', from: `To ${t.name}`, text: m[3], whisper: 1, out: 1 });
      t.replyTo = p.name;
      return true;
    }
    return false;
  },
  // plain chat: everyone within a stone's throw (and in the same place)
  sayNear(p, text) {
    const ev = { e: 'chat', from: p.name, text, ch: 'say', tag: this.guildOf(p)?.tag };
    for (const c of this.clients.values()) {
      const e = this.ents.get(c.entId);
      if (e && e.zone === p.zone && Math.hypot(e.x - p.x, e.y - p.y) <= SAY_RANGE) this.privateEvent(e, ev);
    }
    this.evAt?.(p, { e: 'say', id: p.id, text: text.slice(0, 80) });
  },
};
