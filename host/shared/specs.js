// Specialisations: at the level 10 trial each hero chooses a path. A path brings a passive
// bonus and two skills of its own (hotbar keys 7 and 8), ranked up with skill points like
// any other. The trainer will change your path later, for a fee.
//
// Passive bonuses use the same names as gear bonuses (see shared/stats.js):
//   atk, def, hp (fractions), crit (chance), critDmg (extra crit damage), haste (attack speed),
//   spd (movement), lifesteal (share of damage dealt), block (chance to halve a hit),
//   burn (fire damage over time, as a share of the hit), slowBonus (more damage to slowed foes),
//   petPower (the Spirit Wolf hits harder).

export const SPEC_UNLOCK = 10;
export const respecCost = (level) => 40 * level;

export const SPECS = {
  guardian: {
    cls: 'warrior', name: 'Guardian', role: 'Defender',
    blurb: 'A wall of steel. Holds the line, draws every blade to himself and shrugs off what would kill anyone else.',
    passive: { def: 0.12, hp: 0.08, block: 0.1 }, skills: ['taunt', 'shieldwall'],
  },
  berserker: {
    cls: 'warrior', name: 'Berserker', role: 'Damage',
    blurb: 'Fury and steel. Every wound dealt closes one of his own, and the angrier he gets the faster he swings.',
    passive: { atk: 0.12, lifesteal: 0.05 }, skills: ['bloodthirst', 'rampage'],
  },
  marksman: {
    cls: 'ranger', name: 'Marksman', role: 'Damage',
    blurb: 'One arrow, one kill. Patient, precise, and deadly at the longest range.',
    passive: { crit: 0.1, critDmg: 0.35 }, skills: ['aimedshot', 'huntersmark'],
  },
  beastmaster: {
    cls: 'ranger', name: 'Beastmaster', role: 'Skirmisher',
    blurb: 'Never hunts alone. Calls a spirit wolf to the fight and lays snares no beast escapes.',
    passive: { atk: 0.06, spd: 0.1, haste: 0.08, petPower: 0.25 }, skills: ['spiritwolf', 'snaretrap'],
  },
  pyromancer: {
    cls: 'mage', name: 'Pyromancer', role: 'Damage',
    blurb: 'Burns everything. Every spell sets its target alight, and nothing puts the fire out.',
    passive: { atk: 0.08, burn: 0.3 }, skills: ['flamewave', 'livingbomb'],
  },
  frostbinder: {
    cls: 'mage', name: 'Frostbinder', role: 'Control',
    blurb: 'Patience made of ice. Slows, freezes and shields, then shatters what can no longer move.',
    passive: { def: 0.1, slowBonus: 0.2 }, skills: ['icebarrier', 'glacialspike'],
  },
};
export const SPEC_ORDER = { warrior: ['guardian', 'berserker'], ranger: ['marksman', 'beastmaster'], mage: ['pyromancer', 'frostbinder'] };

const pct = (v) => `${Math.round(v * 100)}%`;
export function passiveText(P) {
  return [P.atk && `+${pct(P.atk)} attack`, P.def && `+${pct(P.def)} defense`, P.hp && `+${pct(P.hp)} health`,
    P.crit && `+${pct(P.crit)} critical chance`, P.critDmg && `critical hits deal ${pct(P.critDmg)} more`,
    P.haste && `+${pct(P.haste)} attack speed`, P.spd && `+${pct(P.spd)} movement speed`,
    P.lifesteal && `heal for ${pct(P.lifesteal)} of the damage you deal`, P.block && `${pct(P.block)} chance to block half of a hit`,
    P.burn && `your fire and spells burn for ${pct(P.burn)} more over 3s`, P.slowBonus && `+${pct(P.slowBonus)} damage to slowed or frozen enemies`,
    P.petPower && `your Spirit Wolf hits ${pct(P.petPower)} harder`].filter(Boolean).join(' · ');
}

// target: 'dir' aims toward the cursor, 'point' acts at the cursor, 'self' acts around you
export const SPEC_SKILLS = {
  taunt:        { name: 'Challenging Shout', cls: 'warrior', spec: 'guardian', cd: 14, anim: 'cast', target: 'self', icon: 'taunt',
    desc: (r) => `Every enemy within 6 tiles turns on you, and a ward absorbs the next ${30 + r * 10}% of your health in damage for 6s.` },
  shieldwall:   { name: 'Shield Wall', cls: 'warrior', spec: 'guardian', cd: 30, anim: 'cast', target: 'self', icon: 'shieldwall',
    desc: (r) => `Brace behind your shield: take ${40 + r * 10}% less damage for ${5 + r}s.` },
  bloodthirst:  { name: 'Bloodthirst', cls: 'warrior', spec: 'berserker', cd: 6, anim: 'attack', target: 'dir', icon: 'bloodthirst',
    desc: (r) => `A savage strike for ${180 + r * 30}% damage that heals you for ${30 + r * 5}% of the damage dealt.` },
  rampage:      { name: 'Rampage', cls: 'warrior', spec: 'berserker', cd: 30, anim: 'cast', target: 'self', icon: 'rampage',
    desc: (r) => `Give in to fury for ${7 + r * 2}s: +${30 + r * 10}% attack speed and +${15 + r * 5}% damage. Costs 10% of your health.` },
  aimedshot:    { name: 'Aimed Shot', cls: 'ranger', spec: 'marksman', cd: 9, anim: 'cast', target: 'dir', icon: 'aimedshot',
    desc: (r) => `Draw for a moment, then loose an arrow that always strikes critically for ${240 + r * 45}% damage.` },
  huntersmark:  { name: "Hunter's Mark", cls: 'ranger', spec: 'marksman', cd: 16, anim: 'cast', target: 'point', range: 10, icon: 'huntersmark',
    desc: (r) => `Mark every enemy within 2.5 tiles of the cursor: they take ${20 + r * 8}% more damage from everyone for 10s.` },
  spiritwolf:   { name: 'Spirit Wolf', cls: 'ranger', spec: 'beastmaster', cd: 25, anim: 'cast', target: 'self', icon: 'spiritwolf',
    desc: (r) => `Call a spirit wolf to fight beside you for ${18 + r * 6}s. It bites your target for ${45 + r * 15}% of your attack.` },
  snaretrap:    { name: 'Snare Trap', cls: 'ranger', spec: 'beastmaster', cd: 12, anim: 'cast', target: 'point', range: 7, icon: 'snaretrap',
    desc: (r) => `Throw a snare to the cursor. The first enemies to step in (within 1.5 tiles) take ${150 + r * 30}% damage and are held for ${2 + r * 0.5}s.` },
  flamewave:    { name: 'Flame Wave', cls: 'mage', spec: 'pyromancer', cd: 8, anim: 'attack', target: 'dir', icon: 'flamewave',
    desc: (r) => `A wave of fire rolls 4 tiles ahead of you, burning everything in its path for ${170 + r * 30}% damage.` },
  livingbomb:   { name: 'Living Bomb', cls: 'mage', spec: 'pyromancer', cd: 12, anim: 'attack', target: 'point', range: 9, icon: 'livingbomb',
    desc: (r) => `Plant a fire in the enemy nearest the cursor. After 3s it explodes for ${250 + r * 45}% damage to everything within 2.5 tiles.` },
  icebarrier:   { name: 'Ice Barrier', cls: 'mage', spec: 'frostbinder', cd: 20, anim: 'cast', target: 'self', icon: 'icebarrier',
    desc: (r) => `Encase yourself in ice that absorbs ${35 + r * 12}% of your health in damage for 10s. Enemies that strike it are slowed.` },
  glacialspike: { name: 'Glacial Spike', cls: 'mage', spec: 'frostbinder', cd: 9, anim: 'attack', target: 'dir', icon: 'glacialspike',
    desc: (r) => `A spike of ice that pierces every enemy in a line for ${200 + r * 35}% damage and freezes them for ${1 + r * 0.5}s.` },
};

// the skills a hero has on the hotbar: the class's five, then the path's two
export function skillList(cls, spec, CLASSES) {
  const base = CLASSES[cls].skills;
  return spec && SPECS[spec]?.cls === cls ? [...base, ...SPECS[spec].skills] : base;
}
