// The road from level 1 to 20: four new regions beyond the starting area (each with
// fixed level bands), their monsters and quest-givers, the class trainers, the level
// 10 and 20 armour sets, and about sixty quests. Quest experience is paced so that
// following the quests (and fighting what they send you to fight) takes about eight
// hours from level 1 to 20: each quest's reward is a share of its level's experience,
// weighted by how much work it is. Pure data; content.js merges it in.

// ---- experience to the next level (1 -> 2 is quick, 19 -> 20 takes about 45 minutes) ----
const XP_TABLE = [0, 430, 600, 1100, 1700, 2400, 3500, 4800, 6200, 7500, 8900, 11000, 13200, 15400, 18100, 20700, 23400, 26600, 29900, 33500];
export function xpCurve(level) { return level < XP_TABLE.length ? XP_TABLE[level] : Math.round(33500 * Math.pow(level / 19, 2)); }
export const MAX_LEVEL = 99;
const QUEST_SHARE = 0.6;     // the rest comes from the monsters you fight along the way

// ---- regions (the starting area keeps its own fixed monsters) ----------------------------
// x, y, r: roughly where the region is, for the "you enter ..." banner
export const REGIONS = {
  whisperwood: { name: 'Whisperwood', levels: '6-10', x: 36, y: 140, r: 34 },
  highlands:   { name: 'The Westreach Highlands', levels: '11-14', x: 26, y: 92, r: 30 },
  frostridge:  { name: 'Frostridge', levels: '14-17', x: 150, y: 28, r: 24 },
  blackmarsh:  { name: 'The Blackmarsh', levels: '17-20', x: 160, y: 156, r: 28 },
};
// places quests send you to look at (positions are filled in by the map generator)
export const SPOT_NAMES = {
  thornwick: 'Thornwick Lodge', bandit_hideout: 'the bandit hideout on the hill', ridgewatch: 'Ridgewatch Outpost', old_watchtower: 'the old watchtower',
  hermitage: 'the Frostridge Hermitage', frozen_shrine: 'the frozen shrine', fenwatch: 'Fenwatch', sunken_altar: 'the sunken altar', willow_ford: 'Willow Ford',
};

// ---- monsters of the new regions ----------------------------------------------------------
// stats follow the level: hp 20 + 14 L^1.35, attack 8 + 2.6 L, defense 2 + 0.6 L (bosses ~9x hp)
const hpAt = (L, k = 1) => Math.round((20 + 14 * Math.pow(L, 1.35)) * k), atkAt = (L, k = 1) => Math.round((8 + 2.6 * L) * k), defAt = (L) => Math.round(2 + 0.6 * L);
function mob(name, sprite, L, xp, o = {}) {
  return { name, sprite, lv: L, hp: hpAt(L, o.hpK || 1), atk: atkAt(L, o.atkK || 1), def: defAt(L), speed: o.speed ?? 2.5,
    range: o.range ?? 1.35, cooldown: o.cooldown ?? 1.2, windup: o.windup ?? 0.35, aggro: o.aggro ?? 7, leash: o.leash ?? 16,
    xp, gold: o.gold || [Math.round(L * 1.4), Math.round(L * 3.2)], loot: o.loot || [['potion', 0.15]], gear: o.gear || [0.07, L < 11 ? [2, 3] : [3, 4]],
    rarity: o.rarity || [60, 30, 10], respawn: o.respawn ?? 25, ...(o.extra || {}) };
}
export const QUEST_MOBS = {
  wolf:           mob('Grey Wolf', 'wolf', 6, 50, { speed: 3.2, aggro: 8, loot: [['potion', 0.12]] }),
  boar:           mob('Tusked Boar', 'boar', 7, 55, { speed: 2.9, hpK: 1.15 }),
  bandit:         mob('Whisperwood Bandit', 'bandit', 8, 62, { loot: [['potion', 0.2], ['scrap', 0.4]] }),
  bandit_captain: mob('Red Vesna, Bandit Captain', 'bandit_captain', 10, 650, { hpK: 8, atkK: 1.15, range: 1.5, cooldown: 1.3, aggro: 9, respawn: 120, gold: [90, 160], loot: [['potion', 1], ['potion', 1]], gear: [1, [3]], rarity: [20, 50, 30], extra: { boss: true, mech: 'champion', adds: 'bandit' } }),
  dire_wolf:      mob('Dire Wolf', 'dire_wolf', 11, 85, { speed: 3.3, aggro: 8 }),
  golem:          mob('Stone Golem', 'golem', 12, 92, { speed: 2.0, hpK: 1.3, atkK: 1.05 }),
  hill_troll:     mob('Hill Troll', 'hill_troll', 13, 100, { speed: 2.3, hpK: 1.25, range: 1.6 }),
  troll_king:     mob('Grak the Hill King', 'troll_king', 15, 1400, { hpK: 9, atkK: 1.15, range: 1.8, cooldown: 1.5, aggro: 10, respawn: 150, gold: [160, 260], loot: [['potion_big', 1], ['potion_big', 1]], gear: [1, [4]], rarity: [10, 50, 40], extra: { boss: true, mech: 'champion', adds: 'hill_troll', scale: 1.1 } }),
  frost_wraith:   mob('Frost Wraith', 'frost_wraith', 15, 132, { range: 6, cooldown: 1.7, windup: 0.5, speed: 2.4, extra: { ranged: 'bolt' } }),
  ice_golem:      mob('Ice Golem', 'ice_golem', 16, 142, { speed: 2.0, hpK: 1.3 }),
  frost_wyrm:     mob('Hrimfang the Frost Wyrm', 'frost_wyrm', 18, 2400, { hpK: 9.5, atkK: 1.2, range: 2.2, cooldown: 1.6, aggro: 11, respawn: 180, speed: 2.6, gold: [220, 340], loot: [['potion_big', 1], ['potion_big', 1]], gear: [1, [4]], rarity: [0, 50, 50], extra: { boss: true, mech: 'champion', adds: 'frost_wraith', scale: 1.2 } }),
  bog_lurker:     mob('Bog Lurker', 'bog_lurker', 17, 172, { speed: 2.4, hpK: 1.2 }),
  cultist:        mob('Mire Cultist', 'cultist', 18, 190, { range: 6, cooldown: 1.7, windup: 0.5, extra: { ranged: 'shadowbolt' } }),
  mire_hag:       mob('Old Mother Mire', 'mire_hag', 20, 3500, { hpK: 10, atkK: 1.2, range: 7, cooldown: 2.0, windup: 0.6, aggro: 12, respawn: 200, gold: [300, 450], loot: [['potion_big', 1], ['potion_big', 1]], gear: [1, [4]], rarity: [0, 40, 60], extra: { boss: true, mech: 'champion', adds: 'bog_lurker', ranged: 'shadowbolt' } }),
};
// the starting area's monsters get level labels (their stats stay as they are)
export const START_LEVELS = { slime: 5, goblin: 6, goblin_chief: 7, raider: 6, raid_captain: 8, goblin_miner: 8, goblin_foreman: 9, spider: 9, spiderling: 7, spider_queen: 10, skeleton: 11, skeleton_archer: 11, hollow_king: 12 };
// where they live: region, centre, spread, count, and which plateau tier (0 = the ground)
export const SPAWN_PLAN = [
  { kind: 'wolf', x: 26, y: 132, r: 12, n: 12 }, { kind: 'wolf', x: 54, y: 128, r: 8, n: 6 },
  { kind: 'boar', x: 46, y: 140, r: 10, n: 10 },
  { kind: 'bandit', x: 44, y: 162, r: 9, n: 12, tier: 1 },
  { kind: 'bandit_captain', x: 44, y: 163, r: 1, n: 1, tier: 1 },
  { kind: 'dire_wolf', x: 50, y: 82, r: 12, n: 12 },
  { kind: 'golem', x: 22, y: 96, r: 15, n: 12, tier: 1 },
  { kind: 'hill_troll', x: 24, y: 95, r: 6, n: 8, tier: 2 },
  { kind: 'troll_king', x: 24, y: 95, r: 1, n: 1, tier: 2 },
  { kind: 'frost_wraith', x: 150, y: 25, r: 13, n: 12, tier: 1 },
  { kind: 'ice_golem', x: 150, y: 25, r: 13, n: 10, tier: 1 },
  { kind: 'frost_wyrm', x: 150, y: 24, r: 1, n: 1, tier: 2 },
  { kind: 'bog_lurker', x: 143, y: 166, r: 12, n: 12 },
  { kind: 'cultist', x: 161, y: 151, r: 10, n: 12, tier: 1 },
  { kind: 'mire_hag', x: 161, y: 151, r: 1, n: 1, tier: 1 },
];

// ---- quest-givers and trainers ---------------------------------------------------------------
export const QUEST_NPCS = {
  warden_elsa:   { name: 'Warden Elsa', sprite: 'warden_elsa', role: 'quest', spot: 'thornwick', lines: ['The woods are not what they were. Something has the wolves stirred up.', 'Keep your bowstring dry and your back to a tree.'] },
  trapper_odo:   { name: 'Odo the Trapper', sprite: 'trapper_odo', role: 'quest', spot: 'thornwick', lines: ['Boar tusk, wolf pelt, bandit purse. I trade in all three.', 'Never trust a quiet forest.'] },
  captain_rourke:{ name: 'Captain Rourke', sprite: 'captain_rourke', role: 'quest', spot: 'ridgewatch', lines: ['Ridgewatch has held for ninety years. It will hold ninety more if I have a say.', 'Trolls can smell fear. Also cheese. Mostly cheese.'] },
  scout_tamsin:  { name: 'Scout Tamsin', sprite: 'scout_tamsin', role: 'quest', spot: 'ridgewatch', lines: ['I have mapped every crag up there. Twice. The golems keep moving them.'] },
  hermit_ysolde: { name: 'Ysolde the Hermit', sprite: 'hermit_ysolde', role: 'quest', spot: 'hermitage', lines: ['The cold up here is old. Older than the wyrm. It remembers things.', 'Sit. Warm your hands. Then go and do something brave.'] },
  witch_corda:   { name: 'Corda the Witchfinder', sprite: 'witch_corda', role: 'quest', spot: 'fenwatch', lines: ['The marsh keeps what it takes. I mean to take some of it back.', 'Do not follow the lights in the fog. Ever.'] },
  ferryman_gil:  { name: 'Gil the Ferryman', sprite: 'ferryman_gil', role: 'quest', spot: 'fenwatch', lines: ['I used to ferry folk across the fen. Now I mostly ferry them away from it.'] },
  trainer_warrior: { name: 'Weapon-Master Torvald', sprite: 'trainer_warrior', role: 'quest', trainer: 'warrior', lines: ['Strength is a habit. Build it every day.', 'Shield up, chin down, feet planted.'] },
  trainer_ranger:  { name: 'Huntmaster Sylvi', sprite: 'trainer_ranger', role: 'quest', trainer: 'ranger', lines: ['Breathe out before you loose. Always.', 'The forest teaches patience, if you let it.'] },
  trainer_mage:    { name: 'Archmage Corvin', sprite: 'trainer_mage', role: 'quest', trainer: 'mage', lines: ['Magic is just a very polite argument with the world.', 'Mind your eyebrows. I lost mine in my second year.'] },
};

// ---- items: quest trophies and the milestone armour sets -----------------------------------------
const qi = (name, icon, desc) => ({ name, type: 'quest', stack: 20, price: 0, icon, desc });
export const QUEST_ITEMS = {
  cart_goods:     qi('Stolen Cart Goods', 'icon_flour', 'Sacks and parcels the goblins took from the carts.'),
  wolf_pelt:      qi('Wolf Pelt', 'mat_trophy', 'Thick grey fur. Warden Elsa wants these.'),
  boar_tusk:      qi('Boar Tusk', 'mat_fang', 'Curved and sharp. Odo trades them.'),
  stolen_coin:    qi('Stolen Coin Purse', 'item_gold', 'Bandit loot. It belongs to the farms around Hollowmere.'),
  golem_core:     qi('Golem Core', 'icon_rough_gem', 'A warm stone heart that still hums.'),
  troll_tusk:     qi('Troll Tusk', 'mat_fang', 'Yellow, cracked and enormous.'),
  wraith_essence: qi('Wraith Essence', 'icon_glow_bait', 'Cold light in a jar. It whispers.'),
  frost_crystal:  qi('Frost Crystal', 'mat_shard', 'Never melts, even in your hand.'),
  lurker_hide:    qi('Lurker Hide', 'mat_silk', 'Slimy, scaly and surprisingly tough.'),
  drowned_locket: qi('Drowned Locket', 'item_gold', 'Tarnished silver. Gil knows whose these were.'),
  cult_orders:    qi('Cult Orders', 'quest_map', 'Damp parchment in a spidery hand. Someone is giving orders.'),
  cult_sigil:     qi('Cult Sigil', 'mat_shard', 'A crude charm of bone and reed. It smells of the fen.'),
  warden_letter:  qi("Elsa's Letter", 'quest_map', 'Sealed with the warden\'s oak leaf. For Captain Rourke.'),
};
export const SET_ITEMS = {
  armor_w5: { name: 'Vanguard Plate', type: 'armor', cls: 'warrior', tier: 5, def: 34, atk: 6, price: 1800, icon: 'warrior/a5/idle/1/0', desc: 'The level 10 milestone armour: blued steel and a lion crest. Earned, never sold.' },
  armor_r5: { name: 'Wildstalker Leathers', type: 'armor', cls: 'ranger', tier: 5, def: 26, atk: 7, price: 1800, icon: 'ranger/a5/idle/1/0', desc: 'The level 10 milestone armour: green leathers and a wolf-fur mantle.' },
  armor_m5: { name: 'Stormweave Robes', type: 'armor', cls: 'mage', tier: 5, def: 23, atk: 8, price: 1800, icon: 'mage/a5/idle/1/0', desc: 'The level 10 milestone armour: storm-blue robes stitched with silver lightning.' },
  armor_w6: { name: 'Dawnforged Aegis', type: 'armor', cls: 'warrior', tier: 6, def: 52, atk: 14, price: 4500, icon: 'warrior/a6/idle/1/0', desc: 'The level 20 milestone armour: white steel and sun-gold, a crimson cape.' },
  armor_r6: { name: 'Mantle of the Eternal Hunt', type: 'armor', cls: 'ranger', tier: 6, def: 40, atk: 16, price: 4500, icon: 'ranger/a6/idle/1/0', desc: 'The level 20 milestone armour: silver-green scale and a cloak of autumn leaves.' },
  armor_m6: { name: 'Vestments of the Archon', type: 'armor', cls: 'mage', tier: 6, def: 36, atk: 18, price: 4500, icon: 'mage/a6/idle/1/0', desc: 'The level 20 milestone armour: violet and gold, a crown of floating runes.' },
};

// ---- skills earned at the milestones -----------------------------------------------------------------
export const MILESTONE_SKILLS = { 10: { warrior: 'shieldslam', ranger: 'piercing', mage: 'chainlight' }, 20: { warrior: 'earthshaker', ranger: 'eagleeye', mage: 'meteor' } };
export const QUEST_SKILLS = {
  shieldslam:  { name: 'Shield Slam', cls: 'warrior', cd: 9, anim: 'attack', target: 'dir', icon: 'shieldslam', unlock: 10,
    desc: (r) => `Smash your shield into the enemies in front of you for ${170 + r * 30}% damage and stun them for ${(1.5 + r * 0.5).toFixed(1)}s.` },
  earthshaker: { name: 'Earthshaker', cls: 'warrior', cd: 20, anim: 'attack', target: 'self', icon: 'earthshaker', unlock: 20,
    desc: (r) => `Slam the ground: everything within 4 tiles takes ${260 + r * 40}% damage, is stunned for 1s and slowed for ${2 + r}s.` },
  piercing:    { name: 'Piercing Shot', cls: 'ranger', cd: 8, anim: 'attack', target: 'dir', icon: 'piercing', unlock: 10,
    desc: (r) => `A heavy arrow that passes through every enemy in a line for ${210 + r * 35}% damage.` },
  eagleeye:    { name: 'Eagle Eye', cls: 'ranger', cd: 28, anim: 'cast', target: 'self', icon: 'eagleeye', unlock: 20,
    desc: (r) => `For ${6 + r * 2}s you shoot twice as fast and every arrow deals ${25 + r * 10}% more damage.` },
  chainlight:  { name: 'Chain Lightning', cls: 'mage', cd: 7, anim: 'attack', target: 'dir', icon: 'chainlight', unlock: 10,
    desc: (r) => `Lightning leaps between up to ${3 + r} enemies, ${160 + r * 25}% damage each.` },
  meteor:      { name: 'Meteor', cls: 'mage', cd: 22, anim: 'cast', target: 'point', range: 9, icon: 'meteor', unlock: 20,
    desc: (r) => `Call down a meteor: after a moment it crashes for ${380 + r * 60}% damage to everything within 3 tiles.` },
};

export const QUEST_TITLES = {
  warden_friend: 'Friend of the Wardens', bandit_breaker: 'Banditbreaker', ridgewalker: 'Ridgewalker', trollslayer: 'Trollslayer',
  wyrmbane: 'Wyrmbane', fenwalker: 'Fenwalker', hagbane: 'Hagbane', veteran: 'Veteran of Hollowmere', champion: 'Champion of Hollowmere',
};

// ---- the quests ------------------------------------------------------------------------------------------
// lv: the level it is meant for; w: how much work it is (the experience reward is shared out by w).
// minLv / cls: who can take it. kind: kill | collect | talk | visit (at: a spot id).
const Q = {};
const add = (id, q) => { Q[id] = q; };

// Starting area: Elder Maren's chain, Pip, Tobin, the farm and the inn. (Existing quests get their lv/w here.)
export const START_PACING = {
  // (heroes arrive from Tutorial Island at level 5, so the town's work is for levels 5 to 7)
  slimes: { lv: 5, w: 2 }, pip: { lv: 5, w: 1.5 }, tobin: { lv: 5, w: 1.5 }, rod: { lv: 5, w: 0.6 }, harvest1: { lv: 5, w: 1.2 },
  goblins: { lv: 6, w: 2 }, bream: { lv: 5, w: 0.8 }, chief: { lv: 7, w: 2.5 }, map: { lv: 7, w: 0.6 },
  deep1: { lv: 9, w: 3 }, iron: { lv: 9, w: 1.2 }, silk: { lv: 10, w: 1.4 }, deep2: { lv: 11, w: 3 }, deep3: { lv: 13, w: 3.5 }, legend: { lv: 14, w: 2 },
};

// --- starting area, new
add('cart_goods', { title: 'The Missing Carts', giver: 'merchant', requires: null, lv: 6, w: 1.6, kind: 'collect', item: 'cart_goods', count: 5,
  offer: 'Three of my carts never made it in from the north road. Goblins, I would bet my beard on it. They will have stashed the goods around their camp in the eastern forest. Bring back what you can carry, five parcels at least.',
  progress: 'The goblins in the eastern forest have my cart goods. Five parcels.',
  done: 'Flour, nails, and my good cheese! You have saved my season. Have a few coins, and a potion on the house.',
  reward: { gold: 60, items: [['potion', 3]] } });
add('watch_report', { title: 'A Word with the Watch', giver: 'watchman', requires: 'goblins', lv: 6, w: 0.6, kind: 'talk', turnin: 'guard_1',
  offer: '"Goblins on the road, raids at night... The gate guards ought to hear it from someone who has actually fought them. Tell Ser Aldric at the north gate what you have seen."',
  progress: 'Ser Aldric stands at the north gate of town.',
  done: '"So the goblins are bolder than we thought. Good report. We will double the watch at night. Here, take this, it is the king\'s coin, not mine."',
  reward: { gold: 40 } });
add('goblin_scout', { title: 'Scouting the Camp', giver: 'elder', requires: 'goblins', lv: 6, w: 1.6, kind: 'kill', target: 'goblin', count: 10,
  offer: 'Before you face Grukk himself, thin out his camp. Ten more goblins. The fewer that stand around him, the better your chances.',
  progress: 'Ten goblins, around the camp in the eastern forest.',
  done: 'The camp is half empty, the woodcutters say. Now you are ready for Grukk.',
  reward: { gold: 70, items: [['potion', 2]] } });

// --- Whisperwood (6-10): Warden Elsa and Odo at Thornwick Lodge
add('wardens_call', { title: "The Warden's Call", giver: 'elder', requires: 'chief', minLv: 5, lv: 6, w: 1.2, kind: 'talk', turnin: 'warden_elsa',
  offer: 'A letter came from Warden Elsa of Whisperwood, south-west of here, across the river at Willow Ford. Wolves and worse, she writes, and not enough hands. You have earned a reputation. Go and help her: take the south road out of town, then west over the ford.',
  progress: 'Warden Elsa keeps Thornwick Lodge in Whisperwood: south gate, then west across Willow Ford.',
  done: 'Maren sent you? Then you are worth ten of my trappers. Welcome to Thornwick. Rest a moment: there is a lot to do.',
  reward: { gold: 30 } });
add('wolf_cull', { title: 'Too Many Wolves', giver: 'warden_elsa', requires: 'wardens_call', lv: 6, w: 2, kind: 'kill', target: 'wolf', count: 10,
  offer: 'The wolf packs have doubled since spring and they have started following travellers. Ten wolves. Start west of the lodge, in the woods.',
  progress: 'Ten grey wolves, in the woods west and north of the lodge.',
  done: 'Quieter already. You fight like someone who grew up with wolves at the door.',
  reward: { gold: 70, items: [['potion', 2]] } });
add('wolf_pelts', { title: 'Pelts for the Winter', giver: 'trapper_odo', requires: 'wardens_call', lv: 6, w: 1.6, kind: 'collect', item: 'wolf_pelt', count: 6,
  offer: 'Winter is coming and the lodge roof leaks like a sieve. Wolf pelts, six of them, and I can make it snug. Elsa will not mind you doing both jobs at once.',
  progress: 'Six wolf pelts. Grey wolves drop them.',
  done: 'Lovely thick ones. The lodge thanks you, and so does my back.',
  reward: { gold: 60, gear: [['armor', 2, 0]] } });
add('lodge_herbs', { title: 'Sunleaf for the Lodge', giver: 'warden_elsa', requires: 'wardens_call', lv: 7, w: 1, kind: 'collect', item: 'sunleaf', count: 4,
  offer: 'Half my trappers are bitten and the other half are scratched. Four sunleaf, and Odo can make a poultice. It grows in the open meadows. You will need a herb pouch; Mira in town sells them.',
  progress: 'Four sunleaf from the open meadows (herb pouch needed).',
  done: 'That will do nicely. Here, take some potions for yourself, you look like you will need them.',
  reward: { items: [['potion', 4]] } });
add('boar_trouble', { title: 'Boar Trouble', giver: 'trapper_odo', requires: 'wolf_pelts', lv: 7, w: 2, kind: 'kill', target: 'boar', count: 8,
  offer: 'Tusked boars have torn up every snare between here and the river. Eight of them. They roam the plains south of the lodge.',
  progress: 'Eight tusked boars, on the plains south of the lodge.',
  done: 'My snares will live another week. Good hunting.',
  reward: { gold: 80 } });
add('boar_tusks', { title: 'Tusks for Trade', giver: 'trapper_odo', requires: 'boar_trouble', lv: 7, w: 1.4, kind: 'collect', item: 'boar_tusk', count: 5,
  offer: 'Boar tusks fetch a good price in town. Five more and I will cut you in.',
  progress: 'Five boar tusks.',
  done: 'You drive a hard bargain for someone who did not even haggle. Your share.',
  reward: { gold: 120 } });
add('bandit_sign', { title: 'Tracks on the Hill', giver: 'warden_elsa', requires: 'wolf_cull', lv: 8, w: 1.3, kind: 'visit', at: 'bandit_hideout',
  offer: 'My trappers have seen campfire smoke on the big hill to the south. Bandits, I think. Go and look, carefully. The way up is on its north side.',
  progress: 'Find the camp on the big hill to the south of the lodge.',
  done: 'Bandits, then. And a lot of them. That explains the missing traps, and the missing trappers.',
  reward: { gold: 50 } });
add('bandit_purge', { title: 'Clearing the Hill', giver: 'warden_elsa', requires: 'bandit_sign', lv: 8, w: 2.2, kind: 'kill', target: 'bandit', count: 10,
  offer: 'They will not leave on their own. Ten bandits. Make them think twice about Whisperwood.',
  progress: 'Ten bandits, on the hill to the south.',
  done: 'They are scattering like crows. But someone is holding them together.',
  reward: { gold: 100, items: [['potion_big', 2]] } });
add('stolen_purses', { title: "The Farmers' Coin", giver: 'trapper_odo', requires: 'bandit_sign', lv: 8, w: 1.6, kind: 'collect', item: 'stolen_coin', count: 6,
  offer: 'Those bandits robbed half the farms around Hollowmere. Get the purses back, six of them, and I will see them home.',
  progress: 'Six stolen coin purses, from the bandits.',
  done: 'Every coin accounted for. Well, nearly every coin. Keep these.',
  reward: { gold: 140 } });
add('bandit_captain', { title: 'Red Vesna', giver: 'warden_elsa', requires: 'bandit_purge', lv: 9, w: 3, kind: 'kill', target: 'bandit_captain', count: 1,
  offer: 'Their captain is called Red Vesna. She fights with two blades and twice the nerve. She holds the top of the hill. End it, and Whisperwood is ours again.',
  progress: 'Red Vesna holds the top of the bandit hill.',
  done: 'Vesna, beaten! The trappers are singing in the lodge. Take this, and the thanks of every warden in the wood.',
  reward: { gold: 220, gear: [['weapon', 3, 1]], title: 'bandit_breaker' } });
add('wardens_letter', { title: 'A Letter for Ridgewatch', giver: 'warden_elsa', requires: 'bandit_captain', minLv: 10, lv: 11, w: 1.2, kind: 'talk', turnin: 'captain_rourke',
  offer: 'Captain Rourke at Ridgewatch Outpost has been asking for help for months. The highlands are north of here, past the old ford road: big cliffs, you cannot miss them. Take him this letter, and yourself.',
  progress: 'Ridgewatch Outpost is at the foot of the western highlands, east of the cliffs.',
  done: 'A letter from Elsa, and a fighter to go with it. That woman never sends me anything I do not need. Welcome to Ridgewatch.',
  reward: { gold: 60, title: 'warden_friend' }, start: [['warden_letter', 1]], take: [['warden_letter', 1]] });

// --- the Westreach Highlands (11-14): Captain Rourke and Scout Tamsin at Ridgewatch
add('dire_wolves', { title: 'The Dire Packs', giver: 'captain_rourke', requires: 'wardens_letter', lv: 11, w: 2, kind: 'kill', target: 'dire_wolf', count: 12,
  offer: 'Dire wolves have made the foothills theirs, north and east of here. They took two of my sentries. Twelve of them, and the road is safe again.',
  progress: 'Twelve dire wolves, in the foothills north and east of Ridgewatch.',
  done: 'The sentries can walk the road again. My thanks.',
  reward: { gold: 120, items: [['potion_big', 2]] } });
add('outpost_ore', { title: 'Iron for the Outpost', giver: 'captain_rourke', requires: 'wardens_letter', lv: 11, w: 1.2, kind: 'collect', item: 'iron_ore', count: 5,
  offer: 'Our smith is out of iron and our gate hinges are not. Five iron ore. There are veins all along the cliffs; you will need a pickaxe.',
  progress: 'Five iron ore, from the veins by the cliffs (pickaxe needed).',
  done: 'Good dark iron. The gate will hold another winter.',
  reward: { gold: 90 } });
add('watchtower', { title: 'The Old Watchtower', giver: 'scout_tamsin', requires: 'wardens_letter', lv: 12, w: 1.3, kind: 'visit', at: 'old_watchtower',
  offer: 'There is an old watchtower on the highland plateau. We lost touch with it in the spring. Climb up there and see what is left. The stair up the cliff is just west of the outpost.',
  progress: 'Climb to the old watchtower on the highland plateau.',
  done: 'Golems. Walking stones, all around it. So that is where they came from.',
  reward: { gold: 70 } });
add('golem_break', { title: 'Walking Stones', giver: 'scout_tamsin', requires: 'watchtower', lv: 12, w: 2.2, kind: 'kill', target: 'golem', count: 10,
  offer: 'The golems wander the plateau and crush anything that moves. Ten of them. Hit the cracks, they say.',
  progress: 'Ten stone golems, up on the plateau.',
  done: 'Ten! I watched from the cliff edge. You hit like a rockslide.',
  reward: { gold: 130 } });
add('golem_cores', { title: 'Hearts of Stone', giver: 'scout_tamsin', requires: 'watchtower', lv: 12, w: 1.6, kind: 'collect', item: 'golem_core', count: 6,
  offer: 'Something powers the golems: a warm stone at their heart. Bring me six cores. Someone made these things, and I want to know who.',
  progress: 'Six golem cores, from stone golems.',
  done: 'These are carved. Someone made them, long ago. And something has woken them up.',
  reward: { gold: 120, gear: [['armor', 3, 1]] } });
add('troll_hunt', { title: 'Trolls on the Heights', giver: 'captain_rourke', requires: 'golem_break', lv: 13, w: 2.4, kind: 'kill', target: 'hill_troll', count: 10,
  offer: 'The trolls on the high plateau are coming down at night now. Ten of them. The stair to the upper heights is on its south side.',
  progress: 'Ten hill trolls on the upper heights (stair on the south side).',
  done: 'You came back! I owe the cook a silver piece. He did not think you would.',
  reward: { gold: 160, items: [['potion_big', 3]] } });
add('troll_tusks', { title: 'Tusks of the Hill Folk', giver: 'scout_tamsin', requires: 'golem_break', lv: 13, w: 1.6, kind: 'collect', item: 'troll_tusk', count: 6,
  offer: 'Troll tusks. Six. Do not ask why. All right: the captain bet me I could not get six. Please.',
  progress: 'Six troll tusks.',
  done: 'Ha! Wait until he sees these. Half the winnings are yours.',
  reward: { gold: 150 } });
add('troll_king', { title: 'Grak the Hill King', giver: 'captain_rourke', requires: 'troll_hunt', lv: 14, w: 3.2, kind: 'kill', target: 'troll_king', count: 1,
  offer: 'Their king, Grak, sits at the very top of the heights on a throne of bones. While he lives, the trolls will keep coming. Bring him down.',
  progress: 'Grak the Hill King waits at the top of the heights.',
  done: 'The Hill King, dead! Ridgewatch will drink to you tonight. Take this, it has been in the outpost armory since my grandfather\'s day.',
  reward: { gold: 300, gear: [['weapon', 4, 1]], title: 'trollslayer' } });
add('ridgewalker', { title: 'A Message to the North', giver: 'captain_rourke', requires: 'troll_king', minLv: 13, lv: 14, w: 1.2, kind: 'talk', turnin: 'hermit_ysolde',
  offer: 'There is a hermit up in Frostridge, north-east, past the goblin forest. Ysolde. She wrote to me of a wyrm waking in the ice. I did not believe her. After the golems, I do. Go to her.',
  progress: 'Ysolde lives below Frostridge, the great ridge in the far north-east.',
  done: 'Rourke sent someone at last. Good. Come in, quick, before the warm gets out.',
  reward: { gold: 80, title: 'ridgewalker' } });

// --- Frostridge (14-17): Ysolde at the Hermitage
add('wraith_cull', { title: 'Cold Lights', giver: 'hermit_ysolde', requires: 'ridgewalker', lv: 15, w: 2.2, kind: 'kill', target: 'frost_wraith', count: 12,
  offer: 'The wraiths drift down off the ridge at dusk and freeze anything warm. Twelve of them, up on the ridge. The path up is south of my door.',
  progress: 'Twelve frost wraiths, up on the ridge.',
  done: 'The nights are quieter. I could hear the wind again last night. I had missed it.',
  reward: { gold: 160 } });
add('wraith_essence', { title: 'Essence of Winter', giver: 'hermit_ysolde', requires: 'ridgewalker', lv: 15, w: 1.6, kind: 'collect', item: 'wraith_essence', count: 6,
  offer: 'The wraiths are made of something. Bring me six jars of it and I will find out what woke them.',
  progress: 'Six wraith essences, from frost wraiths.',
  done: 'It is the wyrm\'s breath. The wraiths are just the wyrm, dreaming. So it is truly waking.',
  reward: { gold: 140, items: [['potion_big', 3]] } });
add('frostcap', { title: 'Something Warm', giver: 'hermit_ysolde', requires: 'ridgewalker', lv: 15, w: 1, kind: 'collect', item: 'frostcap', count: 4,
  offer: 'I am out of frostcap, and frostcap is the only thing that makes my tea worth drinking. Four of them. They grow on the high ground; you will need a herb pouch.',
  progress: 'Four frostcap, from the high ground (herb pouch needed).',
  done: 'Ahh. Now that is tea. Have a cup. And these.',
  reward: { gold: 90 } });
add('ice_golems', { title: 'Ice That Walks', giver: 'hermit_ysolde', requires: 'wraith_cull', lv: 16, w: 2.4, kind: 'kill', target: 'ice_golem', count: 10,
  offer: 'The wyrm\'s cold has made golems of the ice itself. Ten of them. Hit them with fire if you have it.',
  progress: 'Ten ice golems, up on the ridge.',
  done: 'Puddles. You turned them into puddles. Wonderful.',
  reward: { gold: 180 } });
add('frost_crystals', { title: 'Crystals of the Deep Cold', giver: 'hermit_ysolde', requires: 'wraith_cull', lv: 16, w: 1.6, kind: 'collect', item: 'frost_crystal', count: 6,
  offer: 'The ice golems carry crystals at their core. Six of them. With enough, I can make a ward against the wyrm\'s breath.',
  progress: 'Six frost crystals, from ice golems.',
  done: 'There. The ward is woven. It will not stop the wyrm, but it may stop you freezing solid while you fight it.',
  reward: { gold: 150, gear: [['armor', 4, 1]] } });
add('frozen_shrine', { title: 'The Frozen Shrine', giver: 'hermit_ysolde', requires: 'ice_golems', lv: 16, w: 1.3, kind: 'visit', at: 'frozen_shrine',
  offer: 'At the very top of the ridge is a shrine, older than me, older than the wyrm. The wyrm sleeps beside it. Go up and see if it is awake. Quietly.',
  progress: 'Climb to the frozen shrine at the very top of Frostridge.',
  done: 'Awake. Of course it is awake. Well. You knew this was coming.',
  reward: { gold: 90 } });
add('frost_wyrm', { title: 'Hrimfang', giver: 'hermit_ysolde', requires: 'frozen_shrine', lv: 17, w: 3.4, kind: 'kill', target: 'frost_wyrm', count: 1,
  offer: 'Hrimfang. The wyrm of the ridge. If it wakes fully, winter will come to Hollowmere and never leave. Kill it.',
  progress: 'Hrimfang coils beside the frozen shrine at the top of the ridge.',
  done: 'The ridge is thawing! Listen, water running. You killed a dragon. A small one, but a dragon. Take this.',
  reward: { gold: 400, title: 'wyrmbane', dye: 6 } });
add('fen_call', { title: 'Lights in the Fen', giver: 'hermit_ysolde', requires: 'frost_wyrm', minLv: 16, lv: 17, w: 1.2, kind: 'talk', turnin: 'witch_corda',
  offer: 'The wyrm was not the only thing stirring. Down in the Blackmarsh, south-east of Hollowmere, something has been calling the dead. Corda the Witchfinder keeps watch at Fenwatch. She will need you.',
  progress: 'Fenwatch is west of the Blackmarsh bluff, in the far south-east, past the windmill.',
  done: 'Ysolde\'s hero. Good. I have been holding this marsh with two lanterns and a bad temper.',
  reward: { gold: 100 } });

// --- the Blackmarsh (17-20): Corda and Gil at Fenwatch
add('lurker_cull', { title: 'Things in the Water', giver: 'witch_corda', requires: 'fen_call', lv: 18, w: 2.4, kind: 'kill', target: 'bog_lurker', count: 12,
  offer: 'Bog lurkers. All teeth and patience. They wait in the reeds south of here. Twelve of them, and the fen path is safe again.',
  progress: 'Twelve bog lurkers, in the marsh south of Fenwatch.',
  done: 'The path is open. Gil can row again.',
  reward: { gold: 180 } });
add('lurker_hides', { title: 'Boots for the Fen', giver: 'ferryman_gil', requires: 'fen_call', lv: 18, w: 1.6, kind: 'collect', item: 'lurker_hide', count: 6,
  offer: 'Lurker hide makes the only boots that keep the fen out. Six hides and I will have a pair made for every lantern-bearer in Fenwatch.',
  progress: 'Six lurker hides, from bog lurkers.',
  done: 'Dry feet for everyone! You do not know what that means out here.',
  reward: { gold: 160, items: [['potion_big', 3]] } });
add('nightbloom', { title: 'Moonlit Petals', giver: 'witch_corda', requires: 'fen_call', lv: 18, w: 1, kind: 'collect', item: 'nightbloom', count: 3,
  offer: 'Nightbloom keeps the dead at a distance. Three blooms, picked under the moon. You will need a herb pouch and some patience.',
  progress: 'Three nightbloom, picked at night (herb pouch needed).',
  done: 'Good. I will hang them on every door in Fenwatch.',
  reward: { gold: 110 } });
add('drowned_lockets', { title: 'What the Fen Took', giver: 'ferryman_gil', requires: 'lurker_hides', lv: 18, w: 1.8, kind: 'collect', item: 'drowned_locket', count: 6,
  offer: 'Every family in Fenwatch lost someone to the water. The lurkers swallow whatever they catch, lockets and all. Six lockets, and six families get something back.',
  progress: 'Six drowned lockets, from bog lurkers.',
  done: 'This one is my sister\'s. Thank you. I will see the rest get home.',
  reward: { gold: 170 } });
add('cultists', { title: 'The Mire Cult', giver: 'witch_corda', requires: 'lurker_cull', lv: 19, w: 2.4, kind: 'kill', target: 'cultist', count: 12,
  offer: 'The ones calling the dead are people. A cult, up on the bluff. Twelve of them, and the calling gets weaker. The way up is on the bluff\'s west side.',
  progress: 'Twelve mire cultists, on the bluff (west side stair).',
  done: 'The calling is quieter. But it has not stopped. Something else is singing.',
  reward: { gold: 200, items: [['potion_big', 3]] } });
add('cult_sigils', { title: 'Sigils of the Mire', giver: 'ferryman_gil', requires: 'lurker_cull', lv: 19, w: 1.6, kind: 'collect', item: 'cult_sigil', count: 8,
  offer: 'Every cultist carries a sigil. Bring me eight and Corda can burn them. Burn enough, and their mistress will have to come out.',
  progress: 'Eight cult sigils, from mire cultists.',
  done: 'They burn green. Nasty. Corda says that means it is working.',
  reward: { gold: 180 } });
add('cult_orders', { title: 'Orders from Below', giver: 'witch_corda', requires: 'cultists', lv: 19, w: 1.8, kind: 'collect', item: 'cult_orders', count: 5,
  offer: 'The cultists carry written orders. Bring me five and I will learn who is giving them, and where they gather.',
  progress: 'Five cult orders, from mire cultists on the bluff.',
  done: '"Mother wakes at the altar." So. It is her. It was always going to be her.',
  reward: { gold: 190, items: [['potion_big', 2]] } });
add('sunken_altar', { title: 'The Sunken Altar', giver: 'witch_corda', requires: 'cultists', lv: 19, w: 1.3, kind: 'visit', at: 'sunken_altar',
  offer: 'The singing comes from an altar on top of the bluff, half sunk in the bog. Go and look. Take a lantern.',
  progress: 'Find the sunken altar on top of the bluff.',
  done: 'Old Mother Mire. I hoped she was a story. She is the one calling them all.',
  reward: { gold: 120 } });
add('mire_hag', { title: 'Old Mother Mire', giver: 'witch_corda', requires: 'sunken_altar', lv: 19, w: 3.6, kind: 'kill', target: 'mire_hag', count: 1,
  offer: 'She has lived in that bog for three hundred years, they say, and every year she gets hungrier. End her. Hollowmere will never know how close it came.',
  progress: 'Old Mother Mire waits at the sunken altar on top of the bluff.',
  done: 'The marsh is silent. Truly silent. Go home, hero. Go home and be proud.',
  reward: { gold: 600, title: 'hagbane', dye: 3 } });

// --- bounties: repeatable hunts at every camp (and the town notice board's goblins)
const BOUNTIES = [
  ['bounty_goblins', 'elder', 'goblin_scout', 'goblin', 4, 'Goblins on the eastern road again. The town pays a bounty for every dozen.'],
  ['bounty_wolves', 'warden_elsa', 'wolf_cull', 'wolf', 7, 'The packs keep coming back. Thornwick pays for every fifteen wolves.'],
  ['bounty_bandits', 'trapper_odo', 'bandit_purge', 'bandit', 9, 'Bandits regroup faster than we can count. Fifteen more and the bounty is yours.'],
  ['bounty_golems', 'scout_tamsin', 'golem_break', 'golem', 13, 'The plateau keeps making golems. Ridgewatch pays for every fifteen we break.'],
  ['bounty_trolls', 'captain_rourke', 'troll_hunt', 'hill_troll', 14, 'The trolls keep coming down. The bounty stands: fifteen more.'],
  ['bounty_wraiths', 'hermit_ysolde', 'wraith_cull', 'frost_wraith', 16, 'The wyrm keeps dreaming them up. Fifteen more wraiths, if you would.'],
  ['bounty_lurkers', 'ferryman_gil', 'lurker_cull', 'bog_lurker', 18, 'The fen breeds lurkers like flies. Fenwatch pays for every fifteen.'],
  ['bounty_cultists', 'witch_corda', 'cultists', 'cultist', 19, 'More robes in the fog every night. Fifteen more cultists.'],
];
export const BOUNTY_KILLS = 15;
for (const [id, giver, req, target, lv, text] of BOUNTIES) add(id, { title: `Bounty: ${target === 'hill_troll' ? 'Trolls' : target === 'bog_lurker' ? 'Lurkers' : target === 'frost_wraith' ? 'Wraiths' : target[0].toUpperCase() + target.slice(1) + 's'}`, giver, requires: req, repeat: true, lv, w: 0,
  kind: 'kill', target, count: target === 'goblin' ? 12 : BOUNTY_KILLS, offer: text + ' (A bounty: you can take it again every time you finish it.)',
  progress: 'Hunt them down and come back for your bounty.', done: 'Bounty paid. Come back any time.', reward: { gold: lv * 6, items: [['potion', 2]] } });

// --- the milestones: a trial from your class trainer at level 10 and at level 20
const TRIALS = {
  warrior: { trainer: 'trainer_warrior', name: 'Steel', t10: 'Show me the edge you have earned', t20: 'The last lesson' },
  ranger:  { trainer: 'trainer_ranger', name: 'the Wild', t10: 'The hunter\'s trial', t20: 'The last hunt' },
  mage:    { trainer: 'trainer_mage', name: 'the Arcane', t10: 'A test of will', t20: 'The final arcanum' },
};
for (const [cls, T] of Object.entries(TRIALS)) {
  add(`trial10_${cls}`, { title: `Trial of ${T.name}`, giver: T.trainer, requires: null, cls, minLv: 10, lv: 10, w: 2.2, kind: 'kill', target: 'bandit_captain', count: 1, milestone: 10,
    offer: `Ten. You have reached ten. Most never do. ${T.t10}: Red Vesna, the bandit captain of Whisperwood, has beaten every sell-sword sent after her. Beat her, and I will teach you what I teach only the best, and dress you like one.`,
    progress: 'Defeat Red Vesna on the bandit hill in Whisperwood (south-west, over Willow Ford).',
    done: 'Vesna is beaten, and you are still standing. Kneel. ...Good. Rise, Veteran of Hollowmere. Here is your armour, a new skill, and a horse from the Ridgewatch stables. Press K to learn the skill, and use the reins to ride. And one more thing: you are ready to choose your path. Hear me out when you are.',
    reward: { gold: 250, items: [[`armor_${cls[0]}5`, 1], ['mount_horse', 1]], title: 'veteran', skill: 10 } });
  add(`trial20_${cls}`, { title: `The Last Trial of ${T.name}`, giver: T.trainer, requires: `trial10_${cls}`, cls, minLv: 20, lv: 20, w: 2.5, kind: 'kill', target: 'mire_hag', count: 1, milestone: 20,
    offer: `Twenty. There is nothing left I can teach you with words. ${T.t20}: Old Mother Mire, in the heart of the Blackmarsh. Face her one more time, alone, and come back to me a champion.`,
    progress: 'Defeat Old Mother Mire at the sunken altar in the Blackmarsh.',
    done: 'Then it is done. Hollowmere has a champion, and I have a student who has surpassed me. Take the finest armour in the kingdom, and the last secret I know.',
    reward: { gold: 600, items: [[`armor_${cls[0]}6`, 1]], title: 'champion', skill: 20 } });
}

// what quest items the monsters carry (only while you are on the quest): [item, chance, quest]
export const QUEST_DROPS_NEW = {
  goblin: [['cart_goods', 0.45, 'cart_goods']],
  wolf: [['wolf_pelt', 0.5, 'wolf_pelts']], boar: [['boar_tusk', 0.5, 'boar_tusks']], bandit: [['stolen_coin', 0.45, 'stolen_purses']],
  golem: [['golem_core', 0.45, 'golem_cores']], hill_troll: [['troll_tusk', 0.45, 'troll_tusks']],
  frost_wraith: [['wraith_essence', 0.45, 'wraith_essence']], ice_golem: [['frost_crystal', 0.45, 'frost_crystals']],
  bog_lurker: [['lurker_hide', 0.45, 'lurker_hides'], ['drowned_locket', 0.4, 'drowned_lockets']], cultist: [['cult_sigil', 0.45, 'cult_sigils'], ['cult_orders', 0.35, 'cult_orders']],
};
export const QUEST_ORDER_NEW = Object.keys(Q);
export const QUESTS_NEW = Q;

// Spread each level's quest experience over its quests by weight. (Trials share with their level.)
export function paceQuests(QUESTS) {
  const byLv = {};
  for (const [id, q] of Object.entries(QUESTS)) {
    const P = START_PACING[id]; if (P) Object.assign(q, P);
    if (!q.lv || q.repeat) continue;
    // class trials: only one of the three counts toward a player's level
    const w = q.cls ? q.w / 3 : q.w;
    byLv[q.lv] = (byLv[q.lv] || 0) + w;
  }
  for (const q of Object.values(QUESTS)) {
    if (!q.lv) continue;
    // bounties: about as much again as the monsters themselves were worth
    if (q.repeat) { q.reward = { ...q.reward, xp: Math.round(q.count * (QUEST_MOBS[q.target]?.xp || 32) * 0.8 / 5) * 5 }; continue; }
    const share = (q.lv >= 17 ? 0.72 : QUEST_SHARE) * xpCurve(q.lv) * q.w / byLv[q.lv];
    q.reward = { ...q.reward, xp: Math.round(share / 5) * 5 };
    if (q.reward.gold) q.reward.gold = Math.round(q.reward.gold * (1 + q.lv / 12));
  }
}
