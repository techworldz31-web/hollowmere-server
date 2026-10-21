// Boss fights: every boss has a fight of its own, with phases (things change as its health
// falls), helpers it calls in, and big attacks shown on the ground first (a warning circle) so a
// player who watches can step out of the way. (The three Hollow Deep bosses and Snikt keep the
// fights in world.js; this covers everyone else.)
// Installed onto World's prototype (see the bottom of world.js).
import { MOBS } from './content.js';
import { TICK_RATE } from './constants.js';
import { isBlocked } from './pathfind.js';

const T = (s) => Math.round(s * TICK_RATE);

export const bossMethods = {
  // -> true when this boss has a fight here
  bossFight(m, t, def, ready) {
    const F = FIGHTS[m.kind]; if (!F) return false;
    F.call(this, m, t, def, ready, kit(this, m, t));
    return true;
  },
};

// the moves the fights are made of
function kit(w, m, t) {
  const ph = m.phases || (m.phases = {});
  const K = {
    // once, the first time health drops below pct
    below: (key, pct) => { if (ph[key] || m.hp >= m.maxHp * pct) return false; ph[key] = true; return true; },
    yell: (text) => { w.evAt(m, { e: 'bossyell', id: m.id, text }); w.evAt(m, { e: 'fx', k: 'roar', x: m.x, y: m.y }); },
    adds: (kind, n) => { if (MOBS[kind]) w.summon(m, kind, n); },
    // a circle round the boss itself
    ring: (r, delay, mult, name) => { w.playAnim(m, 'attack', delay); m.swingAt = 0; w.telegraph(m, m.x, m.y, r, delay, mult, name); },
    // a circle where the target stands now
    at: (r, delay, mult, name) => { w.playAnim(m, 'cast', Math.min(1, delay)); w.telegraph(m, t.x, t.y, r, delay, mult, name); },
    // jump onto the target's spot: the circle first, then the boss lands there
    leap: (r, delay, mult, name) => {
      const x = t.x, y = t.y; w.playAnim(m, 'attack', delay); m.swingAt = 0; w.telegraph(m, x, y, r, delay, mult, name);
      w.later(delay, () => { if (w.ents.has(m.id) && m.hp > 0 && !isBlocked(w.mapOf(m), Math.floor(x), Math.floor(y))) { m.x = x; m.y = y; m.path = null; } });
    },
    // circles in a line from the boss toward the target (a breath, a charge)
    line: (n, step, r, delay, mult, name) => {
      const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1;
      w.playAnim(m, 'attack', delay); m.swingAt = 0;
      for (let i = 1; i <= n; i++) w.telegraph(m, m.x + dx / d * step * i, m.y + dy / d * step * i, r, delay + i * 0.08, mult, name);
    },
    // circles scattered round the target (falling rocks, ice, poison pools)
    rain: (n, spread, r, delay, mult, name) => {
      w.playAnim(m, 'cast', 1);
      for (let i = 0; i < n; i++) {
        const a = w.rng() * Math.PI * 2, d = i === 0 ? 0 : 1 + w.rng() * spread;
        w.telegraph(m, t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, r, delay + i * 0.15, mult, name);
      }
    },
    // a fan of missiles at the target
    fan: (kind, n, spread, mult) => {
      const base = Math.atan2(t.y - m.y, t.x - m.x);
      w.playAnim(m, 'attack', 0.5);
      for (let i = 0; i < n; i++) { const a = base + (i - (n - 1) / 2) * spread; w.shoot(m, kind, m.x + Math.cos(a) * 6, m.y + Math.sin(a) * 6, mult); }
    },
    // whoever is caught near the boss is slowed (frost, mud)
    slowNear: (r, sec) => { for (const p of w.playersNear(m.x, m.y, r, m.zone)) p.slowUntil = w.tick + T(sec); },
    // vanish in smoke and reappear a few steps away
    blink: (dist) => {
      w.evAt(m, { e: 'fx', k: 'nova', x: m.x, y: m.y, r: 1.5 });
      for (let k = 0; k < 12; k++) {
        const a = w.rng() * Math.PI * 2, x = t.x + Math.cos(a) * dist, y = t.y + Math.sin(a) * dist;
        if (!isBlocked(w.mapOf(m), Math.floor(x), Math.floor(y))) { m.x = x; m.y = y; m.path = null; break; }
      }
      w.evAt(m, { e: 'fx', k: 'nova', x: m.x, y: m.y, r: 1.5 });
    },
  };
  return K;
}

const FIGHTS = {
  // Grukk, the goblin chief (level 7): smashes the ground, throws firebombs, calls his boys,
  // and loses his temper at the end
  goblin_chief(m, t, def, ready, K) {
    if (K.below('boys', 0.6)) { K.yell('BOYS! Get over here!'); K.adds('goblin', 2); }
    if (K.below('rage', 0.3)) { K.yell('GRUKK... ANGRY!'); m.enraged = true; }
    if (ready('smash', m.enraged ? 7 : 9)) K.ring(2.4, 1.2, 1.4, 'Grukk Smash');
    else if (ready('bomb', 12)) K.at(1.8, 1.4, 1.2, 'Firebomb');
  },
  // Warboss Gnash, who leads the night raids (level 8): leaps onto you, calls more raiders
  raid_captain(m, t, def, ready, K) {
    if (K.below('horde', 0.5)) { K.yell('Raiders! BURN IT ALL!'); K.adds('raider', 3); }
    if (ready('leap', 11)) K.leap(2.0, 1.2, 1.3, 'Warboss Leap');
    else if (ready('cleave', 7)) K.line(2, 1.2, 1.2, 0.9, 1.1, 'Cleave');
  },
  // Greymuzzle, the pinewood alpha on Tutorial Island (level 4): lunges, and howls for the pack
  pinewood_alpha(m, t, def, ready, K) {
    if (K.below('howl', 0.5)) { K.yell('*HOOOWWWL*'); K.adds('young_wolf', 2); }
    if (ready('lunge', 9)) K.leap(1.5, 1.1, 1.2, 'Lunge');
  },
  // Red Vesna, the bandit captain (level 10): throwing knives, a smoke bomb, caltrops
  bandit_captain(m, t, def, ready, K) {
    if (K.below('smoke', 0.5)) { K.yell('Catch me if you can!'); K.blink(4.5); K.adds(def.adds || 'bandit', 2); }
    if (ready('knives', 7)) K.fan('arrow', 5, 0.22, 0.6);
    else if (m.hp < m.maxHp * 0.5 && ready('caltrops', 11)) K.rain(3, 2.2, 1.2, 1.5, 1.0, 'Caltrops');
    else if (ready('slash', 9)) K.at(1.6, 1.0, 1.4, 'Twin Slash');
  },
  // Grak, the hill king (level 15): pounds the ground, hurls boulders, heals like a troll
  troll_king(m, t, def, ready, K) {
    if (K.below('kin', 0.4)) { K.yell('Smash the little one!'); K.adds(def.adds || 'hill_troll', 2); }
    if (ready('regen', 1) && m.hp > 0 && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.003));
    if (ready('pound', 10)) K.ring(3.0, 1.3, 1.5, 'Ground Pound');
    else if (ready('boulder', 8)) K.at(1.8, 1.6, 1.4, 'Boulder');
  },
  // Hrimfang, the frost wyrm (level 18): frost breath, an icy nova that slows, and an ice storm
  frost_wyrm(m, t, def, ready, K, w = this) {
    if (K.below('wraiths', 0.6)) { K.yell('*the wyrm shrieks, and the cold answers*'); K.adds(def.adds || 'frost_wraith', 2); }
    if (K.below('storm', 0.5)) K.yell('The air turns to ice!');
    if (ready('breath', 9)) K.line(4, 1.4, 1.3, 1.2, 1.2, 'Frost Breath');
    else if (ready('nova', 14)) { K.ring(3.5, 1.5, 1.0, 'Icy Nova'); w.later(1.5, () => w.ents.has(m.id) && K.slowNear(3.5, 4)); }
    else if (m.hp < m.maxHp * 0.5 && ready('storm', 6)) K.rain(4, 3, 1.4, 1.6, 1.0, 'Ice Storm');
  },
  // Old Mother Mire, the swamp hag (level 20): bog pools under your feet, bolts of shadow,
  // and her pets rising from the mud twice
  mire_hag(m, t, def, ready, K, w = this) {
    if (K.below('pets1', 0.66)) { K.yell('Rise, my sweet ones!'); K.adds(def.adds || 'bog_lurker', 2); }
    if (K.below('pets2', 0.33)) { K.yell('Rise again!'); K.adds(def.adds || 'bog_lurker', 2); }
    if (ready('pools', 8)) { K.rain(3, 2.5, 1.6, 1.8, 1.0, 'Bog Pool'); w.later(1.8, () => { for (const p of w.playersNear(t.x, t.y, 2.5, m.zone)) p.slowUntil = w.tick + T(3); }); }
    else if (m.hp < m.maxHp * 0.7 && ready('volley', 6)) K.fan('shadowbolt', 3, 0.3, 0.8);
  },
};
