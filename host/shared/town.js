// When buildings have their lights on. Every house keeps its own hours (some
// light up early, some late, a few stay dark: nobody's home), the same on the
// server (townsfolk go home when their lights come on) and on every client.
import { DAWN, DUSK } from './content.js';
import { hash2 } from './rng.js';

export const HOMES = new Set(['townhouse', 'house_small', 'house_large']);
export const between = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);   // with wrap past midnight

// -> { on, off } as times of day (off may be past midnight), or null for a house that stays dark
export function hoursOf(kind, id) {
  const h1 = hash2(id, 3, 77), h2 = hash2(id, 5, 78);
  if (HOMES.has(kind)) {
    if (hash2(id, 7, 79) < 0.18) return null;
    return { on: DUSK - 0.025 + h1 * 0.07, off: (0.94 + h2 * 0.13) % 1, dawn: hash2(id, 9, 80) < 0.3 };
  }
  if (kind === 'tavern' || kind.startsWith('inn')) return { on: DUSK - 0.04, off: 0.08 };
  if (kind.startsWith('shop')) return { on: DUSK - 0.03, off: 0.96 };
  if (kind === 'chapel' || kind.startsWith('chapel')) return { on: DUSK - 0.02, off: 0.03 };
  return { on: 0, off: 1 };
}

export function litAt(kind, id, tod) {
  const H = hoursOf(kind, id);
  if (!H) return false;
  if (H.dawn && between(tod, DAWN - 0.05, DAWN + 0.02)) return true;
  return between(tod, H.on, H.off);
}
