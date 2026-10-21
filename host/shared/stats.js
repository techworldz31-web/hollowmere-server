// A hero's bonuses from every source in one place: the specialisation's passive and the
// bonus stats rolled on Fine and Masterwork gear. World.recalcStats keeps the sum in p.mods,
// and combat reads it from there.
import { SPECS } from './specs.js';

export const MOD_KEYS = ['atk', 'def', 'hp', 'hpFlat', 'crit', 'critDmg', 'haste', 'spd', 'regen', 'xp', 'lifesteal', 'block', 'burn', 'slowBonus', 'petPower'];

// the bonus stats gear can roll, how big a roll is per tier (Fine; Masterwork rolls 1.6x), and how they read
export const GEAR_BONUS = {
  hpFlat: { name: 'health', per: (t) => 6 + t * 6, fmt: (v) => `+${Math.round(v)} health` },
  crit:   { name: 'critical chance', per: (t) => 0.01 + t * 0.005, fmt: (v) => `+${(v * 100).toFixed(1)}% critical chance` },
  haste:  { name: 'attack speed', per: (t) => 0.015 + t * 0.006, fmt: (v) => `+${Math.round(v * 100)}% attack speed` },
  spd:    { name: 'movement speed', per: (t) => 0.02 + t * 0.006, fmt: (v) => `+${Math.round(v * 100)}% movement speed` },
  regen:  { name: 'regeneration', per: (t) => 0.4 + t * 0.3, fmt: (v) => `+${v.toFixed(1)} health a second` },
  xp:     { name: 'experience', per: (t) => 0.02 + t * 0.01, fmt: (v) => `+${Math.round(v * 100)}% experience` },
};
export const GEAR_BONUS_KEYS = Object.keys(GEAR_BONUS);

export function emptyMods() { const m = {}; for (const k of MOD_KEYS) m[k] = 0; return m; }

export function playerMods(p) {
  const m = emptyMods();
  const S = p.spec && SPECS[p.spec];
  if (S && S.cls === p.cls) for (const [k, v] of Object.entries(S.passive)) m[k] += v;
  for (const e of Object.values(p.equip || {})) if (e?.b) for (const [k, v] of Object.entries(e.b)) if (k in m) m[k] += v;
  return m;
}

// "+1.8% critical chance" etc. for one gear piece's bonus
export function bonusText(b) { return Object.entries(b || {}).map(([k, v]) => GEAR_BONUS[k]?.fmt(v)).filter(Boolean); }
