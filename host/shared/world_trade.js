// Getting rid of things and swapping them: destroy an item, drop it on the ground (never in
// town), and trade with another player face to face (WoW style: both put things in, both
// accept, any change un-accepts, then everything swaps at once). Installed onto World.
import { TICK_RATE } from './constants.js';
import { ITEMS, itemName } from './content.js';

const T = (s) => Math.round(s * TICK_RATE);
export const TRADE_SLOTS = 6;
export const TRADE_RANGE = 10;
const TRADE_INVITE_SECONDS = 30;
const DROP_LIFE = 300;                       // seconds a dropped item lies on the ground
const key = (n) => String(n || '').trim().toLowerCase();
// things you can never throw away or hand over
export const keepsake = (item) => { const d = ITEMS[item]; return !d || d.type === 'quest' || d.type === 'hearth' || item === 'hearthstone'; };
const entryOf = (s) => ({ item: s.item, qty: s.qty, ...(s.r ? { r: s.r } : {}), ...(s.b ? { b: s.b } : {}) });
const same = (a, b) => !!a && !!b && a.item === b.item && a.qty === b.qty && (a.r || 0) === (b.r || 0);

export const swapMethods = {
  // ---------------------------------------------------------------- destroy & drop
  takeFromSlot(p, slot, qty) {
    const s = p.inv[slot];
    if (!s) return null;
    qty = Math.max(1, Math.min(s.qty || 1, Math.floor(qty) || s.qty || 1));
    const out = { ...entryOf(s), qty };
    s.qty -= qty;
    if (s.qty <= 0) p.inv[slot] = null;
    p.selfDirty = true;
    return out;
  },
  destroyItem(p, slot, qty) {
    const s = p.inv[slot];
    if (!s) return;
    if (keepsake(s.item)) return this.privateEvent(p, { e: 'sys', text: `You can't destroy ${ITEMS[s.item]?.name || 'that'}.` });
    if (this.tradeOf(p)) return this.privateEvent(p, { e: 'sys', text: 'Finish or cancel your trade first.' });
    const e = this.takeFromSlot(p, slot, qty);
    this.privateEvent(p, { e: 'sys', text: `Destroyed ${itemName(e)}${e.qty > 1 ? ' ×' + e.qty : ''}.` });
    this.noteDestroyed(p, e);
  },
  inTown(p) {
    const T0 = this.map.town;
    return p.zone === 'world' && T0 && p.x >= T0.x0 && p.x <= T0.x1 + 1 && p.y >= T0.y0 && p.y <= T0.y1 + 1;
  },
  dropItem(p, slot, qty) {
    const s = p.inv[slot];
    if (!s || p.anim === 'die') return;
    if (this.inTown(p)) return this.privateEvent(p, { e: 'sys', text: 'You cannot drop items in town.' });
    if (keepsake(s.item)) return this.privateEvent(p, { e: 'sys', text: `You can't drop ${ITEMS[s.item]?.name || 'that'}.` });
    if (this.tradeOf(p)) return this.privateEvent(p, { e: 'sys', text: 'Finish or cancel your trade first.' });
    const e = this.takeFromSlot(p, slot, qty);
    const a = this.rng() * Math.PI * 2;
    let x = p.x + Math.cos(a) * 0.6, y = p.y + Math.sin(a) * 0.6;
    if (this.mapOf(p).solid[Math.floor(y) * this.mapOf(p).w + Math.floor(x)]) { x = p.x; y = p.y; }
    this.newEnt({ type: 'loot', kind: e.item, qty: e.qty, r: e.r || 0, b: e.b || null, x, y, zone: p.zone, owner: null, ownerUntil: 0, expires: this.tick + T(DROP_LIFE), dropped: p.name });
    this.privateEvent(p, { e: 'sys', text: `You drop ${itemName(e)}${e.qty > 1 ? ' ×' + e.qty : ''}. Anyone can pick it up.` });
    this.evAt(p, { e: 'sfx', s: 'drop', x: p.x, y: p.y });
  },

  // ---------------------------------------------------------------- trading
  tradeOf(p) { return p?.tradeId != null ? this.trades.get(p.tradeId) || null : null; },
  tradeCommand(p, m) {
    switch (m.op) {
      case 'ask': return this.tradeAsk(p, m.name);
      case 'yes': return this.tradeYes(p);
      case 'no': { const inv = p.tradeInvite; p.tradeInvite = null; const a = inv && this.playerByName(inv.from); if (a) this.privateEvent(a, { e: 'sys', text: `${p.name} doesn't want to trade.` }); return; }
      case 'add': return this.tradeAdd(p, m.slot);
      case 'remove': return this.tradeRemove(p, m.i);
      case 'gold': return this.tradeGold(p, m.amount);
      case 'accept': return this.tradeAccept(p);
      case 'cancel': return this.tradeCancel(this.tradeOf(p), `${p.name} cancelled the trade.`);
    }
  },
  tradeAsk(p, name) {
    const sys = (text) => this.privateEvent(p, { e: 'sys', text });
    const t = this.playerByName(name);
    if (!t || t.vanish) return sys(`There's nobody called ${String(name || '').trim() || 'that'} online.`);
    if (t.id === p.id) return sys('You can\'t trade with yourself.');
    if (this.tradeOf(p)) return sys('You are already trading.');
    if (this.tradeOf(t)) return sys(`${t.name} is busy trading with someone else.`);
    if (t.zone !== p.zone || Math.hypot(t.x - p.x, t.y - p.y) > TRADE_RANGE) return sys(`${t.name} is too far away. Stand close to them to trade.`);
    if (p.anim === 'die' || t.anim === 'die') return;
    t.tradeInvite = { from: p.name, until: this.tick + T(TRADE_INVITE_SECONDS) };
    this.privateEvent(t, { e: 'tinvite', from: p.name, lv: p.level, cls: p.cls, sec: TRADE_INVITE_SECONDS });
    sys(`You asked ${t.name} to trade.`);
  },
  tradeYes(p) {
    const inv = p.tradeInvite; p.tradeInvite = null;
    if (!inv || inv.until < this.tick) return this.privateEvent(p, { e: 'sys', text: 'That trade request has run out.' });
    const a = this.playerByName(inv.from);
    if (!a) return this.privateEvent(p, { e: 'sys', text: `${inv.from} isn't online any more.` });
    if (this.tradeOf(a) || this.tradeOf(p)) return this.privateEvent(p, { e: 'sys', text: `${a.name} is busy.` });
    if (a.zone !== p.zone || Math.hypot(a.x - p.x, a.y - p.y) > TRADE_RANGE) return this.privateEvent(p, { e: 'sys', text: `${a.name} is too far away.` });
    const tr = { id: this.nextTrade++, a: a.id, b: p.id, offer: { [a.id]: { slots: [], gold: 0 }, [p.id]: { slots: [], gold: 0 } }, ok: {} };
    this.trades.set(tr.id, tr);
    a.tradeId = tr.id; p.tradeId = tr.id;
    for (const q of [a, p]) { this.stopWork(q); q.path = null; q.target = null; }
    this.tradeSync(tr);
  },
  // what each side sees: their own offer and the other's, with full item details
  tradeSync(tr) {
    const A = this.ents.get(tr.a), B = this.ents.get(tr.b);
    if (!A || !B) return;
    const list = (q) => tr.offer[q.id].slots.map((i) => q.inv[i] ? { slot: i, ...entryOf(q.inv[i]) } : null).filter(Boolean);
    for (const [me, them] of [[A, B], [B, A]]) {
      this.privateEvent(me, { e: 'trade', with: them.name, mine: list(me), theirs: list(them), myGold: tr.offer[me.id].gold, theirGold: tr.offer[them.id].gold, myOk: !!tr.ok[me.id], theirOk: !!tr.ok[them.id] });
    }
  },
  tradeChanged(tr) { tr.ok = {}; this.tradeSync(tr); },
  tradeAdd(p, slot) {
    const tr = this.tradeOf(p); if (!tr) return;
    const s = p.inv[slot]; if (!s) return;
    const mine = tr.offer[p.id];
    if (mine.slots.includes(slot)) return;
    if (keepsake(s.item)) return this.privateEvent(p, { e: 'sys', text: `You can't trade ${ITEMS[s.item]?.name || 'that'}.` });
    if (mine.slots.length >= TRADE_SLOTS) return this.privateEvent(p, { e: 'sys', text: `You can offer up to ${TRADE_SLOTS} things at a time.` });
    mine.slots.push(slot);
    mine.snap = mine.slots.map((i) => entryOf(p.inv[i]));
    this.tradeChanged(tr);
  },
  tradeRemove(p, i) {
    const tr = this.tradeOf(p); if (!tr) return;
    const mine = tr.offer[p.id];
    if (!Number.isInteger(i) || i < 0 || i >= mine.slots.length) return;
    mine.slots.splice(i, 1);
    mine.snap = mine.slots.map((k) => entryOf(p.inv[k]));
    this.tradeChanged(tr);
  },
  tradeGold(p, amount) {
    const tr = this.tradeOf(p); if (!tr) return;
    tr.offer[p.id].gold = Math.max(0, Math.min(p.gold, Math.floor(amount) || 0));
    this.tradeChanged(tr);
  },
  tradeAccept(p) {
    const tr = this.tradeOf(p); if (!tr) return;
    tr.ok[p.id] = true;
    if (!(tr.ok[tr.a] && tr.ok[tr.b])) return this.tradeSync(tr);
    this.tradeFinish(tr);
  },
  tradeCancel(tr, why) {
    if (!tr) return;
    for (const id of [tr.a, tr.b]) {
      const q = this.ents.get(id);
      if (!q) continue;
      q.tradeId = null;
      this.privateEvent(q, { e: 'trade', closed: 1 });
      if (why) this.privateEvent(q, { e: 'sys', text: why });
    }
    this.trades.delete(tr.id);
  },
  tradeFinish(tr) {
    const A = this.ents.get(tr.a), B = this.ents.get(tr.b);
    if (!A || !B) return this.tradeCancel(tr, 'The trade was cancelled.');
    // everything still where it was when it was offered?
    for (const q of [A, B]) {
      const o = tr.offer[q.id];
      if (o.slots.some((i, k) => !same(q.inv[i], o.snap?.[k])) || q.gold < o.gold) return this.tradeCancel(tr, 'Something changed in a pack during the trade, so it was cancelled. Try again.');
    }
    // room for what's coming in? (counting the slots that will be emptied)
    const fits = (q, incoming) => q.inv.filter((s) => !s).length + tr.offer[q.id].slots.length >= incoming.length;
    const gA = tr.offer[A.id].slots.map((i) => entryOf(A.inv[i])), gB = tr.offer[B.id].slots.map((i) => entryOf(B.inv[i]));
    if (!fits(A, gB)) return this.tradeCancel(tr, `${A.name}'s pack is too full for the trade.`);
    if (!fits(B, gA)) return this.tradeCancel(tr, `${B.name}'s pack is too full for the trade.`);
    for (const [q, o] of [[A, tr.offer[A.id]], [B, tr.offer[B.id]]]) { for (const i of o.slots) q.inv[i] = null; q.gold -= o.gold; }
    const give = (q, list) => { for (const e of list) { const i = q.inv.indexOf(null); if (i >= 0) q.inv[i] = e; } };
    give(A, gB); give(B, gA);
    A.gold += tr.offer[B.id].gold; B.gold += tr.offer[A.id].gold;
    A.selfDirty = B.selfDirty = true;
    const sum = (list, g) => [...list.map((e) => `${itemName(e)}${e.qty > 1 ? ' ×' + e.qty : ''}`), ...(g ? [`${g} gold`] : [])].join(', ') || 'nothing';
    for (const [q, them, got] of [[A, B, sum(gB, tr.offer[B.id].gold)], [B, A, sum(gA, tr.offer[A.id].gold)]]) {
      q.tradeId = null;
      this.privateEvent(q, { e: 'trade', closed: 1, done: 1 });
      this.privateEvent(q, { e: 'loot', text: `Trade with ${them.name} complete. You got: ${got}.` });
    }
    this.trades.delete(tr.id);
    this.savePlayer?.(A.clientId, A); this.savePlayer?.(B.clientId, B);
  },
  // called a few times a second: stop trades between people who walked apart, died or left
  updateTrades() {
    for (const tr of this.trades.values()) {
      const A = this.ents.get(tr.a), B = this.ents.get(tr.b);
      if (!A || !B) { this.tradeCancel(tr, 'The other player left, so the trade was cancelled.'); continue; }
      if (A.zone !== B.zone || Math.hypot(A.x - B.x, A.y - B.y) > TRADE_RANGE + 2) this.tradeCancel(tr, 'You walked too far apart: the trade was cancelled.');
      else if (A.anim === 'die' || B.anim === 'die') this.tradeCancel(tr, 'The trade was cancelled.');
    }
    for (const c of this.clients.values()) {
      const p = this.ents.get(c.entId);
      if (p?.tradeInvite && p.tradeInvite.until < this.tick) { p.tradeInvite = null; this.privateEvent(p, { e: 'tinvite', from: null }); }
    }
  },
};
