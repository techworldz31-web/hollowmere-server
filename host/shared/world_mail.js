// The post: letters between heroes, with up to four items and some gold tucked inside, waiting
// in the recipient's mailbox whether they're online or not. You send and collect at any mailbox
// (by the town square, the bank, the inn, and at every camp); new mail brings a note and an
// envelope by the minimap wherever you are.
//
// Every hero's box lives on the server in mail.json (hooks.loadMail / saveMail), so a letter to a
// friend who's offline is there when they log in. Letters are kept 30 days; one with something
// still inside then goes back to its sender. In single-player your box travels in your save.
// Installed onto World's prototype (see the bottom of world.js).
import { ITEMS, itemName } from './content.js';
import { S2C } from './protocol.js';

export const MAIL = { maxBox: 40, maxItems: 4, postage: 5, perItem: 2, subj: 40, body: 500, keepDays: 30, perMinute: 6 };
const key = (n) => String(n || '').trim().toLowerCase();
const DAY = 24 * 3600 * 1000;

export const mailMethods = {
  initMail() {
    this.mail = new Map();                       // name key -> [letters]
    const saved = this.hooks.loadMail?.();
    if (saved && typeof saved === 'object') for (const [k, box] of Object.entries(saved)) if (Array.isArray(box)) this.mail.set(k, box.filter((l) => l && l.id).slice(-MAIL.maxBox));
    this.expireMail();
  },
  saveMail() {
    this.mailDirty = false;
    if (this.hooks.saveMail) this.hooks.saveMail(Object.fromEntries([...this.mail].filter(([, b]) => b.length)));
  },
  boxOf(name) { const k = key(name); if (!this.mail.has(k)) this.mail.set(k, []); return this.mail.get(k); },
  unread(p) { return (this.mail?.get(key(p.name)) || []).filter((l) => !l.read).length; },
  // single-player: your own box rides along in your save, and comes back with it
  mailSolo(p) { return this.hooks.saveMail ? undefined : (this.mail?.get(key(p.name)) || []); },
  restoreMailSolo(p, box) { if (!this.hooks.saveMail && Array.isArray(box) && !this.mail.get(key(p.name))?.length) this.mail.set(key(p.name), box.slice(-MAIL.maxBox)); },

  // letters a month old: anything still inside goes home, the rest are thrown away
  expireMail() {
    const now = Date.now(); let changed = false;
    for (const [k, box] of this.mail) {
      for (const l of [...box]) {
        if (now - l.sent < MAIL.keepDays * DAY) continue;
        box.splice(box.indexOf(l), 1); changed = true;
        if ((l.items?.length || l.gold) && !l.returned && l.from) {
          const back = this.boxOf(l.from);
          if (back.length < MAIL.maxBox) back.push({ ...l, id: this.mailId(), to: l.from, from: l.to, subj: `Returned: ${l.subj}`.slice(0, MAIL.subj), body: `Your letter to ${l.to} was never collected, so it has come back to you.`, sent: now, read: false, returned: true });
        }
      }
      if (!box.length) this.mail.delete(k);
    }
    if (changed) this.saveMail();
  },
  savePlayerNow(p) { if (p.clientId != null && this.clients?.has(p.clientId)) this.savePlayer(p.clientId, p); },
  // will this fit in the pack whole?
  roomFor(p, item, qty) {
    const d = ITEMS[item]; if (!d) return false;
    const free = p.inv.filter((s) => !s).length;
    if (!d.stack) return free >= qty;
    let cap = free * d.stack;
    for (const s of p.inv) if (s && s.item === item) cap += d.stack - s.qty;
    return cap >= qty;
  },
  mailId() { return Math.floor(Date.now() / 1000).toString(36) + Math.floor(this.rng() * 1e9).toString(36); },

  // is p standing by a mailbox?
  atMailbox(p) {
    for (const e of this.ents.values()) if (e.type === 'station' && e.kind === 'mailbox' && e.zone === p.zone && Math.hypot(e.x - p.x, e.y - p.y) < 3.6) return e;
    return null;
  },
  mailOpen(p, st) { p.mailAt = st?.id ?? null; this.sendMailbox(p, true); },
  sendMailbox(p, open = false) {
    const box = (this.mail.get(key(p.name)) || []).slice().sort((a, b) => b.sent - a.sent);
    this.privateEvent(p, { e: 'mailbox', open, at: p.mailAt ?? null, box: box.map((l) => ({ id: l.id, from: l.from, subj: l.subj, body: l.body, sent: l.sent, read: !!l.read, gold: l.gold || 0, items: l.items || [], returned: !!l.returned })), postage: MAIL.postage, perItem: MAIL.perItem });
  },
  mailNotify(name, from, subj) {
    const t = this.playerByName(name);
    if (!t) return;
    t.selfDirty = true;
    this.privateEvent(t, { e: 'mailnew', from, subj, n: this.unread(t) });
  },

  mailCommand(p, m) {
    const sys = (text) => this.privateEvent(p, { e: 'sys', text });
    const near = this.atMailbox(p);
    switch (m.op) {
      case 'open':
        if (!near) return sys('Find a mailbox to read your post: by the town square, the bank, the inn, or at any camp.');
        return this.mailOpen(p, near);
      case 'read': {
        const l = (this.mail.get(key(p.name)) || []).find((x) => x.id === m.id);
        if (l && !l.read) { l.read = true; p.selfDirty = true; this.mailDirty = true; }
        return;
      }
      case 'take': {
        if (!near) return sys('You need to be at a mailbox to take things out of a letter.');
        const l = (this.mail.get(key(p.name)) || []).find((x) => x.id === m.id);
        if (!l) return;
        l.read = true;
        if (l.gold) { p.gold += l.gold; this.privateEvent(p, { e: 'gold', v: l.gold }); l.gold = 0; }
        const left = [];
        for (const it of l.items || []) {
          if (!ITEMS[it.item]) continue;
          if (!this.roomFor(p, it.item, it.qty)) { left.push(it); continue; }
          this.addItem(p, it.item, it.qty, it.r || 0, it.b || null);
        }
        if (left.length) sys('Your pack is full: the rest stays in the letter for now.');
        l.items = left;
        p.selfDirty = true; this.saveMail(); this.savePlayerNow?.(p);
        return this.sendMailbox(p);
      }
      case 'del': {
        const box = this.mail.get(key(p.name)) || [], l = box.find((x) => x.id === m.id);
        if (!l) return;
        if (l.items?.length || l.gold) return sys('Take what\'s inside first (or send it back).');
        box.splice(box.indexOf(l), 1); p.selfDirty = true; this.saveMail();
        return this.sendMailbox(p);
      }
      case 'back': {
        if (!near) return sys('You need to be at a mailbox to send a letter back.');
        const box = this.mail.get(key(p.name)) || [], l = box.find((x) => x.id === m.id);
        if (!l || l.returned || !l.from || !(l.items?.length || l.gold)) return sys('There\'s nothing in that letter to send back.');
        const back = this.boxOf(l.from);
        if (back.length >= MAIL.maxBox) return sys(`${l.from}'s mailbox is full.`);
        box.splice(box.indexOf(l), 1);
        back.push({ ...l, id: this.mailId(), from: p.name, to: l.from, subj: `Returned: ${l.subj}`.slice(0, MAIL.subj), body: `${p.name} sent this back to you, unopened.`, sent: Date.now(), read: false, returned: true });
        this.saveMail(); this.mailNotify(l.from, p.name, 'Returned mail');
        p.selfDirty = true; sys(`Sent back to ${l.from}.`);
        return this.sendMailbox(p);
      }
      case 'send': return this.mailSend(p, m, near);
    }
  },

  mailSend(p, m, near) {
    const sys = (text) => this.privateEvent(p, { e: 'sys', text });
    if (!near) return sys('You need to be at a mailbox to send a letter.');
    const now = Date.now();
    p.mailTimes = (p.mailTimes || []).filter((t) => now - t < 60000);
    if (p.mailTimes.length >= MAIL.perMinute) return sys('Easy there: the postmaster can only take a few letters a minute.');
    const to = String(m.to || '').trim();
    if (!to) return sys('Who is it for? Write a name.');
    if (key(to) === key(p.name)) return sys('You can\'t send a letter to yourself.');
    const online = this.playerByName(to);
    const saved = !online && this.hooks.loadPlayer?.(to);
    if (!online && !saved) return sys(this.hooks.saveMail ? `There is no hero called ${to}.` : `${to} isn't here (in single-player you can only write to heroes who are online).`);
    const name = online?.name || saved?.name || to;
    if (this.boxOf(name).length >= MAIL.maxBox) return sys(`${name}'s mailbox is full.`);
    const subj = String(m.subj || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAIL.subj) || '(no subject)';
    const body = String(m.body || '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, MAIL.body);
    // what goes inside: whole stacks from the pack, no quest items, nothing bound to you
    const slots = [...new Set((Array.isArray(m.slots) ? m.slots : []).filter((i) => Number.isInteger(i) && i >= 0 && i < p.inv.length))].slice(0, MAIL.maxItems);
    for (const i of slots) {
      const it = p.inv[i], d = it && ITEMS[it.item];
      if (!d) return sys('One of those items isn\'t in your pack any more.');
      if (d.type === 'quest' || d.nosell || d.type === 'hearth' || d.type === 'mount') return sys(`${d.name} can't be sent by post.`);
    }
    const gold = Math.max(0, Math.floor(Number(m.gold) || 0));
    const cost = MAIL.postage + slots.length * MAIL.perItem;
    if (p.gold < gold + cost) return sys(`You need ${gold + cost} gold for that (${cost} postage${gold ? ` + ${gold} to send` : ''}).`);
    if (!slots.length && !gold && !body.trim() && subj === '(no subject)') return sys('Write something first.');
    const items = slots.map((i) => { const it = p.inv[i]; p.inv[i] = null; return { item: it.item, qty: it.qty, ...(it.r ? { r: it.r } : {}), ...(it.b ? { b: it.b } : {}) }; });
    p.gold -= gold + cost; p.selfDirty = true;
    p.mailTimes.push(now);
    this.boxOf(name).push({ id: this.mailId(), from: p.name, to: name, subj, body, items, gold, sent: now, read: false });
    this.saveMail(); this.savePlayerNow?.(p);
    this.mailNotify(name, p.name, subj);
    this.privateEvent(p, { e: 'mailsent', to: name });
    sys(`Your letter to ${name} is in the post${items.length ? ` with ${items.map((it) => itemName(it) + (it.qty > 1 ? ` ×${it.qty}` : '')).join(', ')}` : ''}${gold ? ` and ${gold} gold` : ''} (${cost} gold postage).`);
    this.sendMailbox(p);
  },

  // logging in: a word about letters waiting
  mailLogin(p) {
    const n = this.unread(p);
    if (n) this.later(4, () => this.ents.has(p.id) && this.privateEvent(p, { e: 'mailnew', n, login: 1 }));
  },
};
