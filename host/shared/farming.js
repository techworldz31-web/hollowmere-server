// Farming, after Ashen Empires: forage wild flower patches for seeds, dig a hole in the
// town fields with a shovel, plant a seed, wait while it grows (no tending), then harvest
// it, with a scythe for the grain crops. Every step can fail, less often as you level.
// Fertilizer (bone meal from the mill) at planting time means a bigger harvest and a
// better chance of a prize crop. Pure data, shared by the server and the client.

// grow: minutes from planting to ripe. yield: [min, max] crops. scythe: grain, cut with
// a scythe (and gives seeds back). prize: rare crop instead of a normal one.
export const CROPS = {
  wheat:     { name: 'Wheat', lv: 1, grow: 10, yield: [3, 5], xp: 10, scythe: true, item: 'wheat', price: 2 },
  carrot:    { name: 'Carrots', lv: 1, grow: 12, yield: [2, 4], xp: 11, item: 'carrot', price: 3 },
  potato:    { name: 'Potatoes', lv: 3, grow: 14, yield: [2, 4], xp: 13, item: 'potato', price: 3 },
  cabbage:   { name: 'Cabbage', lv: 5, grow: 16, yield: [1, 2], xp: 16, item: 'cabbage', price: 6 },
  tomato:    { name: 'Tomatoes', lv: 7, grow: 18, yield: [2, 4], xp: 19, item: 'tomato', price: 5, prize: 'prize_tomato' },
  barley:    { name: 'Barley', lv: 9, grow: 20, yield: [3, 5], xp: 22, scythe: true, item: 'barley', price: 4 },
  cotton:    { name: 'Cotton', lv: 11, grow: 24, yield: [2, 4], xp: 26, item: 'cotton', price: 8 },
  pumpkin:   { name: 'Pumpkins', lv: 13, grow: 28, yield: [1, 2], xp: 32, item: 'pumpkin', price: 6, prize: 'giant_pumpkin' },
  sunflower: { name: 'Sunflowers', lv: 15, grow: 32, yield: [1, 3], xp: 38, item: 'sunflower', price: 12 },
  rose:      { name: 'Roses', lv: 18, grow: 38, yield: [1, 3], xp: 46, item: 'rose', price: 18, prize: ['white_rose', 'black_rose'] },
};
export const CROP_ORDER = Object.keys(CROPS);
export const CROP_STAGES = ['hole', 'seeded', 'sprout', 'young', 'grown', 'ripe'];   // 'withered' too
export const FARM = {
  maxPlots: 12,              // holes and crops one farmer may have at once
  holeKeep: 5 * 60,          // an unplanted hole fills in after this many seconds
  ripeKeep: 40 * 60,         // a ripe crop nobody picks withers after this
  witherKeep: 10 * 60,       // and the withered stalks rot away after this
  forageRespawn: [90, 180],  // seconds before a foraged patch has seeds again
};

// what foraging a wild flower patch can turn up: [seed, weight, foraging level]
export const FORAGE = [
  ['seed_wheat', 30, 1], ['seed_carrot', 26, 1], ['seed_potato', 20, 3], ['seed_cabbage', 14, 5], ['seed_tomato', 12, 7],
  ['seed_barley', 10, 9], ['seed_cotton', 8, 11], ['seed_pumpkin', 6, 13], ['seed_sunflower', 4, 15], ['seed_rose', 2, 18],
];
// map decorations you can forage (outside town)
export const FORAGE_KINDS = new Set(['flowers', 'fern', 'tuft']);

const ic = (id) => 'icon_' + id;
export const FARM_ITEMS = {
  shovel:         { name: 'Shovel', type: 'tool', stack: 1, price: 20, desc: 'Click a patch of tilled earth in the fields at Hollowmere Farms (out past the inn) to dig a hole.' },
  scythe:         { name: 'Scythe', type: 'tool', stack: 1, price: 40, desc: 'Grain (wheat, barley) has to be cut with a scythe. You get seeds back too.' },
  foraging_stick: { name: 'Foraging Stick', type: 'tool', stack: 1, price: 15, desc: 'Click wild flowers, ferns and tufts out in the country to search them for seeds.' },
  bone_meal:      { name: 'Bone Meal', type: 'fertilizer', stack: 50, price: 8, desc: 'Click it while standing by a crop you have just planted: a bigger harvest and a better chance of a prize crop.' },
  // the prize crops
  prize_tomato:   { name: 'Prize Tomato', type: 'material', stack: 20, price: 90, desc: 'Fat, red and flawless. The traders pay well for these.' },
  giant_pumpkin:  { name: 'Giant Pumpkin', type: 'material', stack: 5, price: 160, desc: 'You can barely lift it. Worth a small fortune.' },
  white_rose:     { name: 'White Rose', type: 'material', stack: 20, price: 140, desc: 'Rare and perfect. Sells for a great deal.' },
  black_rose:     { name: 'Black Rose', type: 'material', stack: 20, price: 260, desc: 'Velvet-black. Almost nobody has seen one.' },
  // harvested crops (pumpkin already exists)
  wheat:          { name: 'Wheat', type: 'material', stack: 50, price: 2, desc: 'Grind it into flour at the windmill.' },
  carrot:         { name: 'Carrot', type: 'food', stack: 50, price: 3, desc: 'Good in a stew.' },
  potato:         { name: 'Potato', type: 'food', stack: 50, price: 3, desc: 'Bake it, stew it.' },
  cabbage:        { name: 'Cabbage', type: 'food', stack: 30, price: 6, desc: 'A big green head of cabbage.' },
  tomato:         { name: 'Tomato', type: 'food', stack: 50, price: 5, desc: 'Ripe and sweet.' },
  barley:         { name: 'Barley', type: 'material', stack: 50, price: 4, desc: 'The miller turns it into malt; Bess brews with it.' },
  cotton:         { name: 'Cotton', type: 'material', stack: 50, price: 8, desc: 'Soft bolls of cotton. The traders buy it.' },
  sunflower:      { name: 'Sunflower', type: 'material', stack: 30, price: 12, desc: 'A great golden head of seeds.' },
  rose:           { name: 'Rose', type: 'material', stack: 30, price: 18, desc: 'A red rose. Give it to someone. Or sell it.' },
  sunflower_seeds:{ name: 'Roasted Seeds', type: 'consumable', heal: 25, stack: 50, price: 4, desc: 'A handful of roasted sunflower seeds. Restores 25 health.' },
  malt:           { name: 'Malt', type: 'material', stack: 50, price: 7, desc: 'Sprouted, dried barley. Bess buys it for her ale.' },
};
for (const [k, C] of Object.entries(CROPS)) {
  FARM_ITEMS['seed_' + k] = { name: `${C.name} Seeds`, type: 'seed', crop: k, stack: 50, price: Math.max(2, Math.round(C.price * 0.8 + C.lv * 0.6)),
    desc: `Plant in a hole you have dug in the fields at Hollowmere Farms (out past the inn). Farming level ${C.lv}. Ripe in about ${C.grow} minutes.` };
}
for (const [id, it] of Object.entries(FARM_ITEMS)) it.icon = ic(id);

// new meals (cooked at a fire) and the mill
export const FARM_MEALS = {
  baked_potato: { name: 'Baked Potato', lv: 2, mats: { potato: 1, butter: 1 }, buff: { regen: 3 }, dur: 300 },
  fresh_bread:  { name: 'Fresh Bread', lv: 3, mats: { flour: 2, egg: 1 }, buff: { def: 0.08, regen: 1 }, dur: 360 },
  veg_stew:     { name: 'Hearty Vegetable Stew', lv: 7, mats: { carrot: 1, potato: 1, cabbage: 1 }, buff: { def: 0.1, regen: 3 }, dur: 420 },
  tomato_soup:  { name: 'Tomato Soup', lv: 9, mats: { tomato: 2, sunleaf: 1 }, buff: { xp: 0.12, regen: 2 }, dur: 360 },
  pumpkin_soup: { name: 'Pumpkin Soup', lv: 15, mats: { pumpkin: 1, butter: 1, carrot: 1 }, buff: { atk: 0.1, def: 0.1 }, dur: 420 },
};
export const MILL_RECIPES = {
  mill_flour:     { out: 'flour', qty: 2, mats: { wheat: 3 }, gold: 0, at: 'mill' },
  mill_malt:      { out: 'malt', qty: 1, mats: { barley: 3 }, gold: 0, at: 'mill' },
  mill_bone_meal: { out: 'bone_meal', qty: 2, mats: { bone: 1 }, gold: 0, at: 'mill' },
  mill_seeds:     { out: 'sunflower_seeds', qty: 4, mats: { sunflower: 1 }, gold: 0, at: 'mill' },
};

// which crop sprite to draw for an entity: kind = crop id, stage index into CROP_STAGES, or withered
export function cropSprite(kind, stage, withered) {
  if (withered) return 'crop_withered';
  if (stage <= 0) return 'crop_hole';
  if (stage === 1) return 'crop_seeded';
  return `crop_${kind}_${stage - 1}`;      // 1..4: sprout, young, grown, ripe
}
