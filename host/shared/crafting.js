// Crafting trades: Blacksmithing, Leatherworking and Tailoring. Each levels 1-25 like the
// gathering trades. The class pieces follow the armour styles (a warrior's helms, gauntlets
// and boots are smithed, a ranger's sewn from hide, a mage's woven), and every trade also
// makes something any hero can use: jewellery and whetstones, armour kits, bandages.
// You craft at Hilda's forge in town or at the workbench in any camp.
//
// content.js merges CRAFT_ITEMS into ITEMS, CRAFT_RECIPES into RECIPES and CRAFT_DROPS into
// the monsters' loot tables.

export const CRAFT_TRADES = {
  blacksmithing:  { name: 'Blacksmithing', icon: 'item_helm_w2', verb: 'smith', cls: 'warrior', made: 'Plate helms, gauntlets and boots, rings, amulets and whetstones' },
  leatherworking: { name: 'Leatherworking', icon: 'item_gloves_r2', verb: 'work leather', cls: 'ranger', made: 'Hide caps, gloves and boots, and armour kits' },
  tailoring:      { name: 'Tailoring', icon: 'item_boots_m3', verb: 'sew', cls: 'mage', made: 'Robed hoods, gloves and slippers, and bandages' },
};
export const CRAFT_ORDER = Object.keys(CRAFT_TRADES);
export const TRADE_OF_CLASS = { warrior: 'blacksmithing', ranger: 'leatherworking', mage: 'tailoring' };
export const CRAFT_TIER_LV = [1, 6, 12, 18];   // the trade level a tier needs

// new materials (icons baked as icon_<id>)
export const CRAFT_ITEMS = {
  rough_hide:  { name: 'Rough Hide', type: 'material', stack: 50, price: 4, desc: 'Skinned from wolves and boars. Leatherworkers turn it into caps, gloves and boots.' },
  thick_hide:  { name: 'Thick Hide', type: 'material', stack: 50, price: 9, desc: 'Tough hide from dire wolves, trolls and the things in the bog.' },
  linen:       { name: 'Linen Cloth', type: 'material', stack: 50, price: 4, desc: 'Bandits and goblins carry bolts of it. Tailors sew it into hoods, gloves and shoes.' },
  spirit_silk: { name: 'Spirit Silk', type: 'material', stack: 50, price: 12, desc: 'Cold, pale thread from wraiths and cultists. It shimmers in the dark.' },
  moonstone:   { name: 'Moonstone', type: 'material', stack: 50, price: 40, desc: 'A milky stone from the deepest silver veins. It glows a little at night.' },
  // things any hero can use
  whetstone:   { name: 'Whetstone', type: 'kit', stack: 10, price: 20, buff: { atk: 0.08 }, dur: 600, desc: 'Hone your weapon: +8% attack for 10 minutes. (One kit at a time.)' },
  armor_kit:   { name: 'Armour Kit', type: 'kit', stack: 10, price: 20, buff: { def: 0.12 }, dur: 600, desc: 'Straps, rivets and patches: +12% defense for 10 minutes. (One kit at a time.)' },
  bandage:     { name: 'Linen Bandage', type: 'bandage', stack: 20, price: 12, heal: 0.3, dur: 5, desc: 'Bind your wounds: heals 30% of your health over 5 seconds, even in a fight.' },
};
for (const [id, it] of Object.entries(CRAFT_ITEMS)) it.icon = 'icon_' + id;

// what goes into each tier, by trade: [helm, gloves, boots] share the same materials, scaled
const PIECE_MATS = {
  blacksmithing:  [{ copper_ore: 3, oak_log: 1 }, { iron_ore: 3, copper_ore: 2 }, { iron_ore: 4, silver_ore: 2 }, { silver_ore: 3, deep_iron: 3, moonstone: 1 }],
  leatherworking: [{ rough_hide: 3 }, { rough_hide: 4, silk: 1 }, { thick_hide: 3, rough_hide: 2 }, { thick_hide: 4, silk: 3, moonstone: 1 }],
  tailoring:      [{ linen: 3 }, { linen: 4, sunleaf: 2 }, { spirit_silk: 2, linen: 3 }, { spirit_silk: 4, nightbloom: 2, moonstone: 1 }],
};
const SLOT_SCALE = { helm: 1, gloves: 0.75, boots: 0.85 };

export const CRAFT_RECIPES = {};
for (const [trade, tiers] of Object.entries(PIECE_MATS)) {
  const cls = CRAFT_TRADES[trade].cls, c = cls[0];
  tiers.forEach((mats, i) => {
    const t = i + 1;
    for (const slot of ['helm', 'gloves', 'boots']) {
      const m = {};
      for (const [k, q] of Object.entries(mats)) m[k] = k === 'moonstone' || k === 'oak_log' ? q : Math.max(1, Math.round(q * SLOT_SCALE[slot]));
      CRAFT_RECIPES[`craft_${slot}_${c}${t}`] = { out: `${slot}_${c}${t}`, mats: m, gold: [5, 15, 40, 90][i], at: 'craft', trade, lv: CRAFT_TIER_LV[i], cls };
    }
  });
}
// jewellery (smiths), anyone may wear it
const RING_MATS = [{ copper_ore: 4 }, { silver_ore: 3 }, { silver_ore: 3, rough_gem: 1 }, { silver_ore: 4, rough_gem: 1, king_shard: 1 }];
const AMULET_MATS = [{ copper_ore: 2, bone: 2 }, { silver_ore: 3, sunleaf: 1 }, { silver_ore: 3, rough_gem: 1 }, { silver_ore: 4, moonstone: 2, rough_gem: 1 }];
for (let i = 0; i < 4; i++) {
  CRAFT_RECIPES[`craft_ring_${i + 1}`] = { out: `ring_${i + 1}`, mats: RING_MATS[i], gold: [5, 15, 40, 90][i], at: 'craft', trade: 'blacksmithing', lv: CRAFT_TIER_LV[i] + 2 };
  CRAFT_RECIPES[`craft_amulet_${i + 1}`] = { out: `amulet_${i + 1}`, mats: AMULET_MATS[i], gold: [5, 15, 40, 90][i], at: 'craft', trade: 'blacksmithing', lv: CRAFT_TIER_LV[i] + 3 };
}
// the everyday things
CRAFT_RECIPES.craft_whetstone = { out: 'whetstone', qty: 2, mats: { copper_ore: 1, oak_log: 1 }, gold: 0, at: 'craft', trade: 'blacksmithing', lv: 1 };
CRAFT_RECIPES.craft_armor_kit = { out: 'armor_kit', qty: 2, mats: { rough_hide: 2 }, gold: 0, at: 'craft', trade: 'leatherworking', lv: 1 };
CRAFT_RECIPES.craft_bandage = { out: 'bandage', qty: 3, mats: { linen: 2 }, gold: 0, at: 'craft', trade: 'tailoring', lv: 1 };

// crafting experience: more for harder recipes
export const craftXp = (R) => 25 + R.lv * 9;
// better results the more your skill exceeds the recipe: [plain, Fine, Masterwork] weights
export function craftRarity(tradeLv, recipeLv) {
  const over = Math.max(0, tradeLv - recipeLv);
  return [Math.max(20, 62 - over * 4), 30 + over * 2.2, 8 + over * 1.8];
}

// monsters carry the new materials: [item, chance]
export const CRAFT_DROPS = {
  wolf: [['rough_hide', 0.5]], boar: [['rough_hide', 0.55]], dire_wolf: [['rough_hide', 0.35], ['thick_hide', 0.3]],
  hill_troll: [['thick_hide', 0.45]], troll_king: [['thick_hide', 1]], bog_lurker: [['thick_hide', 0.4]], frost_wyrm: [['thick_hide', 1], ['moonstone', 1]],
  bandit: [['linen', 0.45]], bandit_captain: [['linen', 1]], goblin: [['linen', 0.2]], raider: [['linen', 0.35]], goblin_miner: [['linen', 0.2]],
  cultist: [['spirit_silk', 0.3], ['linen', 0.2]], frost_wraith: [['spirit_silk', 0.4]], mire_hag: [['spirit_silk', 1], ['moonstone', 1]],
  ice_golem: [['moonstone', 0.06]], golem: [['moonstone', 0.04]],
};
