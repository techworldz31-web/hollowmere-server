import { FARM_ITEMS, FARM_MEALS, MILL_RECIPES } from './farming.js';
import { CRAFT_TRADES, CRAFT_ORDER } from './crafting.js';
// Trades: fishing, cooking, herbalism, mining, woodcutting, foraging and farming. Pure data, shared by the
// server (authoritative) and the client (panels, tooltips). content.js merges the items
// in here into ITEMS and the recipes into RECIPES.

export const TRADES = {
  fishing:     { name: 'Fishing', icon: 'icon_fishing_rod', verb: 'fish' },
  cooking:     { name: 'Cooking', icon: 'icon_grilled_perch', verb: 'cook' },
  herbalism:   { name: 'Herbalism', icon: 'icon_sunleaf', verb: 'pick herbs' },
  mining:      { name: 'Mining', icon: 'icon_copper_ore', verb: 'mine' },
  woodcutting: { name: 'Woodcutting', icon: 'icon_oak_log', verb: 'chop wood' },
  foraging:    { name: 'Foraging', icon: 'icon_seed_carrot', verb: 'forage' },
  farming:     { name: 'Farming', icon: 'icon_wheat', verb: 'farm' },
};
Object.assign(TRADES, CRAFT_TRADES);
export const TRADE_ORDER = ['fishing', 'cooking', 'herbalism', 'mining', 'woodcutting', 'foraging', 'farming', ...CRAFT_ORDER];
export const TRADE_MAX = 25;

// xp to go from level lv to lv + 1
export const tradeStep = (lv) => Math.round(30 * Math.pow(lv, 1.45));
// total xp -> { lv, into, need } (need = xp for the next level, 0 at the cap)
export function tradeLevel(xp = 0) {
  let lv = 1, left = xp;
  while (lv < TRADE_MAX && left >= tradeStep(lv)) { left -= tradeStep(lv); lv++; }
  return { lv, into: lv < TRADE_MAX ? left : 0, need: lv < TRADE_MAX ? tradeStep(lv) : 0 };
}

// ---- Fish -------------------------------------------------------------------------
// where: lake / river / any; only: 'night' | 'day'; night/rain/storm: bite weight multipliers;
// w: weight range (kg); wt: how common. Rare ones are doubled by glow bait.
export const FISH = {
  perch:       { name: 'Perch', lv: 1, where: 'any', w: [0.15, 1.1], xp: 10, price: 4, wt: 40 },
  bream:       { name: 'Lake Bream', lv: 3, where: 'lake', w: [0.4, 2.6], xp: 14, price: 6, wt: 30 },
  trout:       { name: 'Brown Trout', lv: 5, where: 'river', w: [0.3, 2.2], xp: 18, price: 8, wt: 32 },
  carp:        { name: 'Carp', lv: 8, where: 'lake', w: [1, 9], xp: 24, price: 10, wt: 24 },
  eel:         { name: 'River Eel', lv: 10, where: 'river', night: 1.8, w: [0.3, 2.4], xp: 28, price: 12, wt: 18 },
  pike:        { name: 'Pike', lv: 12, where: 'lake', w: [1.5, 11], xp: 32, price: 15, wt: 16 },
  moonfish:    { name: 'Moonfish', lv: 14, where: 'lake', only: 'night', w: [0.3, 1.5], xp: 45, price: 30, wt: 9 },
  salmon:      { name: 'Silver Salmon', lv: 15, where: 'river', rain: 2.2, w: [2, 9], xp: 38, price: 20, wt: 14 },
  catfish:     { name: 'Whiskered Catfish', lv: 18, where: 'lake', night: 1.6, rain: 1.6, w: [3, 22], xp: 48, price: 26, wt: 10 },
  ember_trout: { name: 'Ember Trout', lv: 20, where: 'river', only: 'day', w: [0.8, 3.5], xp: 60, price: 45, wt: 4, rare: true },
  golden_carp: { name: 'Golden Carp', lv: 22, where: 'lake', w: [2, 8], xp: 90, price: 120, wt: 1.6, rare: true },
  lake_horror: { name: 'The Thing in the Lake', lv: 25, where: 'lake', night: 2, storm: 3, w: [40, 95], xp: 400, price: 500, wt: 0.3, rare: true, legend: true },
};
export const FISH_ORDER = Object.keys(FISH);
// what turns up instead of a fish now and then
export const JUNK = { old_boot: 3 };
// where to look for each fish (shown in the log until you have caught one)
export const FISH_HINTS = {
  perch: 'Anywhere there is water.', bream: 'The lake, any time.', trout: 'The river.', carp: 'The lake. Patience.',
  eel: 'The river, best after dark.', pike: 'The lake.', moonfish: 'The lake, only at night.', salmon: 'The river, best in the rain.',
  catfish: 'The lake on wet nights.', ember_trout: 'The river, only by day. Rare.', golden_carp: 'The lake. Very rare.',
  lake_horror: 'Old Tobin swears it lives in the lake. Night and storms, they say.',
};

// ---- Gathering spots --------------------------------------------------------------------
// pulls: how many items a spot gives before it needs to grow back (respawn, seconds)
export const NODES = {
  sunleaf:    { name: 'Sunleaf', trade: 'herbalism', lv: 1, item: 'sunleaf', pulls: [1, 2], xp: 10, respawn: [70, 130], tool: 'herb_pouch' },
  mint:       { name: 'Wild Mint', trade: 'herbalism', lv: 4, item: 'mint', pulls: [1, 2], xp: 14, respawn: [70, 130], tool: 'herb_pouch' },
  bloodmoss:  { name: 'Bloodmoss', trade: 'herbalism', lv: 8, item: 'bloodmoss', pulls: [1, 2], xp: 20, respawn: [90, 150], tool: 'herb_pouch' },
  frostcap:   { name: 'Frostcap', trade: 'herbalism', lv: 13, item: 'frostcap', pulls: [1, 2], xp: 28, respawn: [100, 170], tool: 'herb_pouch' },
  nightbloom: { name: 'Nightbloom', trade: 'herbalism', lv: 17, item: 'nightbloom', pulls: [1, 1], xp: 40, respawn: [110, 180], tool: 'herb_pouch', night: true },
  copper:     { name: 'Copper Vein', trade: 'mining', lv: 1, item: 'copper_ore', pulls: [2, 4], xp: 12, respawn: [90, 150], tool: 'pickaxe', solid: true },
  iron:       { name: 'Iron Vein', trade: 'mining', lv: 8, item: 'iron_ore', pulls: [2, 4], xp: 22, respawn: [110, 170], tool: 'pickaxe', solid: true },
  silver:     { name: 'Silver Vein', trade: 'mining', lv: 16, item: 'silver_ore', pulls: [2, 3], xp: 38, respawn: [140, 200], tool: 'pickaxe', solid: true },
  oak_tree:   { name: 'Young Oak', trade: 'woodcutting', lv: 1, item: 'oak_log', pulls: [2, 4], xp: 12, respawn: [100, 160], tool: 'hatchet', solid: true },
  pine_tree:  { name: 'Tall Pine', trade: 'woodcutting', lv: 7, item: 'pine_log', pulls: [2, 4], xp: 20, respawn: [110, 170], tool: 'hatchet', solid: true },
  elder_tree: { name: 'Elder Ash', trade: 'woodcutting', lv: 15, item: 'elder_log', pulls: [2, 3], xp: 36, respawn: [140, 200], tool: 'hatchet', solid: true },
};
export const GATHER_ANIM = { herbalism: 'gather', mining: 'mine', woodcutting: 'chop' };

// ---- Items ----------------------------------------------------------------------------
const ic = (id) => 'icon_' + id;
export const TRADE_ITEMS = {
  // tools: kept in your pack
  fishing_rod: { name: 'Fishing Rod', type: 'tool', rod: 1, stack: 1, price: 30, desc: 'Click the water to cast. Click again when a fish bites.' },
  fine_rod:    { name: 'Elderwood Rod', type: 'tool', rod: 2, stack: 1, price: 220, desc: 'Silver-ringed and springy. Fish bite sooner, rare fish more often.' },
  pickaxe:     { name: 'Pickaxe', type: 'tool', stack: 1, price: 25, desc: 'For ore veins in the hills and cliffs.' },
  hatchet:     { name: 'Hatchet', type: 'tool', stack: 1, price: 25, desc: 'For the marked trees in the forest.' },
  herb_pouch:  { name: 'Herb Pouch', type: 'tool', stack: 1, price: 15, desc: 'A pouch and a little knife for picking herbs.' },
  // bait: one used per cast, the best you carry first
  worms:       { name: 'Worms', type: 'bait', bait: 1, stack: 50, price: 1, desc: 'Fish bite a little sooner.' },
  glow_bait:   { name: 'Glow Bait', type: 'bait', bait: 2, stack: 50, price: 12, desc: 'Faintly luminous. Fish bite sooner, and rare fish come twice as often.' },
  // gathered
  sunleaf:     { name: 'Sunleaf', type: 'material', stack: 50, price: 3, desc: 'A bright meadow herb. Mira brews it into potions; cooks like it with fish.' },
  mint:        { name: 'Wild Mint', type: 'material', stack: 50, price: 4, desc: 'Grows by the water. Cool and sharp.' },
  bloodmoss:   { name: 'Bloodmoss', type: 'material', stack: 50, price: 7, desc: 'Red moss from the deep forest. Strengthening.' },
  frostcap:    { name: 'Frostcap', type: 'material', stack: 50, price: 10, desc: 'A pale mushroom from the high ground. Cold as stone.' },
  nightbloom:  { name: 'Nightbloom', type: 'material', stack: 50, price: 16, desc: 'Only opens under the moon. Glows a little.' },
  copper_ore:  { name: 'Copper Ore', type: 'material', stack: 50, price: 4, desc: 'Hilda can work this into tier 2 gear.' },
  iron_ore:    { name: 'Iron Ore', type: 'material', stack: 50, price: 8, desc: 'Hilda needs it for tier 3 gear.' },
  silver_ore:  { name: 'Silver Ore', type: 'material', stack: 50, price: 16, desc: 'Bright and soft. For the best of Hilda\'s work.' },
  rough_gem:   { name: 'Rough Gem', type: 'material', stack: 50, price: 60, desc: 'Found in a vein now and then. Worth a good bit to a trader.' },
  oak_log:     { name: 'Oak Log', type: 'material', stack: 50, price: 3, desc: 'Good straight oak.' },
  pine_log:    { name: 'Pine Log', type: 'material', stack: 50, price: 6, desc: 'Light, resinous pine.' },
  elder_log:   { name: 'Elderwood Log', type: 'material', stack: 50, price: 14, desc: 'Pale wood that hums when you tap it.' },
  // farm food
  egg:         { name: 'Egg', type: 'food', stack: 50, price: 2, desc: 'Fresh from the hens.' },
  apple:       { name: 'Apple', type: 'food', stack: 50, price: 2, desc: 'Crisp and a little sour.' },
  flour:       { name: 'Flour', type: 'food', stack: 50, price: 3, desc: 'Ground at the windmill.' },
  butter:      { name: 'Butter', type: 'food', stack: 50, price: 4, desc: 'From the farm. Salted.' },
  pumpkin:     { name: 'Pumpkin', type: 'food', stack: 20, price: 6, desc: 'Harvest-time only.' },
  spice:       { name: 'Eastern Spice', type: 'food', stack: 50, price: 9, desc: 'Sold by travelling traders on market days.' },
  // junk
  old_boot:    { name: 'Old Boot', type: 'junk', stack: 10, price: 1, desc: 'Someone lost it. Someone was right to.' },
  burnt_food:  { name: 'Something Burnt', type: 'junk', stack: 20, price: 1, desc: 'It was going to be dinner.' },
  // festival
  candied_apple: { name: 'Candied Apple', type: 'consumable', heal: 35, stack: 20, price: 5, desc: 'A festival treat. Restores 35 health.' },
  recipe_harvest_pie: { name: 'Recipe: Harvest Pie', type: 'recipe', recipe: 'harvest_pie', stack: 1, price: 60, desc: 'Click to learn how to bake Harvest Pie.' },
};
for (const [id, f] of Object.entries(FISH)) {
  TRADE_ITEMS[id] = { name: f.name, type: 'fish', stack: f.legend ? 1 : 20, price: f.price, desc: f.legend ? 'Nobody will believe you. Good thing you brought it.' : 'Cook it at a fire, or sell it.' };
}

// ---- Meals (cooked at the inn hearth or a camp fire) ------------------------------------
// buff: regen (health per second), atk / def / spd / xp (fractions); dur in seconds
export const MEALS = {
  grilled_perch:  { name: 'Grilled Perch', lv: 1, mats: { perch: 1 }, buff: { regen: 2 }, dur: 300 },
  fried_eggs:     { name: 'Fried Eggs', lv: 2, mats: { egg: 2, butter: 1 }, buff: { def: 0.08 }, dur: 300 },
  baked_bream:    { name: 'Herb-Baked Bream', lv: 4, mats: { bream: 1, sunleaf: 1 }, buff: { regen: 3, def: 0.05 }, dur: 300 },
  minted_trout:   { name: 'Minted Trout', lv: 6, mats: { trout: 1, mint: 1 }, buff: { spd: 0.08, regen: 2 }, dur: 300 },
  apple_pie:      { name: 'Apple Pie', lv: 8, mats: { apple: 2, flour: 1, egg: 1 }, buff: { xp: 0.1 }, dur: 360 },
  carp_stew:      { name: 'Carp Stew', lv: 10, mats: { carp: 1, mint: 1, sunleaf: 1 }, buff: { def: 0.12, regen: 2 }, dur: 300 },
  eel_pie:        { name: 'Eel Pie', lv: 12, mats: { eel: 1, flour: 1, egg: 1 }, buff: { atk: 0.1 }, dur: 300 },
  pike_roast:     { name: 'Pike Roast', lv: 14, mats: { pike: 1, bloodmoss: 1, butter: 1 }, buff: { atk: 0.12, def: 0.06 }, dur: 300 },
  salmon_supper:  { name: 'Salmon Supper', lv: 16, mats: { salmon: 1, frostcap: 1, butter: 1 }, buff: { regen: 5, spd: 0.08 }, dur: 300 },
  moon_soup:      { name: 'Moonfish Soup', lv: 18, mats: { moonfish: 1, nightbloom: 1 }, buff: { xp: 0.2, regen: 3 }, dur: 360 },
  catfish_gumbo:  { name: 'Catfish Gumbo', lv: 20, mats: { catfish: 1, spice: 1, mint: 1 }, buff: { atk: 0.15, regen: 3 }, dur: 300 },
  ember_skewers:  { name: 'Ember Skewers', lv: 21, mats: { ember_trout: 1, spice: 1 }, buff: { atk: 0.18, spd: 0.06 }, dur: 300 },
  golden_feast:   { name: 'Golden Feast', lv: 23, mats: { golden_carp: 1, apple: 1, flour: 1, spice: 1 }, buff: { atk: 0.15, def: 0.15, regen: 5, xp: 0.15 }, dur: 600 },
  harvest_pie:    { name: 'Harvest Pie', lv: 5, mats: { pumpkin: 1, flour: 1, egg: 1, apple: 1 }, buff: { xp: 0.25, spd: 0.1 }, dur: 600, learned: true },
  ...FARM_MEALS,
};
// Mira's elixirs
export const ELIXIRS = {
  elixir_might: { name: 'Elixir of Might', mats: { bloodmoss: 3 }, gold: 15, buff: { atk: 0.15 }, dur: 180 },
  elixir_swift: { name: 'Elixir of Swiftness', mats: { mint: 3, sunleaf: 1 }, gold: 15, buff: { spd: 0.15 }, dur: 180 },
  elixir_stone: { name: 'Stoneskin Elixir', mats: { frostcap: 2, sunleaf: 1 }, gold: 20, buff: { def: 0.2 }, dur: 180 },
  elixir_night: { name: 'Elixir of Nightsight', mats: { nightbloom: 2, mint: 1 }, gold: 20, buff: { night: 1, regen: 1 }, dur: 360 },
};
const buffText = (b) => [b.atk && `+${Math.round(b.atk * 100)}% attack`, b.def && `+${Math.round(b.def * 100)}% defense`, b.spd && `+${Math.round(b.spd * 100)}% speed`,
  b.regen && `+${b.regen} health a second`, b.xp && `+${Math.round(b.xp * 100)}% experience`, b.night && 'see in the dark'].filter(Boolean).join(', ');
export function buffDesc(b, dur) { return `${buffText(b)} for ${dur >= 60 ? Math.round(dur / 60) + ' min' : dur + 's'}.`; }
for (const [id, m] of Object.entries(MEALS)) TRADE_ITEMS[id] = { name: m.name, type: 'meal', stack: 10, price: 6 + m.lv * 2, buff: m.buff, dur: m.dur, desc: 'Eat for ' + buffDesc(m.buff, m.dur) };
for (const [id, m] of Object.entries(ELIXIRS)) TRADE_ITEMS[id] = { name: m.name, type: 'elixir', stack: 10, price: 30, buff: m.buff, dur: m.dur, desc: 'Drink for ' + buffDesc(m.buff, m.dur) };
for (const [id, it] of Object.entries(FARM_ITEMS)) if (!TRADE_ITEMS[id]) TRADE_ITEMS[id] = it;
TRADE_ITEMS.pumpkin.desc = 'Grows in the fields at Hollowmere Farms (Farming 13); the harvest stall sells them too.';
TRADE_ITEMS.flour.desc = 'Ground at the windmill from wheat, or bought from Oswin.';
for (const [id, it] of Object.entries(TRADE_ITEMS)) it.icon = ic(id);

// ---- Recipes ------------------------------------------------------------------------------
// at: forge (Hilda), brew (Mira), cook (a fire). Gear recipes are filled in per class in content.js.
export const TRADE_RECIPES = {
  pickaxe:    { out: 'pickaxe', mats: {}, gold: 25, at: 'forge' },
  hatchet:    { out: 'hatchet', mats: {}, gold: 25, at: 'forge' },
  fine_rod:   { out: 'fine_rod', mats: { elder_log: 2, silver_ore: 1 }, gold: 60, at: 'forge' },
  brew_potion:     { out: 'potion', qty: 2, mats: { sunleaf: 2 }, gold: 0, at: 'brew' },
  brew_potion_big: { out: 'potion_big', mats: { sunleaf: 2, bloodmoss: 1 }, gold: 10, at: 'brew' },
};
for (const [id, m] of Object.entries(ELIXIRS)) TRADE_RECIPES['brew_' + id] = { out: id, mats: m.mats, gold: m.gold, at: 'brew' };
Object.assign(TRADE_RECIPES, MILL_RECIPES);
for (const [id, m] of Object.entries(MEALS)) TRADE_RECIPES['cook_' + id] = { out: id, mats: m.mats, gold: 0, at: 'cook', lv: m.lv, learned: m.learned };
