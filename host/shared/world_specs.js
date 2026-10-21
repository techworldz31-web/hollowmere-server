// Specialisations on the server: choosing a path at the trainer, the twelve path skills,
// and the effects they leave behind (wards, marks, burning, snares, the spirit wolf).
// Installed onto World's prototype (see the bottom of world.js).
import { TICK_RATE, dirFromVector } from './constants.js';
import { S2C } from './protocol.js';
import { MOBS, NPCS, QUESTS, QUEST_ORDER } from './content.js';
import { SPECS, SPEC_ORDER, SPEC_SKILLS, SPEC_UNLOCK, respecCost, passiveText } from './specs.js';
import { lineClear } from './pathfind.js';

const T = (s) => Math.round(s * TICK_RATE);
const round2 = (v) => Math.round(v * 100) / 100;
const TRAINERS = { warrior: 'trainer_warrior', ranger: 'trainer_ranger', mage: 'trainer_mage' };

export const specMethods = {
  // ---------------------------------------------------------------- choosing a path
  // the trainer offers it once the level 10 trial is done (the dialog option comes from talk())
  specReady(p) { return p.level >= SPEC_UNLOCK && QUEST_ORDER.some((q) => QUESTS[q].milestone === 10 && QUESTS[q].cls === p.cls && p.quests[q]?.state === 'done'); },
  specOptions(p, n) {
    if (n.kind !== TRAINERS[p.cls] || !this.specReady(p)) return [];
    return [{ id: 'spec', label: p.spec ? `Change my path (now: ${SPECS[p.spec].name})` : 'Choose my path' }];
  },
  specMenu(p, n) {
    const cost = respecCost(p.level), lines = [];
    for (const id of SPEC_ORDER[p.cls]) {
      const S = SPECS[id];
      lines.push(`${S.name} (${S.role}): ${S.blurb}\n   Passive: ${passiveText(S.passive)}.\n   Skills: ${S.skills.map((k) => SPEC_SKILLS[k].name).join(' and ')}.`);
    }
    const text = (p.spec ? `You walk the path of the ${SPECS[p.spec].name}. I can unteach it, but it costs me time and you ${cost} gold.\n\n` : 'You have earned the right to choose. Two paths; you may walk one at a time.\n\n') + lines.join('\n\n');
    const opts = SPEC_ORDER[p.cls].filter((id) => id !== p.spec).map((id) => ({ id: 'spec:' + id, label: p.spec ? `Become a ${SPECS[id].name} (${cost} gold)` : `Become a ${SPECS[id].name}` }));
    opts.push({ id: 'bye', label: 'Let me think about it' });
    this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text, options: opts });
  },
  chooseSpec(p, n, id) {
    const S = SPECS[id];
    if (!S || S.cls !== p.cls || n.kind !== TRAINERS[p.cls] || !this.specReady(p) || p.spec === id) return;
    if (p.spec) {
      const cost = respecCost(p.level);
      if (p.gold < cost) return this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text: `${cost} gold, and you have ${p.gold}. Come back when you can pay.`, options: [{ id: 'bye', label: 'Goodbye' }] });
      p.gold -= cost; this.privateEvent(p, { e: 'gold', v: -cost });
      // the old path's skill points come back
      for (const k of SPECS[p.spec].skills) delete p.skills[k];
      for (const k of SPECS[p.spec].skills) delete p.cds[k];
    }
    this.endSpecEffects(p);
    p.spec = id;
    this.recalcStats(p);
    p.selfDirty = true;
    this.evAt(p, { e: 'fx', k: 'ascend', x: round2(p.x), y: round2(p.y) });
    this.privateEvent(p, { e: 'milestone', lv: 10, trial: 1, spec: id, text: `You are now a ${S.name}! Press K to learn ${S.skills.map((k) => SPEC_SKILLS[k].name).join(' and ')} (keys 7 and 8).` });
    this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: NPCS[n.kind].name, text: `Then walk it well, ${S.name}. Your new skills are yours to learn: spend your skill points on them (K).`, options: [{ id: 'bye', label: 'I will' }] });
  },
  endSpecEffects(p) {
    for (const k of ['ward', 'shieldwall', 'rampage', 'barrier']) delete p.buffs[k];
    for (const e of this.ents.values()) if (e.type === 'ally' && e.owner === p.id) this.ents.delete(e.id);
  },

  // ---------------------------------------------------------------- the path skills
  // returns true if it handled the skill
  castSpec(p, name, r, ux, uy, d, alive) {
    if (!SPEC_SKILLS[name]) return false;
    const zone = p.zone, mods = p.mods || {};
    switch (name) {
      // --- Guardian
      case 'taunt': {
        this.playAnim(p, 'cast', 0.6);
        for (const m of this.mobsNear(p.x, p.y, 6, zone)) { m.target = p.id; m.state = 'chase'; m.path = null; m.tauntUntil = this.tick + T(4); }
        p.buffs.ward = { amount: Math.round(p.maxHp * (30 + 10 * r) / 100), until: this.tick + T(6) };
        this.evAt(p, { e: 'fx', k: 'taunt', x: round2(p.x), y: round2(p.y), r: 6 });
        break;
      }
      case 'shieldwall':
        this.playAnim(p, 'cast', 0.6);
        p.buffs.shieldwall = { cut: (40 + 10 * r) / 100, until: this.tick + T(5 + r) };
        this.evAt(p, { e: 'fx', k: 'shieldwall', x: round2(p.x), y: round2(p.y) });
        break;
      // --- Berserker
      case 'bloodthirst': {
        this.playAnim(p, 'attack', 0.55);
        const mult = (180 + 30 * r) / 100, heal = (30 + 5 * r) / 100;
        this.later(0.22, () => {
          if (!alive()) return;
          // the enemy in front of you nearest the aim
          const t = this.mobsNear(p.x + ux * 1.1, p.y + uy * 1.1, 1.6, zone).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
          this.evAt(p, { e: 'fx', k: 'bloodthirst', x: round2(p.x), y: round2(p.y), d: p.dir });
          if (!t) return;
          const before = t.hp;
          this.hit(p, t, mult);
          const dealt = Math.max(0, before - t.hp), v = Math.min(p.maxHp - p.hp, Math.round(dealt * heal));
          if (v > 0) { p.hp += v; p.selfDirty = true; this.evAt(p, { e: 'heal', id: p.id, v }); }
        });
        break;
      }
      case 'rampage': {
        this.playAnim(p, 'cast', 0.6);
        const cost = Math.round(p.maxHp * 0.1);
        p.hp = Math.max(1, p.hp - cost); p.selfDirty = true;
        p.buffs.rampage = { haste: (30 + 10 * r) / 100, dmg: (15 + 5 * r) / 100, until: this.tick + T(7 + 2 * r) };
        this.evAt(p, { e: 'fx', k: 'rampage', x: round2(p.x), y: round2(p.y) });
        break;
      }
      // --- Marksman
      case 'aimedshot': {
        this.playAnim(p, 'cast', 0.75);
        const mult = (240 + 45 * r) / 100;
        this.evAt(p, { e: 'fx', k: 'aim', x: round2(p.x), y: round2(p.y), d: p.dir });
        this.later(0.6, () => { if (alive()) this.shoot(p, 'arrow', p.x + ux * 10, p.y + uy * 10, mult, null, { big: 1, sureCrit: 1, range: 11 }); });
        break;
      }
      case 'huntersmark': {
        this.playAnim(p, 'cast', 0.5);
        const dist = Math.min(SPEC_SKILLS.huntersmark.range, d), px = p.x + ux * dist, py = p.y + uy * dist;
        for (const m of this.mobsNear(px, py, 2.5, zone)) { m.markUntil = this.tick + T(10); m.markMul = 1 + (20 + 8 * r) / 100; }
        this.event({ e: 'fx', k: 'mark', x: round2(px), y: round2(py), r: 2.5 }, px, py, zone);
        break;
      }
      // --- Beastmaster
      case 'spiritwolf': {
        this.playAnim(p, 'cast', 0.6);
        for (const e of this.ents.values()) if (e.type === 'ally' && e.owner === p.id) this.ents.delete(e.id);
        const a = (p.dir * Math.PI / 4) + 2;
        const wolf = this.newEnt({ type: 'ally', kind: 'wolf', name: 'Spirit Wolf', x: p.x + Math.cos(a) * 1.2, y: p.y + Math.sin(a) * 1.2, zone, owner: p.id, dir: p.dir,
          until: this.tick + T(18 + 6 * r), power: (45 + 15 * r) / 100 * (1 + (mods.petPower || 0)), cdUntil: 0, target: null });
        this.setAnim(wolf, 'idle');
        this.evAt(wolf, { e: 'fx', k: 'wolfcall', x: round2(wolf.x), y: round2(wolf.y) });
        break;
      }
      case 'snaretrap': {
        this.playAnim(p, 'cast', 0.45);
        const dist = Math.min(SPEC_SKILLS.snaretrap.range, d);
        let px = p.x + ux * dist, py = p.y + uy * dist;
        if (!lineClear(this.mapOf(p), p.x, p.y, px, py, 0.1)) { px = p.x + ux * 1.5; py = p.y + uy * 1.5; }
        for (const e of this.ents.values()) if (e.type === 'snare' && e.owner === p.id) this.ents.delete(e.id);
        this.newEnt({ type: 'snare', kind: 'snare', x: px, y: py, zone, owner: p.id, until: this.tick + T(25), mult: (150 + 30 * r) / 100, hold: 2 + 0.5 * r, armAt: this.tick + T(0.4) });
        this.event({ e: 'fx', k: 'trapset', x: round2(px), y: round2(py) }, px, py, zone);
        break;
      }
      // --- Pyromancer
      case 'flamewave': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (170 + 30 * r) / 100;
        this.evAt(p, { e: 'fx', k: 'flamewave', x: round2(p.x), y: round2(p.y), d: p.dir, ux: round2(ux), uy: round2(uy) });
        const hit = new Set();
        for (let s = 1; s <= 4; s++) this.later(0.15 + s * 0.08, () => {
          if (!alive()) return;
          const cx = p.x + ux * s, cy = p.y + uy * s;
          for (const m of this.mobsNear(cx, cy, 0.9 + s * 0.25, zone)) if (!hit.has(m.id)) { hit.add(m.id); this.hit(p, m, mult); this.ignite(m, p, Math.max(0.3, mods.burn || 0)); }
        });
        break;
      }
      case 'livingbomb': {
        this.playAnim(p, 'attack', 0.5);
        const dist = Math.min(SPEC_SKILLS.livingbomb.range, d), ax = p.x + ux * dist, ay = p.y + uy * dist;
        const t = this.mobsNear(ax, ay, 3.5, zone).sort((a, b) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay))[0];
        if (!t) { this.privateEvent(p, { e: 'sys', text: 'No enemy near the cursor to plant the bomb in.' }); p.cds[name] = this.tick + T(1); return true; }
        const mult = (250 + 45 * r) / 100;
        t.bomb = this.tick + T(3); p.selfDirty = true;
        this.evAt(t, { e: 'fx', k: 'bombset', x: round2(t.x), y: round2(t.y), id: t.id, t: 3 });
        this.later(3, () => {
          t.bomb = 0;
          const owner = this.ents.get(p.id) || p;
          const bx = t.x, by = t.y, bz = t.zone;
          this.event({ e: 'fx', k: 'boom', x: round2(bx), y: round2(by), r: 2.5 }, bx, by, bz);
          for (const m of this.mobsNear(bx, by, 2.5, bz)) { this.hit(owner, m, mult); this.ignite(m, owner, mods.burn || 0); }
        });
        break;
      }
      // --- Frostbinder
      case 'icebarrier':
        this.playAnim(p, 'cast', 0.6);
        p.buffs.barrier = { amount: Math.round(p.maxHp * (35 + 12 * r) / 100), until: this.tick + T(10) };
        // the frost wraps party members close by as well, a little thinner
        for (const q of this.partyNear(p, p.x, p.y, p.zone)) if (q !== p && Math.hypot(q.x - p.x, q.y - p.y) <= 8 && q.hp > 0) {
          q.buffs.barrier = { amount: Math.round(q.maxHp * (20 + 8 * r) / 100), until: this.tick + T(10), from: p.name }; q.selfDirty = true;
          this.evAt(q, { e: 'fx', k: 'barrier', x: round2(q.x), y: round2(q.y) });
        }
        this.evAt(p, { e: 'fx', k: 'barrier', x: round2(p.x), y: round2(p.y) });
        break;
      case 'glacialspike': {
        this.playAnim(p, 'attack', 0.6);
        const mult = (200 + 35 * r) / 100, freeze = 1 + 0.5 * r;
        this.evAt(p, { e: 'fx', k: 'spike', x: round2(p.x), y: round2(p.y), ux: round2(ux), uy: round2(uy), len: 8 });
        this.later(0.25, () => {
          if (!alive()) return;
          for (const m of this.mobsNear(p.x + ux * 4, p.y + uy * 4, 4.5, zone)) {
            const mx = m.x - p.x, my = m.y - p.y, along = mx * ux + my * uy, off = Math.abs(mx * uy - my * ux);
            if (along > 0 && along < 8.5 && off < 1.1) { this.hit(p, m, mult); this.stun(m, freeze); m.slowUntil = Math.max(m.slowUntil || 0, this.tick + T(freeze + 2)); }
          }
        });
        break;
      }
    }
    return true;
  },

  // ---------------------------------------------------------------- lasting effects
  // set a monster alight: share is the fraction of the burning hit dealt again over 3 seconds
  ignite(m, src, share, base) {
    if (!share || m.hp <= 0 || m.type !== 'mob') return;
    const per = Math.max(1, Math.round((base ?? this.atkOf(src)) * share / 3));
    m.burn = { until: this.tick + T(3), next: this.tick + T(1), per, src: src.id };
  },
  updateMobEffects(m) {
    if (m.burn && m.hp > 0) {
      if (this.tick >= m.burn.next) {
        m.burn.next = this.tick + T(1);
        const src = this.ents.get(m.burn.src);
        this.damage(m, m.burn.per, src || null, false, true);
      }
      if (m.burn && this.tick >= m.burn.until) m.burn = null;
    }
    if (m.markUntil && m.markUntil <= this.tick) { m.markUntil = 0; m.markMul = 1; }
  },
  // snares: armed after a moment, spring on the first monsters to step in
  updateSnare(tr) {
    if (this.tick >= tr.until) return this.ents.delete(tr.id);
    if (this.tick < tr.armAt || this.tick % 2) return;
    const near = this.mobsNear(tr.x, tr.y, 1.5, tr.zone);
    if (!near.length) return;
    const owner = this.ents.get(tr.owner);
    this.ents.delete(tr.id);
    this.event({ e: 'fx', k: 'snare', x: round2(tr.x), y: round2(tr.y) }, tr.x, tr.y, tr.zone);
    for (const m of near) { if (owner) this.hit(owner, m, tr.mult); this.stun(m, tr.hold); }
  },
  // the spirit wolf: runs at whatever its master fights (or the nearest threat), bites, follows otherwise
  updateAlly(a) {
    const o = this.ents.get(a.owner);
    if (!o || o.zone !== a.zone || o.anim === 'die' || this.tick >= a.until) {
      this.evAt(a, { e: 'fx', k: 'wolfgone', x: round2(a.x), y: round2(a.y) });
      return this.ents.delete(a.id);
    }
    let t = a.target != null ? this.ents.get(a.target) : null;
    if (!t || t.hp <= 0 || t.zone !== a.zone || Math.hypot(t.x - o.x, t.y - o.y) > 12) t = null;
    const ot = o.target != null ? this.ents.get(o.target) : null;
    if (ot && ot.type === 'mob' && ot.hp > 0) t = ot;
    if (!t && this.tick % 5 === a.id % 5) t = this.mobsNear(o.x, o.y, 6, a.zone).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0] || null;
    a.target = t ? t.id : null;
    const speed = MOBS.wolf.speed * 1.35, map = this.mapOf(a);
    let moving = false;
    if (t) {
      const d = Math.hypot(t.x - a.x, t.y - a.y);
      a.dir = dirFromVector(t.x - a.x, t.y - a.y);
      if (d > 1.2) {
        const s = Math.min(d - 1, speed / TICK_RATE);
        if (!this.moveBy(a, (t.x - a.x) / d * s, (t.y - a.y) / d * s) && lineClear(map, a.x, a.y, t.x, t.y, 0)) { a.x += (t.x - a.x) / d * s; a.y += (t.y - a.y) / d * s; }
        moving = true;
      } else if (this.tick >= a.cdUntil) {
        a.cdUntil = this.tick + T(1.1);
        this.playAnim(a, 'attack', 0.5);
        this.later(0.2, () => { if (this.ents.has(a.id) && t.hp > 0) { this.applyDamage(t, this.atkOf(o) * a.power, o, 0.1); this.evAt(t, { e: 'fx', k: 'bite', x: round2(t.x), y: round2(t.y) }); } });
      }
    } else {
      const dx = o.x - 0.9 - a.x, dy = o.y + 0.6 - a.y, d = Math.hypot(dx, dy);
      if (d > 9) { a.x = o.x - 0.8; a.y = o.y + 0.6; }
      else if (d > 0.6) {
        const s = Math.min(d, speed / TICK_RATE * (d > 3 ? 1.3 : 0.9));
        if (!this.moveBy(a, dx / d * s, dy / d * s)) { a.x += dx / d * s; a.y += dy / d * s; }
        a.dir = dirFromVector(dx, dy); moving = true;
      }
    }
    if (this.tick >= (a.animLock || 0)) this.setAnim(a, moving ? 'walk' : 'idle');
  },
};
