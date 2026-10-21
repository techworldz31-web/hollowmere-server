// Parties: up to five heroes travelling together (invite, accept, leave, kick, promote).
// Installed onto World's prototype (see the bottom of world.js).
//
// Members are kept by name, so a party survives someone's connection dropping: they show as
// offline and slot straight back in when they log in again. A party with nobody online for
// ten minutes is dissolved. Party members near a kill all get its experience and the quest
// credit for it; a party going into the Hollow Deep shares one copy of each floor.
import { TICK_RATE } from './constants.js';
import { S2C } from './protocol.js';
import { ITEMS } from './content.js';

const T = (s) => Math.round(s * TICK_RATE);
export const PARTY_MAX = 5;
export const PARTY_SHARE_RANGE = 40;      // tiles: how close you must be to share a kill
const INVITE_SECONDS = 60;
const key = (name) => String(name || '').trim().toLowerCase();

export const partyMethods = {
  // ---------------------------------------------------------------- lookups
  partyOf(p) { return p?.partyId != null ? this.parties.get(p.partyId) || null : null; },
  playerByName(name) {
    const k = key(name);
    for (const c of this.clients.values()) { const e = this.ents.get(c.entId); if (e && key(e.name) === k) return e; }
    return null;
  },
  partyMembersOnline(party) { return party.members.map((n) => this.playerByName(n)).filter(Boolean); },
  // party members (including p) close enough to share a kill at x, y
  partyNear(p, x, y, zone) {
    const party = this.partyOf(p);
    if (!party) return [p];
    return this.partyMembersOnline(party).filter((m) => m.zone === zone && Math.hypot(m.x - x, m.y - y) <= PARTY_SHARE_RANGE);
  },
  partySay(party, ev) { for (const m of this.partyMembersOnline(party)) this.privateEvent(m, ev); },
  partyDirty(party) { if (party) party.dirty = true; },

  // ---------------------------------------------------------------- commands
  partyCommand(p, m) {
    switch (m.op) {
      case 'invite': return this.partyInvite(p, m.name);
      case 'accept': return this.partyAccept(p);
      case 'decline': return this.partyDecline(p);
      case 'leave': return this.partyLeave(p);
      case 'kick': return this.partyKick(p, m.name);
      case 'lead': return this.partyPromote(p, m.name);
    }
  },

  partyInvite(p, name) {
    const sys = (text) => this.privateEvent(p, { e: 'sys', text });
    const t = this.playerByName(name);
    if (!t) return sys(`There's nobody called ${String(name || '').trim() || 'that'} online.`);
    if (t.id === p.id) return sys('You can\'t invite yourself.');
    let party = this.partyOf(p);
    if (party && key(party.leader) !== key(p.name)) return sys('Only the party leader can invite people.');
    if (party && party.members.length >= PARTY_MAX) return sys(`Your party is full (${PARTY_MAX}).`);
    if (this.partyOf(t)) return sys(`${t.name} is already in a party.`);
    if (t.partyInvite && t.partyInvite.until > this.tick && key(t.partyInvite.from) !== key(p.name)) return sys(`${t.name} is thinking about another invitation. Try again in a moment.`);
    t.partyInvite = { from: p.name, until: this.tick + T(INVITE_SECONDS) };
    this.privateEvent(t, { e: 'pinvite', from: p.name, cls: p.cls, lv: p.level, sec: INVITE_SECONDS });
    sys(`You invited ${t.name} to your party.`);
  },

  partyAccept(p) {
    const inv = p.partyInvite; p.partyInvite = null;
    if (!inv || inv.until < this.tick) return this.privateEvent(p, { e: 'sys', text: 'That invitation has run out.' });
    const host = this.playerByName(inv.from);
    if (!host) return this.privateEvent(p, { e: 'sys', text: `${inv.from} isn't online any more.` });
    if (this.partyOf(p)) return;
    let party = this.partyOf(host);
    if (!party) {
      party = { id: this.nextParty++, leader: host.name, members: [host.name], dirty: true, emptySince: null };
      this.parties.set(party.id, party);
      host.partyId = party.id; this.partyByName.set(key(host.name), party.id);
    }
    if (key(party.leader) !== key(host.name)) return this.privateEvent(p, { e: 'sys', text: `${host.name} is no longer leading a party.` });
    if (party.members.length >= PARTY_MAX) return this.privateEvent(p, { e: 'sys', text: 'That party is full.' });
    party.members.push(p.name); p.partyId = party.id; this.partyByName.set(key(p.name), party.id);
    this.partySay(party, { e: 'sys', text: `${p.name} joins the party.` });
    this.partyDirty(party);
  },

  partyDecline(p) {
    const inv = p.partyInvite; p.partyInvite = null;
    const host = inv && this.playerByName(inv.from);
    if (host) this.privateEvent(host, { e: 'sys', text: `${p.name} declines your invitation.` });
  },

  partyRemove(party, name, why) {
    const k = key(name);
    party.members = party.members.filter((n) => key(n) !== k);
    this.partyByName.delete(k);
    const e = this.playerByName(name);
    if (e) { e.partyId = null; this.privateEvent(e, { e: 'party', party: null }); }
    if (why) this.partySay(party, { e: 'sys', text: why });
    if (party.members.length <= 1) return this.partyDisband(party, party.members.length ? 'Your party has broken up.' : null);
    if (key(party.leader) === k) { party.leader = party.members[0]; this.partySay(party, { e: 'sys', text: `${party.leader} now leads the party.` }); }
    this.partyDirty(party);
  },

  partyDisband(party, why) {
    for (const n of party.members) {
      this.partyByName.delete(key(n));
      const e = this.playerByName(n);
      if (e) { e.partyId = null; if (why) this.privateEvent(e, { e: 'sys', text: why }); this.privateEvent(e, { e: 'party', party: null }); }
    }
    this.parties.delete(party.id);
  },

  partyLeave(p) {
    const party = this.partyOf(p);
    if (!party) return;
    this.privateEvent(p, { e: 'sys', text: 'You leave the party.' });
    this.partyRemove(party, p.name, `${p.name} leaves the party.`);
  },

  partyKick(p, name) {
    const party = this.partyOf(p);
    if (!party) return;
    if (key(party.leader) !== key(p.name)) return this.privateEvent(p, { e: 'sys', text: 'Only the party leader can remove people.' });
    const who = party.members.find((n) => key(n) === key(name));
    if (!who || key(who) === key(p.name)) return;
    const e = this.playerByName(who);
    if (e) this.privateEvent(e, { e: 'sys', text: 'You have been removed from the party.' });
    this.partyRemove(party, who, `${who} was removed from the party.`);
  },

  partyPromote(p, name) {
    const party = this.partyOf(p);
    if (!party || key(party.leader) !== key(p.name)) return;
    const who = party.members.find((n) => key(n) === key(name));
    if (!who) return;
    party.leader = who;
    this.partySay(party, { e: 'sys', text: `${who} now leads the party.` });
    this.partyDirty(party);
  },

  // ---------------------------------------------------------------- joining and leaving the game
  partyOnJoin(p) {
    const id = this.partyByName.get(key(p.name));
    const party = id != null ? this.parties.get(id) : null;
    if (!party) return;
    p.partyId = party.id; party.emptySince = null;
    this.partySay(party, { e: 'sys', text: `${p.name} is back.` });
    this.partyDirty(party);
  },
  partyOnLeave(p) {
    const party = this.partyOf(p);
    if (!party) return;
    this.partySay(party, { e: 'sys', text: `${p.name} has gone offline.` });
    this.partyDirty(party);
  },

  // ---------------------------------------------------------------- the frames
  // each member's portrait, level and health for the party frames; sent to members 4 times a second
  partyInfo(party, viewer) {
    return {
      lead: party.leader,
      m: party.members.map((n) => {
        const e = this.playerByName(n);
        if (!e) return { n, on: 0 };
        const tier = (k) => (e.equip[k] ? ITEMS[e.equip[k].item]?.tier || 0 : 0);
        const o = { n: e.name, on: 1, id: e.id, cls: e.cls, lv: e.level, hp: Math.max(0, Math.round(e.hp)), mh: e.maxHp, mp: Math.floor(e.mp ?? 0), mm: e.maxMp || 0, dead: e.anim === 'die' ? 1 : 0,
          g: [tier('weapon'), tier('armor'), e.dye, tier('helm'), tier('gloves'), tier('boots')] };
        if (e.zone === viewer.zone) { o.x = Math.round(e.x * 10) / 10; o.y = Math.round(e.y * 10) / 10; o.near = Math.hypot(e.x - viewer.x, e.y - viewer.y) <= PARTY_SHARE_RANGE ? 1 : 0; }
        else o.away = e.zone === 'world' ? 'overworld' : this.zones.get(e.zone)?.kind === 'starter' ? 'Tutorial Island' : 'the Hollow Deep';
        const b = [];
        for (const [k, v] of Object.entries(e.buffs || {})) if (v.until > this.tick) b.push([k, Math.ceil((v.until - this.tick) / TICK_RATE), v.from || null]);
        if (b.length) o.b = b.slice(0, 6);
        return o;
      }),
    };
  },
  updateParties() {
    for (const party of this.parties.values()) {
      const online = this.partyMembersOnline(party);
      if (!online.length) {
        party.emptySince ??= this.tick;
        if (this.tick - party.emptySince > T(600)) this.partyDisband(party, null);
        continue;
      }
      for (const m of online) this.privateEvent(m, { e: 'party', party: this.partyInfo(party, m) });
      party.dirty = false;
    }
    for (const c of this.clients.values()) {
      const p = this.ents.get(c.entId);
      if (p?.partyInvite && p.partyInvite.until < this.tick) {
        const from = p.partyInvite.from; p.partyInvite = null;
        this.privateEvent(p, { e: 'pinvite', from: null });
        const host = this.playerByName(from);
        if (host) this.privateEvent(host, { e: 'sys', text: `${p.name} didn't answer your invitation.` });
      }
    }
  },
};
