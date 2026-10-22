// Small comforts: selling all your junk at once, showing an item off in chat, splitting a stack,
// taking back an item you destroyed by mistake, and the away-from-keyboard flag.
// Installed onto World's prototype (see the bottom of world.js).
import { ITEMS, itemStat, itemName } from './content.js';
import { GEAR_SLOTS } from './gear.js';
import { TICK_RATE } from './constants.js';

const T = (s) => Math.round(s * TICK_RATE);
const keepsake = (item) => { const d = ITEMS[item]; return !d || d.type === 'quest' || d.nosell || d.type === 'hearth' || d.type === 'mount'; };

// junk: the things a hero never needs. Plain junk (old boots, burnt food), and plain (common)
// gear made for another class, or worse than what you're wearing in that slot.
export function isJunk(p, it) {
  const d = it && ITEMS[it.item];
  if (!d || keepsake(it.item)) return false;
  if (d.type === 'junk') return true;
  if (!GEAR_SLOTS.includes(d.type) || it.r) return false;
  if (d.cls && d.cls !== p.cls) return true;
  const cur = p.equip?.[d.type];
  if (!cur) return false;
  const a = itemStat(it), b = itemStat(cur);
  return a.atk + a.def + a.hp * 0.3 < b.atk + b.def + b.hp * 0.3 && !it.b;
}

export const qolMethods = {
  // every piece of junk in the pack, sold in one go (each can still be bought back)
  sellJunk(p) {
    let n = 0, gold = p.gold;
    for (let i = 0; i < p.inv.length; i++) {
      while (p.inv[i] && isJunk(p, p.inv[i])) { const before = p.inv[i].qty; this.sell(p, i, true); n++; if (p.inv[i] && p.inv[i].qty === before) break; }
    }
    if (!n) return this.privateEvent(p, { e: 'sys', text: 'Nothing in your pack looks like junk.' });
    this.privateEvent(p, { e: 'sys', text: `Sold ${n} piece${n > 1 ? 's' : ''} of junk for ${p.gold - gold} gold. (Sold something you wanted? Buy it back at any shop.)` });
  },

  // split a stack: qty of it moves to the first empty slot
  splitStack(p, slot, qty) {
    const s = p.inv[slot];
    if (!s || s.qty < 2) return;
    qty = Math.max(1, Math.min(s.qty - 1, qty | 0));
    const to = p.inv.indexOf(null);
    if (to < 0) return this.privateEvent(p, { e: 'sys', text: 'You need an empty slot in your pack to split a stack.' });
    s.qty -= qty; p.inv[to] = { ...s, qty };
    p.selfDirty = true;
  },

  // destroyed something by mistake? ten seconds to change your mind
  noteDestroyed(p, entry) { p.undo = { e: entry, until: this.tick + T(10) }; this.privateEvent(p, { e: 'destroyed', name: itemName(entry), qty: entry.qty || 1, sec: 10 }); },
  undoDestroy(p) {
    const u = p.undo;
    if (!u || this.tick > u.until) return this.privateEvent(p, { e: 'sys', text: 'Too late: it\'s gone.' });
    if (!this.roomFor(p, u.e.item, u.e.qty || 1)) return this.privateEvent(p, { e: 'sys', text: 'Make room in your pack first.' });
    this.addItem(p, u.e.item, u.e.qty || 1, u.e.r || 0, u.e.b || null);
    p.undo = null; p.selfDirty = true;
    this.privateEvent(p, { e: 'sys', text: `${itemName(u.e)} is back in your pack.` });
  },

  // away from keyboard: shown on your name and in friends lists; whispers get a polite reply
  setAfk(p, on) {
    if (!!p.afk === !!on) return;
    p.afk = !!on;
    this.privateEvent(p, { e: 'sys', text: on ? 'You are now away (AFK). Move or type to come back.' : 'Welcome back: you are no longer away.' });
    for (const c of this.clients.values()) { const e = this.ents.get(c.entId); if (e && e !== p && (e.friends || []).some((f) => f.toLowerCase() === p.name.toLowerCase())) this.pushFriends(e); }
  },

  // "[[3]]" in a chat line (pack slot 3, put there by shift-clicking the item) becomes a link the
  // others can hover to see the item. Links can only be made from your own pack.
  linkItems(p, text) {
    text = text.replace(/\{\{item:[^}]*\}\}/g, '');       // no forged links
    let n = 0;
    return text.replace(/\[\[(\d{1,2})\]\]/g, (all, i) => {
      const it = p.inv[Number(i)];
      if (!it || !ITEMS[it.item] || ++n > 3) return '';
      const b = it.b ? Object.entries(it.b).map(([k, v]) => `${k}=${+v.toFixed(4)}`).join(',') : '';
      return `{{item:${it.item}:${it.r || 0}:${b}}}`;
    });
  },
};
