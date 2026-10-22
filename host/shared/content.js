// Game data shared by client and server. The server is authoritative over
// everything here; the client only uses it for display (names, icons, prices).

// ---- Static world objects -------------------------------------------------
// sprites: baked sprite names (see tools/baker/models.js)
// foot: footprint in tiles [w, h]; solid: blocks movement; fade: becomes
// see-through when it hides your character; lights: night-time light sources
// as offsets from the object's center { x, y, z (height), r (tiles), c (color) }.
import { TRADE_ITEMS, TRADE_RECIPES } from './trades.js';
import { SIGN_KINDS, CAMP_KINDS, CROSS_KINDS, boardSprite } from './signs.js';
import { QUEST_MOBS, START_LEVELS, QUEST_NPCS, QUEST_ITEMS, SET_ITEMS, QUEST_SKILLS, MILESTONE_SKILLS, QUEST_TITLES, QUESTS_NEW, QUEST_ORDER_NEW, QUEST_DROPS_NEW, paceQuests, xpCurve } from './questline.js';

const WARM = '255,190,110', FIRE = '255,140,60';
export const OBJECTS = {
  oak:          { sprites: ['oak_0', 'oak_1', 'oak_2'], foot: [1, 1], solid: true, fade: true },
  pine:         { sprites: ['pine_0', 'pine_1', 'pine_2'], foot: [1, 1], solid: true, fade: true },
  birch:        { sprites: ['birch_0', 'birch_1', 'birch_2'], foot: [1, 1], solid: true, fade: true },
  maple:        { sprites: ['maple_0', 'maple_1', 'maple_2'], foot: [1, 1], solid: true, fade: true },
  willow:       { sprites: ['willow_0', 'willow_1'], foot: [1, 1], solid: true, fade: true },
  bush:         { sprites: ['bush_0', 'bush_1'], foot: [1, 1], solid: true },
  fern:         { sprites: ['fern_0', 'fern_1', 'fern_2'], foot: [1, 1], solid: false, flat: true },
  reeds:        { sprites: ['reeds_0', 'reeds_1'], foot: [1, 1], solid: false },
  lily:         { sprites: ['lily_0', 'lily_1', 'lily_2'], foot: [1, 1], solid: false, flat: true },
  rock:         { sprites: ['rock_0', 'rock_1', 'rock_2'], foot: [1, 1], solid: true },
  stump:        { sprites: ['stump'], foot: [1, 1], solid: true },
  flowers:      { sprites: ['flowers_0', 'flowers_1', 'flowers_2'], foot: [1, 1], solid: false, flat: true },
  tuft:         { sprites: ['tuft_0', 'tuft_1', 'tuft_2'], foot: [1, 1], solid: false, flat: true },
  house_small:  { sprites: ['house_small'], foot: [3, 3], solid: true, fade: true, smoke: [{ x: -0.75, y: -0.35, z: 3.95 }],
    lights: [{ x: 0.6, y: 1.35, z: 1.1, r: 1.6, c: WARM }, { x: 1.35, y: -0.5, z: 1.1, r: 1.4, c: WARM }, { x: 1.35, y: 0.55, z: 1.1, r: 1.4, c: WARM }] },
  house_large:  { sprites: ['house_large'], foot: [4, 4], solid: true, fade: true, smoke: [{ x: -0.4, y: -1.0, z: 5.4 }],
    lights: [{ x: 0.85, y: 1.85, z: 1.1, r: 1.8, c: WARM }, { x: 1.85, y: -0.7, z: 1.1, r: 1.5, c: WARM }, { x: 1.85, y: 0.77, z: 1.1, r: 1.5, c: WARM }, { x: -0.6, y: 1.85, z: 2.1, r: 1.3, c: WARM }] },
  well:         { sprites: ['well'], foot: [2, 2], solid: true },
  tavern:       { sprites: ['tavern'], foot: [4, 4], solid: true, fade: true, smoke: [{ x: -1.15, y: -0.55, z: 5.25 }, { x: 1.0, y: -0.55, z: 5.1 }],
    lights: [{ x: 0.95, y: 2.0, z: 0.7, r: 1.8, c: WARM }, { x: 0.42, y: 2.1, z: 1.4, r: 2.2, c: WARM }, { x: 2.0, y: -0.85, z: 0.7, r: 1.5, c: WARM }, { x: 2.0, y: 0.6, z: 0.7, r: 1.5, c: WARM }, { x: 0, y: 2.0, z: 2.2, r: 1.4, c: WARM }] },
  chapel:       { sprites: ['chapel'], foot: [3, 4], solid: true, fade: true,
    lights: [{ x: 1.45, y: -0.95, z: 1.2, r: 1.7, c: '235,190,150' }, { x: 1.45, y: 0.25, z: 1.2, r: 1.7, c: '170,180,255' }, { x: 0, y: 2.0, z: 2.1, r: 1.3, c: '160,180,255' }] },
  windmill:     { sprites: ['windmill'], foot: [3, 3], solid: true, fade: true, anim: 8, fps: 5 },
  banner:       { sprites: ['banner_0', 'banner_1'], foot: [1, 1], solid: true, anim: 6, fps: 8 },
  hay:          { sprites: ['hay_0', 'hay_1'], foot: [1, 1], solid: true },
  haycart:      { sprites: ['haycart'], foot: [2, 1], solid: true },
  washing:      { sprites: ['washing'], foot: [2, 1], solid: true },
  stonewall_x:  { sprites: ['stonewall_x'], foot: [1, 1], solid: true },
  stonewall_y:  { sprites: ['stonewall_y'], foot: [1, 1], solid: true },
  // ---- the town
  fountain:     { sprites: ['fountain'], foot: [4, 4], solid: true, fountain: { x: 0, y: 0, z: 2.75 } },
  shop_general: { sprites: ['shop_general'], foot: [4, 4], solid: true, fade: true, smoke: [{ x: -0.6, y: -1.0, z: 5.2 }], lights: [{ x: 2.0, y: -0.5, z: 0.8, r: 2.0, c: WARM }, { x: 2.1, y: 1.0, z: 1.3, r: 1.6, c: WARM }] },
  shop_armor:   { sprites: ['shop_armor'], foot: [4, 4], solid: true, fade: true, smoke: [{ x: -0.6, y: -1.0, z: 5.2 }], lights: [{ x: 2.0, y: -0.5, z: 0.8, r: 2.0, c: WARM }, { x: 2.1, y: 1.0, z: 1.3, r: 1.6, c: WARM }] },
  shop_apoth:   { sprites: ['shop_apoth'], foot: [4, 4], solid: true, fade: true, smoke: [{ x: -0.6, y: -1.0, z: 5.2 }], lights: [{ x: 2.0, y: -0.5, z: 0.8, r: 2.0, c: WARM }, { x: 2.3, y: -0.6, z: 1.0, r: 1.8, c: '140,255,170' }] },
  townhouse:    { sprites: ['townhouse_0', 'townhouse_1', 'townhouse_2'], foot: [3, 3], solid: true, fade: true, smoke: [{ x: -0.6, y: -0.5, z: 6.15 }],
    lights: [{ x: 0.55, y: 1.4, z: 0.7, r: 1.5, c: WARM }, { x: 1.4, y: 0.0, z: 2.0, r: 1.4, c: WARM }] },
  bench_x:      { sprites: ['bench_x'], foot: [2, 1], solid: true },
  // the stone bridge over the river: the deck and its far parapet, then the near wall in pieces
  bridge:       { sprites: ['bridge'], foot: [9, 4], solid: false, depthBias: -6 },
  bridge_wall:  { sprites: Array.from({ length: 9 }, (_, i) => `bridge_wall_${i}`), foot: [1, 1], solid: true },
  noticeboard:  { sprites: ['noticeboard'], foot: [1, 1], solid: true },
  // ---- the bank: walk in through the open front; the roof hides while you're inside
  bank_roof:    { sprites: ['bank_roof'], foot: [17, 14], solid: false, roof: true, depthBias: 15 },
  bankwall_n:   { sprites: ['bankwall_n_plain', 'bankwall_n_pilaster', 'bankwall_n_painting', 'bankwall_n_shelf', 'bankwall_n_window', 'bankwall_n_banner', 'bankwall_n_sconce'], foot: [1, 1], solid: true, fade: true },
  bankwall_w:   { sprites: ['bankwall_w_plain', 'bankwall_w_pilaster', 'bankwall_w_painting', 'bankwall_w_window', 'bankwall_w_banner', 'bankwall_w_sconce'], foot: [1, 1], solid: true, fade: true },
  bankwall_e:   { sprites: ['bankwall_e_window', 'bankwall_e_pilaster'], foot: [1, 1], solid: true, fade: true },
  bank_pier:    { sprites: ['bank_pier'], foot: [1, 1], solid: true, fade: true },
  bank_column:  { sprites: ['bank_column'], foot: [1, 1], solid: true, fade: true },
  bank_vault:   { sprites: ['bank_vault'], foot: [3, 1], solid: true, fade: true },
  bank_counter: { sprites: ['bank_counter_0', 'bank_counter_1', 'bank_counter_2'], foot: [1, 1], solid: true },
  bank_desk:    { sprites: ['bank_desk'], foot: [2, 1], solid: true },
  bank_safe:    { sprites: ['bank_safe'], foot: [1, 1], solid: true },
  bank_gold:    { sprites: ['bank_gold'], foot: [1, 1], solid: true },
  bank_rug:     { sprites: ['bank_rug'], foot: [3, 7], solid: false, flat: true },
  bank_table:   { sprites: ['bank_table'], foot: [2, 2], solid: true, lights: [{ x: 0.2, y: 0.15, z: 1.0, r: 1.4, c: '160,255,170' }] },
  bank_bench_w: { sprites: ['bank_bench_w'], foot: [1, 2], solid: true },
  bank_bench_e: { sprites: ['bank_bench_e'], foot: [1, 2], solid: true },
  bank_plant:   { sprites: ['bank_plant'], foot: [1, 1], solid: true },
  bank_clock:   { sprites: ['bank_clock'], foot: [1, 1], solid: true, fade: true },
  bank_chandelier: { sprites: ['bank_chandelier'], foot: [1, 1], solid: false, lights: [{ x: 0, y: 0, z: 2.7, r: 5.5, c: '255,214,150' }] },
  // ---- walk-in buildings: the inn, the shops and the chapel. North and west pieces show their insides,
  // east and south pieces the outside; those (and the corner posts) fade away while you're indoors (cut).
  tw_n:         { sprites: ['tw_n_plain', 'tw_n_window', 'tw_n_painting', 'tw_n_shelf_goods', 'tw_n_shelf_potions', 'tw_n_herbs', 'tw_n_rack_weapons', 'tw_n_shields', 'tw_n_bottles', 'tw_n_sconce', 'tw_n_antlers'], foot: [1, 1], solid: true, fade: true },
  tw_w:         { sprites: ['tw_w_plain', 'tw_w_window', 'tw_w_painting', 'tw_w_shelf_goods', 'tw_w_shelf_potions', 'tw_w_herbs', 'tw_w_rack_weapons', 'tw_w_shields', 'tw_w_bottles', 'tw_w_sconce', 'tw_w_antlers'], foot: [1, 1], solid: true, fade: true },
  tw_e:         { sprites: ['tw_e_plain', 'tw_e_window', 'tw_e_lantern', 'tw_e_sign_general', 'tw_e_sign_armor', 'tw_e_sign_apoth', 'tw_e_sign_inn'], foot: [1, 1], solid: true, fade: true, cut: true },
  tw_s:         { sprites: ['tw_s_plain', 'tw_s_window', 'tw_s_lantern', 'tw_s_sign_general', 'tw_s_sign_armor', 'tw_s_sign_apoth', 'tw_s_sign_inn'], foot: [1, 1], solid: true, fade: true, cut: true },
  tw_e_door:    { sprites: ['tw_e_door'], foot: [1, 1], solid: false, cut: true, lights: [{ x: 0.38, y: 0.3, z: 2.0, r: 2.6, c: WARM }] },
  tw_s_door:    { sprites: ['tw_s_door'], foot: [1, 1], solid: false, cut: true, lights: [{ x: 0.3, y: 0.38, z: 2.0, r: 2.6, c: WARM }] },
  tw_pier:      { sprites: ['tw_pier'], foot: [1, 1], solid: true, fade: true, cut: true },
  cw_n:         { sprites: ['cw_n_plain', 'cw_n_stained', 'cw_n_altar', 'cw_n_banner', 'cw_n_candles'], foot: [1, 1], solid: true, fade: true },
  cw_w:         { sprites: ['cw_w_plain', 'cw_w_stained', 'cw_w_banner', 'cw_w_candles'], foot: [1, 1], solid: true, fade: true },
  cw_e:         { sprites: ['cw_e_plain', 'cw_e_stained', 'cw_e_buttress'], foot: [1, 1], solid: true, fade: true, cut: true },
  cw_s:         { sprites: ['cw_s_plain', 'cw_s_stained', 'cw_s_buttress'], foot: [1, 1], solid: true, fade: true, cut: true },
  cw_s_door:    { sprites: ['cw_s_door'], foot: [1, 1], solid: false, cut: true },
  cw_pier:      { sprites: ['cw_pier'], foot: [1, 1], solid: true, fade: true, cut: true },
  shop_counter: { sprites: ['shop_counter_plain', 'shop_counter_general', 'shop_counter_armor', 'shop_counter_apoth'], foot: [1, 1], solid: true },
  armor_stand:  { sprites: ['armor_stand'], foot: [1, 1], solid: true },
  weapon_rack:  { sprites: ['weapon_rack'], foot: [1, 1], solid: true },
  cauldron:     { sprites: ['cauldron'], foot: [1, 1], solid: true, anim: 4, fps: 5, lights: [{ x: 0, y: 0, z: 0.7, r: 2.4, c: '120,255,150', flicker: true, always: true }] },
  herb_table:   { sprites: ['herb_table'], foot: [1, 1], solid: true },
  shop_crates:  { sprites: ['shop_crates'], foot: [1, 1], solid: true },
  inn_bar:      { sprites: ['inn_bar_0', 'inn_bar_1'], foot: [1, 1], solid: true },
  inn_kegs:     { sprites: ['inn_kegs'], foot: [1, 1], solid: true },
  inn_table:    { sprites: ['inn_table_0', 'inn_table_1', 'inn_table_2'], foot: [2, 2], solid: true, lights: [{ x: 0, y: 0, z: 0.9, r: 1.8, c: '255,200,120', flicker: true }] },
  inn_stairs:   { sprites: ['inn_stairs'], foot: [1, 3], solid: true, fade: true },
  inn_fireplace:{ sprites: ['inn_fireplace'], foot: [2, 1], solid: true, anim: 4, fps: 7, lights: [{ x: 0, y: 0.6, z: 0.5, r: 5.5, c: FIRE, flicker: true, always: true }] },
  inn_rug:      { sprites: ['inn_rug'], foot: [2, 2], solid: false, flat: true },
  ch_pew:       { sprites: ['ch_pew'], foot: [2, 1], solid: true },
  ch_altar:     { sprites: ['ch_altar'], foot: [3, 1], solid: true, lights: [{ x: 0, y: 0.1, z: 1.7, r: 2.6, c: '255,210,140', flicker: true }] },
  ch_candelabra:{ sprites: ['ch_candelabra'], foot: [1, 1], solid: true, lights: [{ x: 0, y: 0, z: 1.5, r: 3.4, c: '255,205,130', flicker: true }] },
  shop_roof_general: { sprites: ['shop_roof_general'], foot: [6, 6], solid: false, roof: true, depthBias: 7, smoke: [{ x: -1.6, y: -1.0, z: 7.6 }] },
  shop_roof_armor:   { sprites: ['shop_roof_armor'], foot: [6, 6], solid: false, roof: true, depthBias: 7, smoke: [{ x: -1.6, y: -1.0, z: 7.6 }] },
  shop_roof_apoth:   { sprites: ['shop_roof_apoth'], foot: [6, 6], solid: false, roof: true, depthBias: 7, smoke: [{ x: -1.6, y: -1.0, z: 7.6 }, { x: 1.4, y: 0.8, z: 7.0 }] },
  inn_roof:     { sprites: ['inn_roof'], foot: [10, 9], solid: false, roof: true, depthBias: 10, smoke: [{ x: 0.5, y: -2.0, z: 8.1 }, { x: -3.6, y: -1.0, z: 7.9 }] },
  chapel_roof:  { sprites: ['chapel_roof'], foot: [9, 9], solid: false, roof: true, depthBias: 9 },
  fence_x:      { sprites: ['fence_x'], foot: [1, 1], solid: true },
  fence_y:      { sprites: ['fence_y'], foot: [1, 1], solid: true },
  scarecrow:    { sprites: ['scarecrow'], foot: [1, 1], solid: true, fade: true },
  trough:       { sprites: ['trough'], foot: [2, 1], solid: true },
  farm_sign:    { sprites: ['farm_sign'], foot: [1, 1], solid: true },
  crate:        { sprites: ['crate'], foot: [1, 1], solid: true },
  // wreckage from the ship, bobbing in the shallows off Tutorial Island
  flot_crate:   { sprites: ['crate'], foot: [1, 1], solid: false, bob: true },
  flot_barrel:  { sprites: ['barrel'], foot: [1, 1], solid: false, bob: true },
  barrel:       { sprites: ['barrel'], foot: [1, 1], solid: true },
  lamp:         { sprites: ['lamp'], foot: [1, 1], solid: true, fade: true, lights: [{ x: 0, y: 0, z: 2.0, r: 4.2, c: WARM }] },
  sign:         { sprites: ['sign'], foot: [1, 1], solid: true },
  // hanging signs (shared/signs.js): the bracket or post with its lantern, and the painted board that swings
  hbracket_e:   { sprites: ['hbracket_e'], foot: [1, 1], solid: false, lights: [{ x: 0.62, y: 0, z: 2.64, r: 2.3, c: WARM, flicker: true }] },
  hbracket_s:   { sprites: ['hbracket_s'], foot: [1, 1], solid: false, lights: [{ x: 0, y: 0.62, z: 2.64, r: 2.3, c: WARM, flicker: true }] },
  signpost:     { sprites: ['signpost'], foot: [1, 1], solid: true, lights: [{ x: 0, y: 0, z: 3.25, r: 2.5, c: WARM, flicker: true }] },
  hsign:        { sprites: SIGN_KINDS.map(boardSprite), foot: [1, 1], solid: false },
  crossroads:   { sprites: CROSS_KINDS.map((k) => `crossroads_${k}`), foot: [1, 1], solid: true },
  campboard:    { sprites: CAMP_KINDS.map((k) => `campboard_${k}`), foot: [1, 1], solid: true },
  stable:       { sprites: ['stable'], foot: [3, 2], solid: true, fade: true, lights: [{ x: 0, y: 0.75, z: 1.8, r: 2.6, c: WARM, flicker: true }] },
  stall:        { sprites: ['stall'], foot: [2, 2], solid: true, fade: true },
  tent:         { sprites: ['tent'], foot: [2, 2], solid: true, fade: true },
  campfire:     { sprites: ['campfire'], foot: [1, 1], solid: true, anim: 6, fire: [{ x: 0, y: 0, z: 0.12, s: 0.72, n: 2, light: true }], lights: [{ x: 0, y: 0, z: 0.5, r: 6, c: FIRE, flicker: true }] },
  logs:         { sprites: ['logs'], foot: [2, 1], solid: true },
  forge:        { sprites: ['forge'], foot: [2, 2], solid: true, fade: true, smoke: [{ x: -0.25, y: 0.1, z: 3.3 }], lights: [{ x: 0.2, y: 0.5, z: 0.7, r: 3.5, c: FIRE, flicker: true }] },
  anvil:        { sprites: ['anvil'], foot: [1, 1], solid: true },
  waystone:     { sprites: ['waystone'], foot: [1, 1], solid: true, fade: true, lights: [{ x: 0, y: 0, z: 1.6, r: 3.2, c: '120,220,255', always: true }] },
  shrine:       { sprites: ['shrine'], foot: [2, 2], solid: true, fade: true, lights: [{ x: 0.1, y: 0.4, z: 0.9, r: 2.2, c: '255,220,150', flicker: true }] },
  cave_entrance:{ sprites: ['cave_entrance'], foot: [3, 2], solid: true, fade: true },
  // dungeon
  wall_cave:    { sprites: ['wall_cave_0', 'wall_cave_1', 'wall_cave_2'], foot: [1, 1], solid: true, fade: true, wall: true },
  wall_cave_low:{ sprites: ['wall_cave_low'], foot: [1, 1], solid: true, wall: true },
  wall_crypt:   { sprites: ['wall_crypt_0', 'wall_crypt_1', 'wall_crypt_2'], foot: [1, 1], solid: true, fade: true, wall: true },
  wall_crypt_low:{ sprites: ['wall_crypt_low'], foot: [1, 1], solid: true, wall: true },
  brazier:      { sprites: ['brazier'], foot: [1, 1], solid: true, anim: 4, lights: [{ x: 0, y: 0, z: 0.9, r: 5.5, c: FIRE, flicker: true }] },
  cart:         { sprites: ['cart'], foot: [1, 1], solid: true },
  beam:         { sprites: ['beam'], foot: [1, 1], solid: true, fade: true },
  // the ship the hero washed up from, broken on the beach of Tutorial Island (Poly Haven's Dutch ship, CC0, wrecked in Blender)
  shipwreck:    { sprites: ['shipwreck'], foot: [1, 1], solid: true, fade: true },
  // a timber of the wreck on Tutorial Island, still burning: flames, embers, firelight and black smoke
  burning_beam: { sprites: ['logs'], foot: [1, 1], solid: true, fade: true, fire: [{ x: 0, y: 0, z: 0.25, s: 1.15, n: 3 }], lights: [{ x: 0, y: 0, z: 0.8, r: 5, c: FIRE, flicker: true }] },
  rockpile:     { sprites: ['rockpile'], foot: [1, 1], solid: true },
  web:          { sprites: ['web_0', 'web_1'], foot: [1, 1], solid: false, flat: true },
  eggsac:       { sprites: ['eggsac'], foot: [1, 1], solid: true },
  bones:        { sprites: ['bones_0', 'bones_1'], foot: [1, 1], solid: false, flat: true },
  pillar:       { sprites: ['pillar'], foot: [1, 1], solid: true, fade: true },
  coffin:       { sprites: ['coffin'], foot: [1, 1], solid: true },
  candles:      { sprites: ['candles'], foot: [1, 1], solid: false, lights: [{ x: 0, y: 0, z: 0.3, r: 2.2, c: '255,200,120', flicker: true }] },
};

// ---- Classes and skills ------------------------------------------------------
import { SPEC_SKILLS } from './specs.js';
import { GEAR_ITEMS } from './gear.js';
import { CRAFT_ITEMS, CRAFT_RECIPES, CRAFT_DROPS } from './crafting.js';
export const CLASSES = {
  warrior: {
    name: 'Warrior', blurb: 'Sword and shield. Tough, hits hard up close.',
    hp: 120, atk: 11, def: 4, speed: 3.3, gains: { hp: 16, atk: 2, def: 2 },
    range: 1.35, cooldown: 0.75, windup: 0.3, projectile: null,
    skills: ['cleave', 'whirlwind', 'battlecry', 'shieldslam', 'earthshaker'], weapon: 'sword_1',
  },
  ranger: {
    name: 'Ranger', blurb: 'Bow and arrows. Fast, strikes from a distance.',
    hp: 95, atk: 10, def: 2, speed: 3.6, gains: { hp: 12, atk: 2, def: 1 },
    range: 7, cooldown: 0.85, windup: 0.35, projectile: 'arrow',
    skills: ['multishot', 'dash', 'volley', 'piercing', 'eagleeye'], weapon: 'bow_1',
  },
  mage: {
    name: 'Mage', blurb: 'Staff and spells. Fragile, devastating magic.',
    hp: 85, atk: 12, def: 1, speed: 3.3, gains: { hp: 10, atk: 3, def: 1 },
    range: 6, cooldown: 0.95, windup: 0.4, projectile: 'bolt',
    skills: ['fireball', 'frostnova', 'heal', 'chainlight', 'meteor'], weapon: 'staff_1',
  },
};
export const CLASS_ORDER = ['warrior', 'ranger', 'mage'];

// target: 'dir' aims toward the cursor, 'point' acts at the cursor, 'self' acts around you
export const SKILLS = {
  cleave:    { name: 'Cleave', cls: 'warrior', cd: 5, anim: 'attack', target: 'dir', icon: 'cleave',
    desc: (r) => `Sweep your blade through every enemy in front of you for ${130 + r * 20}% damage.` },
  whirlwind: { name: 'Whirlwind', cls: 'warrior', cd: 12, anim: 'spin', target: 'self', icon: 'whirlwind',
    desc: (r) => `Spin for ${(1.2 + r * 0.3).toFixed(1)}s, hitting everything around you for ${55 + r * 10}% damage per turn.` },
  battlecry: { name: 'Battle Cry', cls: 'warrior', cd: 24, anim: 'cast', target: 'self', icon: 'battlecry',
    desc: (r) => `Roar to gain ${20 + r * 10}% attack and defense for ${6 + r * 2}s and heal ${10 + r * 5}% health.` },
  multishot: { name: 'Multishot', cls: 'ranger', cd: 6, anim: 'attack', target: 'dir', icon: 'multishot',
    desc: (r) => `Loose ${3 + r * 2} arrows in a fan, each dealing ${70 + r * 10}% damage.` },
  dash:      { name: 'Dash', cls: 'ranger', cd: 7, anim: 'walk', target: 'point', range: 5, icon: 'dash',
    desc: (r) => `Leap up to 5 tiles toward the cursor. Cooldown shortens with rank (${7 - r}s).` },
  volley:    { name: 'Arrow Rain', cls: 'ranger', cd: 14, anim: 'cast', target: 'point', range: 9, icon: 'volley',
    desc: (r) => `Rain ${2 + r} waves of arrows on an area for ${80 + r * 15}% damage each.` },
  fireball:  { name: 'Fireball', cls: 'mage', cd: 3.5, anim: 'attack', target: 'dir', icon: 'fireball',
    desc: (r) => `Hurl a fireball that explodes for ${150 + r * 25}% damage to everything nearby.` },
  frostnova: { name: 'Frost Nova', cls: 'mage', cd: 10, anim: 'cast', target: 'self', icon: 'frostnova',
    desc: (r) => `Blast frost around you for ${80 + r * 15}% damage and slow enemies by half for ${2 + r}s.` },
  heal:      { name: 'Mend', cls: 'mage', cd: 18, anim: 'cast', target: 'self', icon: 'heal',
    desc: (r) => `Restore ${25 + r * 10}% of your health and that of allies near you.` },
};
Object.assign(SKILLS, QUEST_SKILLS, SPEC_SKILLS);
export { MILESTONE_SKILLS };
export const MAX_SKILL_RANK = 3;

// ---- Items -------------------------------------------------------------------
// Gear is class-locked and comes in three tiers; vis is the sprite layer drawn
// on the character (see the baker). Rarity multiplies a gear item's stat.
export const RARITY = [
  { name: '', color: '#ece2cc', mult: 1 },
  { name: 'Fine', color: '#7ee07e', mult: 1.2 },
  { name: 'Masterwork', color: '#6aaeff', mult: 1.45 },
  { name: 'Heroic', color: '#c77dff', mult: 1.75 },     // rare monsters' prizes
];

export const ITEMS = {
  potion:      { name: 'Healing Potion', type: 'consumable', heal: 45, stack: 20, price: 15, icon: 'item_potion', desc: 'Restores 45 health.' },
  potion_big:  { name: 'Greater Healing Potion', type: 'consumable', heal: 130, stack: 20, price: 45, icon: 'item_potion_big', desc: 'Restores 130 health.' },
  gel:         { name: 'Slime Gel', type: 'material', stack: 50, price: 3, icon: 'mat_gel', desc: 'Sticky. The blacksmith uses it for binding and potions.' },
  scrap:       { name: 'Goblin Scrap', type: 'material', stack: 50, price: 5, icon: 'mat_scrap', desc: 'Bent metal from goblin gear. Good for reforging.' },
  trophy:      { name: "Grukk's Horn", type: 'material', stack: 10, price: 40, icon: 'mat_trophy', desc: 'Proof you bested the goblin chief.' },
  deep_iron:   { name: 'Deep Iron', type: 'material', stack: 50, price: 12, icon: 'mat_iron', desc: 'Dark ore the goblin miners were digging out.' },
  silk:        { name: 'Spider Silk', type: 'material', stack: 50, price: 10, icon: 'mat_silk', desc: 'Strong as wire, sticky as regret.' },
  bone:        { name: 'Grave Dust', type: 'material', stack: 50, price: 10, icon: 'mat_bone', desc: 'What is left of the restless dead.' },
  queen_fang:  { name: "Queen's Fang", type: 'material', stack: 10, price: 80, icon: 'mat_fang', desc: 'Still dripping. Handle with gloves.' },
  king_shard:  { name: 'Crown Shard', type: 'material', stack: 10, price: 120, icon: 'mat_shard', desc: "A shard of the Hollow King's crown. Cold to the touch." },
  sealed_map:  { name: 'Sealed Map', type: 'quest', stack: 1, price: 0, icon: 'quest_map', desc: 'Found in Grukk\'s tent. Marked with a seal you do not recognize.' },
  tobias_boot: { name: "Tobias's Lucky Boot", type: 'quest', stack: 1, price: 0, icon: 'icon_old_boot', desc: 'Soggy, salt-crusted, and apparently very lucky.' },
  driftwood:   { name: 'Driftwood', type: 'quest', stack: 10, price: 0, icon: 'icon_pine_log', desc: 'Sea-bleached timber, dry enough to burn.' },
  tobin_hat:   { name: "Tobin's Lucky Hat", type: 'quest', stack: 1, price: 0, icon: 'quest_hat', desc: 'Slightly digested.' },
  dye_crimson: { name: 'Crimson Dye', type: 'dye', dye: 1, stack: 10, price: 80, icon: 'dye_1', desc: 'Dyes your armor a deep red.' },
  dye_azure:   { name: 'Azure Dye', type: 'dye', dye: 2, stack: 10, price: 80, icon: 'dye_2', desc: 'Dyes your armor lake blue.' },
  dye_emerald: { name: 'Emerald Dye', type: 'dye', dye: 3, stack: 10, price: 80, icon: 'dye_3', desc: 'Dyes your armor forest green.' },
  dye_gold:    { name: 'Gilded Dye', type: 'dye', dye: 4, stack: 10, price: 250, icon: 'dye_4', desc: 'Dyes your armor gold. Subtle it is not.' },
  dye_shadow:  { name: 'Shadow Dye', type: 'dye', dye: 5, stack: 10, price: 250, icon: 'dye_5', desc: 'Dyes your armor black as the Deep.' },
  dye_frost:   { name: 'Frost Dye', type: 'dye', dye: 6, stack: 10, price: 250, icon: 'dye_6', desc: 'Dyes your armor bone white.' },
  dye_harvest: { name: 'Harvest Dye', type: 'dye', dye: 7, stack: 10, price: 150, icon: 'dye_7', special: true, desc: 'Dyes your armor the amber of festival lanterns. Only sold at the harvest festival.' },

  sword_1:     { name: 'Iron Sword', type: 'weapon', cls: 'warrior', tier: 1, atk: 4, price: 40, icon: 'item_sword_1', desc: 'Reliable and heavy.' },
  sword_2:     { name: 'Steel Sword', type: 'weapon', cls: 'warrior', tier: 2, atk: 10, price: 160, icon: 'item_sword_2', desc: 'Well balanced, keen edge.' },
  sword_3:     { name: 'Runeblade', type: 'weapon', cls: 'warrior', tier: 3, atk: 18, price: 420, icon: 'item_sword_3', desc: 'Runes glow along the fuller.' },
  bow_1:       { name: 'Hunting Bow', type: 'weapon', cls: 'ranger', tier: 1, atk: 4, price: 40, icon: 'item_bow_1', desc: 'A simple yew bow.' },
  bow_2:       { name: 'Longbow', type: 'weapon', cls: 'ranger', tier: 2, atk: 10, price: 160, icon: 'item_bow_2', desc: 'Long draw, long reach.' },
  bow_3:       { name: 'Elderwood Bow', type: 'weapon', cls: 'ranger', tier: 3, atk: 18, price: 420, icon: 'item_bow_3', desc: 'Pale wood that hums when drawn.' },
  staff_1:     { name: 'Oak Staff', type: 'weapon', cls: 'mage', tier: 1, atk: 4, price: 40, icon: 'item_staff_1', desc: 'A knotted oak focus.' },
  staff_2:     { name: 'Crystal Staff', type: 'weapon', cls: 'mage', tier: 2, atk: 10, price: 160, icon: 'item_staff_2', desc: 'A lake crystal set in silver.' },
  staff_3:     { name: 'Arcane Staff', type: 'weapon', cls: 'mage', tier: 3, atk: 18, price: 420, icon: 'item_staff_3', desc: 'Its orb drinks the light.' },
  sword_4:     { name: 'Kingsbane', type: 'weapon', cls: 'warrior', tier: 4, atk: 28, price: 900, icon: 'item_sword_4', desc: 'Forged from deep iron. It remembers the Hollow King.' },
  bow_4:       { name: 'Webstring Bow', type: 'weapon', cls: 'ranger', tier: 4, atk: 28, price: 900, icon: 'item_bow_4', desc: "Strung with the queen's own silk." },
  staff_4:     { name: 'Hollow Scepter', type: 'weapon', cls: 'mage', tier: 4, atk: 28, price: 900, icon: 'item_staff_4', desc: 'The crown shard at its tip whispers.' },

  armor_w1:    { name: 'Leather Jerkin', type: 'armor', cls: 'warrior', tier: 1, def: 4, price: 50, icon: 'warrior/a1/idle/1/0', desc: 'Boiled leather over padding.' },
  armor_w2:    { name: 'Chainmail', type: 'armor', cls: 'warrior', tier: 2, def: 9, price: 170, icon: 'warrior/a2/idle/1/0', desc: 'Riveted rings to the knee.' },
  armor_w3:    { name: 'Plate Armor', type: 'armor', cls: 'warrior', tier: 3, def: 16, price: 440, icon: 'warrior/a3/idle/1/0', desc: 'Full plate with a crested helm.' },
  armor_r1:    { name: 'Leather Vest', type: 'armor', cls: 'ranger', tier: 1, def: 3, price: 50, icon: 'ranger/a1/idle/1/0', desc: 'Light and quiet.' },
  armor_r2:    { name: 'Ranger Cloak', type: 'armor', cls: 'ranger', tier: 2, def: 7, price: 170, icon: 'ranger/a2/idle/1/0', desc: 'A hooded forest cloak.' },
  armor_r3:    { name: 'Shadowweave', type: 'armor', cls: 'ranger', tier: 3, def: 12, price: 440, icon: 'ranger/a3/idle/1/0', desc: 'Dark mail woven with silk.' },
  armor_m1:    { name: 'Apprentice Robe', type: 'armor', cls: 'mage', tier: 1, def: 2, price: 50, icon: 'mage/a1/idle/1/0', desc: 'Blue wool, many pockets.' },
  armor_m2:    { name: 'Adept Robes', type: 'armor', cls: 'mage', tier: 2, def: 6, price: 170, icon: 'mage/a2/idle/1/0', desc: 'Comes with the pointed hat.' },
  armor_m3:    { name: 'Archmage Regalia', type: 'armor', cls: 'mage', tier: 3, def: 11, price: 440, icon: 'mage/a3/idle/1/0', desc: 'Gold-trimmed and humming faintly.' },
  armor_w4:    { name: 'Hollowsteel Plate', type: 'armor', cls: 'warrior', tier: 4, def: 24, price: 950, icon: 'warrior/a4/idle/1/0', desc: 'Black plate edged in gold.' },
  armor_r4:    { name: 'Nightstalker Garb', type: 'armor', cls: 'ranger', tier: 4, def: 18, price: 950, icon: 'ranger/a4/idle/1/0', desc: 'Silk-lined leathers that drink the light.' },
  armor_m4:    { name: 'Robes of the Deep', type: 'armor', cls: 'mage', tier: 4, def: 16, price: 950, icon: 'mage/a4/idle/1/0', desc: 'Embroidered with the seal from the map.' },
};
Object.assign(ITEMS, TRADE_ITEMS, QUEST_ITEMS, SET_ITEMS, GEAR_ITEMS, CRAFT_ITEMS);
// travel: every hero carries a hearthstone; the first horse is the level 10 milestone reward
Object.assign(ITEMS, {
  hearthstone: { name: 'Hearthstone', type: 'hearth', stack: 1, price: 0, nosell: true, icon: 'item_hearthstone', desc: 'A smooth river stone that remembers the waystone in the town square. Use it (or press U) to return to Hollowmere. Once every 15 minutes.' },
  mount_horse: { name: 'Reins of the Ridgewatch Charger', type: 'mount', mount: 'horse', stack: 1, price: 0, nosell: true, icon: 'item_horseshoe', desc: 'A chestnut warhorse in crimson and gold, for those who pass the level 10 trial. Use to learn, then press G to ride.' },
});
export const MOUNTS = {
  horse: { name: 'Ridgewatch Charger', sprite: 'horse', speed: 1.7 },
};
export const INVENTORY_SIZE = 25;

// rings and amulets belong to no class: any hero gets them
export function gearFor(cls, slot, tier) {
  return Object.keys(ITEMS).find((k) => ITEMS[k].type === slot && ITEMS[k].tier === tier && (ITEMS[k].cls === cls || (!ITEMS[k].cls && (slot === 'ring' || slot === 'amulet'))));
}
export function itemStat(entry) {
  const d = ITEMS[entry.item];
  const m = RARITY[entry.r || 0].mult;
  return { atk: Math.round((d.atk || 0) * m), def: Math.round((d.def || 0) * m), hp: Math.round((d.hp || 0) * m) };
}
export function itemName(entry) {
  const r = RARITY[entry.r || 0];
  return (r.name ? r.name + ' ' : '') + ITEMS[entry.item].name;
}

// ---- Crafting (Hilda the blacksmith) ---------------------------------------
export const RECIPES = { potion: { out: 'potion', qty: 2, mats: { gel: 3 }, gold: 0 } };
for (const cls of ['warrior', 'ranger', 'mage']) {
  RECIPES[`${cls}_weapon_2`] = { out: gearFor(cls, 'weapon', 2), mats: { scrap: 6 }, gold: 60, cls };
  RECIPES[`${cls}_armor_2`] = { out: gearFor(cls, 'armor', 2), mats: { scrap: 4, gel: 4 }, gold: 60, cls };
  RECIPES[`${cls}_weapon_3`] = { out: gearFor(cls, 'weapon', 3), mats: { scrap: 10, trophy: 1 }, gold: 180, cls };
  RECIPES[`${cls}_armor_3`] = { out: gearFor(cls, 'armor', 3), mats: { scrap: 8, gel: 6, trophy: 1 }, gold: 180, cls };
  RECIPES[`${cls}_weapon_4`] = { out: gearFor(cls, 'weapon', 4), mats: { deep_iron: 6, king_shard: 1 }, gold: 300, cls, requires: 'iron' };
  RECIPES[`${cls}_armor_4`] = { out: gearFor(cls, 'armor', 4), mats: { deep_iron: 6, silk: 4, queen_fang: 1 }, gold: 300, cls, requires: 'iron' };
  // the same gear from ore and wood you gathered yourself
  RECIPES[`${cls}_weapon_2o`] = { out: gearFor(cls, 'weapon', 2), mats: { copper_ore: 6, oak_log: 3 }, gold: 40, cls };
  RECIPES[`${cls}_armor_2o`] = { out: gearFor(cls, 'armor', 2), mats: { copper_ore: 5, oak_log: 2 }, gold: 40, cls };
  RECIPES[`${cls}_weapon_3o`] = { out: gearFor(cls, 'weapon', 3), mats: { iron_ore: 6, silver_ore: 2, pine_log: 3 }, gold: 140, cls };
  RECIPES[`${cls}_armor_3o`] = { out: gearFor(cls, 'armor', 3), mats: { iron_ore: 6, silver_ore: 2, pine_log: 2 }, gold: 140, cls };
}
Object.assign(RECIPES, TRADE_RECIPES, CRAFT_RECIPES);
for (const R of Object.values(RECIPES)) R.at ??= 'forge';

// ---- Creatures -------------------------------------------------------------
// gear: chance to drop a gear piece of one of these tiers; rarity: weights for
// common / fine / masterwork.
export const MOBS = {
  slime: {
    name: 'Slime', sprite: 'slime', hp: 100, atk: 15, def: 4, speed: 1.8,
    range: 1.1, cooldown: 1.5, windup: 0.45, aggro: 5, leash: 12,
    xp: 40, gold: [3, 8], loot: [['potion', 0.12], ['gel', 0.65]], gear: [0, [1]], rarity: [1, 0, 0], respawn: 12,
  },
  goblin: {
    name: 'Goblin', sprite: 'goblin', hp: 150, atk: 20, def: 6, speed: 2.5,
    range: 1.3, cooldown: 1.2, windup: 0.35, aggro: 7, leash: 14,
    xp: 50, gold: [6, 16], loot: [['potion', 0.2], ['scrap', 0.7]], gear: [0.09, [1, 1, 2]], rarity: [70, 25, 5], respawn: 18,
  },
  goblin_chief: {
    name: 'Grukk the Goblin Chief', sprite: 'goblin_chief', hp: 950, atk: 30, def: 7, speed: 2.7,
    range: 1.5, cooldown: 1.4, windup: 0.5, aggro: 8, leash: 12,
    xp: 320, gold: [70, 130], mech: 'own', loot: [['potion', 1], ['trophy', 1], ['scrap', 1]], gear: [1, [2, 3]], rarity: [30, 45, 25], respawn: 90, boss: true,
  },
  // ---- the Hollow Deep (dungeon monsters don't respawn; each run is fresh)
  goblin_miner: {
    name: 'Goblin Miner', sprite: 'goblin_miner', hp: 95, atk: 14, def: 4, speed: 2.4,
    range: 1.3, cooldown: 1.2, windup: 0.35, aggro: 7, leash: 30,
    xp: 42, gold: [6, 14], loot: [['deep_iron', 0.55], ['scrap', 0.4], ['potion', 0.18]], gear: [0.07, [2, 3]], rarity: [60, 30, 10],
  },
  goblin_foreman: {
    name: 'Skarg the Foreman', sprite: 'goblin_foreman', hp: 750, atk: 24, def: 7, speed: 2.4,
    range: 1.6, cooldown: 1.5, windup: 0.55, aggro: 9, leash: 40,
    xp: 420, gold: [90, 150], loot: [['deep_iron', 1], ['deep_iron', 1], ['potion', 1], ['potion', 1]], gear: [1, [3]], rarity: [20, 50, 30], boss: true, mech: 'foreman', scale: 1.1,
  },
  spider: {
    name: 'Cave Spider', sprite: 'spider', hp: 85, atk: 15, def: 3, speed: 3.1,
    range: 1.2, cooldown: 1.0, windup: 0.3, aggro: 8, leash: 30,
    xp: 46, gold: [5, 12], loot: [['silk', 0.6], ['potion', 0.15]], gear: [0.07, [2, 3]], rarity: [60, 30, 10],
  },
  spiderling: {
    name: 'Spiderling', sprite: 'spider', hp: 36, atk: 8, def: 1, speed: 3.6,
    range: 1.0, cooldown: 0.9, windup: 0.25, aggro: 9, leash: 30,
    xp: 14, gold: [1, 3], loot: [['silk', 0.2]], gear: [0, [1]], rarity: [1, 0, 0], scale: 0.62,
  },
  spider_queen: {
    name: 'Vethra, Queen of Webs', sprite: 'spider_queen', hp: 1150, atk: 28, def: 9, speed: 2.7,
    range: 1.8, cooldown: 1.4, windup: 0.45, aggro: 10, leash: 40,
    xp: 720, gold: [120, 200], loot: [['queen_fang', 1], ['silk', 1], ['silk', 1], ['potion', 1]], gear: [1, [3]], rarity: [10, 50, 40], boss: true, mech: 'queen',
  },
  skeleton: {
    name: 'Restless Bones', sprite: 'skeleton', hp: 125, atk: 19, def: 8, speed: 2.6,
    range: 1.35, cooldown: 1.2, windup: 0.35, aggro: 8, leash: 30,
    xp: 62, gold: [8, 18], loot: [['bone', 0.6], ['potion', 0.2]], gear: [0.09, [3]], rarity: [50, 35, 15],
  },
  skeleton_archer: {
    name: 'Bone Archer', sprite: 'skeleton_archer', hp: 95, atk: 17, def: 5, speed: 2.3,
    range: 6, cooldown: 1.6, windup: 0.5, aggro: 9, leash: 30, ranged: 'arrow',
    xp: 62, gold: [8, 18], loot: [['bone', 0.5], ['potion', 0.15]], gear: [0.07, [3]], rarity: [50, 35, 15],
  },
  hollow_king: {
    name: 'The Hollow King', sprite: 'hollow_king', hp: 1900, atk: 34, def: 12, speed: 2.3,
    range: 7, cooldown: 2.2, windup: 0.6, aggro: 12, leash: 50, ranged: 'shadowbolt',
    xp: 1500, gold: [300, 450], loot: [['king_shard', 1], ['bone', 1], ['potion', 1], ['potion', 1]], gear: [1, [4]], rarity: [0, 60, 40], boss: true, mech: 'king', scale: 1.15,
  },
};

// the goblin raid on the town (some nights): they don't come back once beaten
Object.assign(MOBS, {
  raider: {
    name: 'Goblin Raider', sprite: 'goblin', hp: 150, atk: 20, def: 6, speed: 2.6,
    range: 1.3, cooldown: 1.2, windup: 0.35, aggro: 9, leash: 70,
    xp: 50, gold: [5, 14], loot: [['potion', 0.15], ['scrap', 0.5]], gear: [0.06, [1, 2]], rarity: [70, 25, 5], raid: true,
  },
  raid_captain: {
    name: 'Warboss Gnash', sprite: 'goblin_chief', hp: 1000, atk: 28, def: 7, mech: 'own', speed: 2.6,
    range: 1.5, cooldown: 1.4, windup: 0.5, aggro: 11, leash: 70,
    xp: 320, gold: [80, 140], loot: [['potion', 1], ['scrap', 1], ['scrap', 1]], gear: [1, [2, 3]], rarity: [20, 50, 30], boss: true, raid: true,
  },
});

// the four new regions, and level labels for everything
Object.assign(MOBS, QUEST_MOBS);
for (const [k, L] of Object.entries(START_LEVELS)) if (MOBS[k]) MOBS[k].lv = L;

// the Hollow Deep (levels 8-12) on the same scale as the rest of the world: health and attack
// from the level, a little under the open world's because the dungeon sends them in packs;
// its three bosses as tough as the outdoor ones. (Spiderlings are the queen's swarm: kept light.)
{
  const hpAt = (L) => 20 + 14 * Math.pow(L, 1.35), atkAt = (L) => 8 + 2.6 * L, defAt = (L) => 2 + 0.6 * L;
  const DEEP = {
    goblin_miner: [0.85, 0.85, 62], spider: [0.85, 0.85, 68], skeleton: [0.9, 0.85, 80], skeleton_archer: [0.75, 0.85, 80],
    spiderling: [0.42, 0.62, 22],
    goblin_foreman: [7, 1.1, 600], spider_queen: [7.5, 1.1, 820], hollow_king: [8, 1.12, 1500],
  };
  for (const [k, [hk, ak, xp]] of Object.entries(DEEP)) {
    const m = MOBS[k]; if (!m) continue;
    m.hp = Math.round(hpAt(m.lv) * hk); m.atk = Math.round(atkAt(m.lv) * ak); m.def = Math.round(defAt(m.lv)); m.xp = xp;
  }
}

// Tutorial Island, the starting island (shared/starter.js): weaker cousins of the mainland's monsters
Object.assign(MOBS, {
  tide_slime:   { name: 'Tide Slime', sprite: 'slime', hp: 26, atk: 4, def: 0, speed: 1.6, range: 1.1, cooldown: 1.6, windup: 0.5, aggro: 4, leash: 10,
    xp: 16, gold: [1, 3], loot: [['gel', 0.6]], gear: [0, [1]], rarity: [1, 0, 0], lv: 1, isle: true },
  young_wolf:   { name: 'Young Wolf', sprite: 'wolf', hp: 64, atk: 7, def: 1, speed: 2.7, range: 1.2, cooldown: 1.3, windup: 0.35, aggro: 6, leash: 12,
    xp: 34, gold: [2, 6], loot: [['potion', 0.15], ['rough_hide', 0.4]], gear: [0, [1]], rarity: [1, 0, 0], lv: 3, scale: 0.82, isle: true },
  sand_skitterer: { name: 'Sand Skitterer', sprite: 'spider', hp: 48, atk: 6, def: 1, speed: 2.2, range: 1.1, cooldown: 1.4, windup: 0.4, aggro: 5, leash: 10,
    xp: 24, gold: [1, 4], loot: [['potion', 0.12]], gear: [0, [1]], rarity: [1, 0, 0], lv: 2, scale: 0.6, isle: true },
  pinewood_alpha: { name: 'Greymuzzle, the Pack Alpha', sprite: 'wolf', hp: 190, atk: 10, def: 2, speed: 2.8, range: 1.3, cooldown: 1.3, windup: 0.45, aggro: 7, leash: 13,
    xp: 120, gold: [12, 24], loot: [['potion', 1], ['rough_hide', 1]], gear: [1, [1]], rarity: [60, 40, 0], lv: 4, boss: true, scale: 1.12, isle: true, mech: 'own' },
  goblin_scout: { name: 'Goblin Scout', sprite: 'goblin', hp: 70, atk: 8, def: 2, speed: 2.4, range: 1.3, cooldown: 1.25, windup: 0.35, aggro: 7, leash: 12,
    xp: 44, gold: [4, 10], loot: [['potion', 0.25], ['scrap', 0.6]], gear: [0.15, [1]], rarity: [70, 30, 0], lv: 4, isle: true },
  scout_leader: { name: 'Snikt the Scout Leader', sprite: 'goblin_chief', hp: 240, atk: 12, def: 3, speed: 2.5, range: 1.5, cooldown: 1.4, windup: 0.55, aggro: 8, leash: 14,
    xp: 180, gold: [25, 45], loot: [['potion', 1], ['scrap', 1]], gear: [1, [1]], rarity: [0, 100, 0], lv: 5, boss: true, scale: 0.9, isle: true, mech: 'snikt' },
});

// scenery the town puts up for market days and the festival (entities, not part of the map)
export const PROPS = {
  market_stall:  { sprites: ['mstall_0', 'mstall_1', 'mstall_2'], foot: [2, 2], solid: true, fade: true },
  harvest_stall: { sprites: ['harvest_stall'], foot: [2, 2], solid: true, fade: true, lights: [{ x: 0.2, y: 0.6, z: 1.9, r: 2.4, c: '255,170,90', flicker: true }] },
  bunting:       { sprites: ['bunting'], foot: [1, 1], solid: false },
  lanterns:      { sprites: ['lanterns'], foot: [1, 1], solid: false, lights: [-2, -1, 0, 1, 2].map((k) => ({ x: k * 0.95, y: 0, z: 2.5, r: 2.6, c: '255,165,80', flicker: true })) },
  pumpkins:      { sprites: ['pumpkins_0', 'pumpkins_1'], foot: [1, 1], solid: true },
  signpost:      { sprites: ['signpost'], foot: [1, 1], solid: true, lights: [{ x: 0, y: 0, z: 3.25, r: 2.5, c: '255,170,90', flicker: true }] },
  hsign:         { sprites: SIGN_KINDS.map(boardSprite), foot: [1, 1], solid: false },
};

// bank: everyone starts with 20 slots and can buy four upgrades of 20 more
export const BANK = { start: 20, step: 20, max: 100, prices: [500, 1000, 2000, 4000] };
export const INN_PRICE = 10;

export const NPCS = {
  // Tutorial Island, the starting island
  isle_captain:  { name: 'Captain Harlan', sprite: 'captain_rourke', role: 'isle' },
  isle_ferryman: { name: 'Old Wyck the Ferryman', sprite: 'ferryman_gil', role: 'isle' },
  isle_cook:     { name: 'Mira the Ship\'s Cook', sprite: 'innkeeper', role: 'isle' },
  isle_lookout:  { name: 'Brann the Lookout', sprite: 'watchman', role: 'isle' },
  isle_sailor1:  { name: 'Tobias, Wounded Deckhand', sprite: 'trader_tackle', role: 'isle' },
  isle_sailor2:  { name: 'Edda the Bosun', sprite: 'harvest_lady', role: 'isle' },
  elder:    { name: 'Elder Maren', sprite: 'elder', role: 'quest' },
  merchant: { name: 'Bram the Trader', sprite: 'merchant', role: 'shop', front: [2.0, 0], stock: ['potion', 'sword_1', 'bow_1', 'staff_1', 'armor_w1', 'armor_r1', 'armor_m1', 'sword_2', 'bow_2', 'staff_2'] },
  smith:    { name: 'Hilda the Smith', sprite: 'smith', role: 'craft' },
  pip:      { name: 'Pip', sprite: 'pip', role: 'quest', lines: [
    'Do you have a pet? I want a pet. A big one. Or a small one. Any one!',
    'Bram says if I stare at the forest long enough a fox will come. It has been three days.',
    'I named a rock Captain Whiskers. He is not very cuddly.'] },
  tobin:    { name: 'Old Tobin', sprite: 'tobin', role: 'quest', lines: [
    'Forty years I have fished this lake and never caught a thing worth keeping. Except a cold.',
    'Something in that water watches me. Or maybe that is just a reflection. Do not tell anyone I said that.'] },
  wren:     { name: 'Sister Wren', sprite: 'wren', role: 'quest', lines: [
    'The shrine has stood here longer than the village. Longer than anyone remembers why.',
    'Light a candle if you go below. The dark down there is older than ours.'] },
};
// the town: shops, inn, healer, the bank and people out for a stroll
Object.assign(NPCS, {
  armorer:    { name: 'Garrick the Armorer', sprite: 'armorer', role: 'shop', front: [2.0, 0], stock: ['sword_1', 'bow_1', 'staff_1', 'armor_w1', 'armor_r1', 'armor_m1', 'sword_2', 'bow_2', 'staff_2', 'armor_w2', 'armor_r2', 'armor_m2',
      'helm_w1', 'gloves_w1', 'boots_w1', 'helm_r1', 'gloves_r1', 'boots_r1', 'helm_m1', 'gloves_m1', 'boots_m1', 'helm_w2', 'gloves_w2', 'boots_w2', 'helm_r2', 'gloves_r2', 'boots_r2', 'helm_m2', 'gloves_m2', 'boots_m2', 'ring_1', 'amulet_1'],
    greet: "Steel, leather and good stout cloth. If it keeps you alive, I sell it.", lines: ['A dented helm is a helm that did its job.', 'Mind the edges. Some of those are sharper than they look.'] },
  apothecary: { name: 'Mira the Apothecary', sprite: 'apothecary', role: 'shop', front: [2.0, 0], stock: ['potion', 'potion_big', 'dye_crimson', 'dye_azure', 'dye_emerald'],
    greet: 'Tinctures, tonics and the odd miracle. The purple one is the strong one. Do not drink it all at once.', lines: ['Smell that? Lavender, wolfsbane and a little bit of luck.'] },
  innkeeper:  { name: 'Bess the Innkeeper', sprite: 'innkeeper', role: 'inn', front: [0, 1.9], lines: ['Hot stew, warm beds, and only one ghost. He pays his tab.'] },
  ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`clerk_${i}`, { name: ['Clerk Ambrose', 'Clerk Odette', 'Clerk Barnaby', 'Clerk Lysette', 'Clerk Fennick'][i - 1], sprite: ['clerk_a', 'clerk_b', 'clerk_c', 'clerk_b', 'clerk_a'][i - 1], role: 'bank', front: [0, 2.2] }])),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [`folk_${i}`, { name: ['Farmer Hob', 'Greta', 'Tam', 'Granny Wick', 'Farmer Ned', 'Rosalind', 'Corin', 'Old Maud', 'Pell the Cooper', 'Little Nan'][i - 1], sprite: `folk_${(i - 1) % 4}`, role: 'folk', wander: true,
    lines: [['Fine weather for turnips.', 'If you see my goat, she bites.'], ['Fresh apples from the market! Well, fresh-ish.', 'The bank has a chandelier the size of a cart, you know.'], ['I am going to be an adventurer too one day.', 'Is it true the lake has a monster in it?'], ['In my day the goblins said please.', 'Mind your step, dearie.']][(i - 1) % 4] }])),
});
// town life: animals, the carter and the night watch (no name over their heads; a click gets a little line)
Object.assign(NPCS, {
  ...Object.fromEntries([1, 2, 3].map((i) => [`cat_${i}`, { name: ['Mittens', 'Soot', 'Old Tom'][i - 1], sprite: i === 2 ? 'cat_1' : 'cat_0', role: 'critter', noName: true, speed: 1.1, sits: true,
    lines: ['The cat looks at you, then at your boots, and decides neither is worth getting up for.', 'Purrr. It lets you scratch behind one ear. Just the one.', 'The cat is busy. Cat business.'] }])),
  dog_1: { name: 'Biscuit', sprite: 'dog', role: 'critter', noName: true, speed: 2.0, sits: true,
    lines: ['Biscuit wags so hard the whole back half of him wags too.', 'Biscuit sniffs your pack with great interest. There might be sausage in there. There is not.'] },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`hen_${i}`, { name: 'Hen', sprite: `chicken_${(i - 1) % 3}`, role: 'critter', noName: true, speed: 0.8, roost: true,
    lines: ['Bawk.', 'The hen eyes you sideways and goes back to pecking.', 'Bok bok. She is not impressed.'] }])),
  carter: { name: 'Wat the Carter', sprite: 'horsecart', role: 'critter', noName: true, speed: 1.35, big: true,
    lines: ['"Mornin\'! Flour for the inn, ale for the inn, more ale for the inn."', '"Old Bramble here knows the way better than I do. I just hold the reins."'] },
  watchman: { name: 'Sergeant Holt', sprite: 'watchman', role: 'critter', speed: 1.3, light: { z: 1.05, r: 3.6, c: '255,196,120' },
    lines: ['"Twelve o\'clock and all\'s well. Well, mostly well."', '"Keep to the lit streets after dark, friend."', '"Quiet night. I like a quiet night."'] },
});
// the gate guards: four of the king's own, in gilded plate. They never fight townsfolk or
// adventurers, and cannot be hurt; anything hostile that gets inside the town, they run down.
Object.assign(NPCS, {
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`guard_${i}`, { name: ['Ser Aldric', 'Ser Brannoc', 'Ser Cedwyn', 'Ser Dorran'][i - 1], sprite: 'guard', role: 'guard', guard: true, level: 200,
    speed: 2.0, run: 5.2, atk: 900, reach: 1.5, cooldown: 0.8, windup: 0.35,
    lines: ['"Move along, friend. The gate is watched."', '"Nothing gets past us. Nothing that lives, anyway."', '"Keep your blade sheathed in town. We will handle anything that strays in."', '"Two hundred years of service, this armour. Polish it every morning."'] }])),
});
// trades: the farm stall, travelling traders on market days, the festival stall, the hearth
Object.assign(NPCS, {
  farmer:       { name: 'Farmer Oswin', sprite: 'farmer', role: 'shop', stock: ['egg', 'apple', 'flour', 'butter', 'worms', 'shovel', 'scythe', 'foraging_stick', 'bone_meal', 'seed_wheat', 'seed_carrot', 'seed_potato'],
    greet: 'Eggs, apples, flour and butter. And if you fancy growing your own: a shovel, a scythe, a foraging stick and a few seeds to start you off. Dig a hole in the fields at Hollowmere Farms (out past the inn), plant, and wait. The rarer seeds you will have to find in the wild.', lines: ['Hens lay better when someone talks to them. I talk to them a lot.'] },
  trader_spice: { name: 'Zara the Spice Trader', sprite: 'trader_spice', role: 'shop', stock: ['spice', 'glow_bait', 'butter', 'apple'], market: true,
    greet: 'Spices from three kingdoms east. A pinch turns a stew into a story.', lines: ['Taste this. No, do not ask what it is first.'] },
  trader_tackle:{ name: 'Old Finch, Tackle & Lures', sprite: 'trader_tackle', role: 'shop', stock: ['worms', 'glow_bait', 'fishing_rod', 'fine_rod'], market: true,
    greet: 'Glow bait! Moonfish cannot resist it. Neither can I, which is why I do not keep it near my lunch.', lines: ['The big ones bite when it rains. The really big ones bite when it storms. The thing in the lake bites whoever it likes.'] },
  trader_curio: { name: 'Madame Orla, Curios', sprite: 'trader_curio', role: 'shop', stock: [], market: true,
    greet: 'Odd things from odd places. Everything here has a story, and most of the stories are true.', lines: ['That one is cursed. No, the other one. Probably.'] },
  harvest_trader: { name: 'Hattie of the Harvest', sprite: 'harvest_lady', role: 'shop', stock: ['recipe_harvest_pie', 'pumpkin', 'candied_apple', 'dye_harvest'], festival: true,
    greet: 'Happy harvest! Pumpkins, candied apples, and my grandmother\'s pie recipe. She would want you to have it. Well. She would want you to pay for it.', lines: ['Dance with someone! Anyone! The cat counts.'] },
  hearth:       { name: 'The Hearth', sprite: null, role: 'station', station: 'cook' },
  mill:         { name: 'The Windmill', sprite: null, role: 'station', station: 'mill' },
  campfire:     { name: 'Camp Fire', sprite: null, role: 'station', station: 'cook' },
  workbench:    { name: 'Workbench', sprite: null, role: 'station', station: 'craft' },
  waystone:     { name: 'Waystone', sprite: null, role: 'station', station: 'waystone' },
  // the places off the road (shared/mapgen.js, shared/world_pois.js)
  poi_note:     { name: 'A Weathered Note', sprite: null, role: 'station', station: 'poi' },
  poi_shrine:   { name: 'Wayside Shrine', sprite: null, role: 'station', station: 'poi' },
  poi_cache:    { name: 'Fallen Rubble', sprite: null, role: 'station', station: 'poi' },
  // life between the towns (world_pois.js): animals that bolt when you come close, people on the roads
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`wild_fox_${i}`, { name: 'Red Fox', sprite: 'pet_fox', role: 'wild', noName: true, speed: 1.1, flee: 4.5, lines: ['The fox watches you, ready to bolt.'] }])),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`wild_deer_${i}`, { name: 'Deer', sprite: 'deer', role: 'wild', noName: true, speed: 1.0, flee: 6.5, run: true, lines: ['The deer lifts its head, ears turning toward you.'] }])),
  ...Object.fromEntries([1, 2, 3].map((i) => [`wild_stag_${i}`, { name: 'Stag', sprite: 'stag', role: 'wild', noName: true, speed: 1.0, flee: 7, run: true, lines: ['The stag watches you, proud and wary.'] }])),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`wild_horse_${i}`, { name: 'Wild Horse', sprite: 'horse', role: 'wild', noName: true, speed: 0.9, flee: 5.5, lines: ['The horse snorts and tosses its mane.'] }])),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`traveller_${i}`, { name: ['A Traveller', 'A Pilgrim', 'A Pedlar', 'A Courier'][i - 1], sprite: `folk_${(i + 2) % 4}`, role: 'traveller', speed: 1.2,
    lines: [['Long road. Good road, though. Mind the wolves past the ford.'], ['I walk to the shrines and back, every season. Have you knelt at one? You should.'], ['Needles, thread, a good knife? No? Suit yourself.'], ['Can\'t stop, letters for Thornwick! Well, I can stop a moment.']][i - 1] }])),
  road_cart:    { name: 'Supply Cart', sprite: 'horsecart', role: 'traveller', noName: true, speed: 1.3, big: true, lines: ['The carter tips his hat: "Flour and nails for Thornwick, same as every week."'] },
  fisher_hesk:  { name: 'Old Hesk the Fisherman', sprite: 'trader_tackle', role: 'folk',
    lines: ['Forty years I\'ve fished this lake. The big ones only bite at dawn, and only if you don\'t look at them.', 'Tobin? Tobin couldn\'t catch a cold. Don\'t tell him I said so.', 'Rain\'s the best time. The fish come up to see what all the fuss is.', 'There\'s something big in the deep middle. Took my best rod, line and all.'] },
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`visitor_${i}`, { name: ['A Traveller', 'A Pilgrim', 'A Pedlar', 'A Farmhand'][i - 1], sprite: `folk_${(i + 1) % 4}`, role: 'folk', wander: true, visitor: true,
    lines: [['Lovely town. Busy, though.'], ['I walked two days for this market. My feet would like a word.'], ['Have you seen the spice stall? My nose has.'], ['I came for the apples. I am staying for the pie.']][i - 1] }])),
});
Object.assign(NPCS, QUEST_NPCS);
NPCS.merchant.stock = ['potion', 'sword_1', 'bow_1', 'staff_1', 'armor_w1', 'armor_r1', 'armor_m1', 'fishing_rod', 'worms'];
NPCS.merchant.stock.push('dye_crimson', 'dye_azure', 'dye_emerald');
NPCS.wren.heal = true;
NPCS.apothecary.stock.unshift('herb_pouch');
NPCS.apothecary.brew = true;
NPCS.tobin.lines.push('Rain brings the salmon up the river. Storms bring... other things up.');
NPCS.elder.lines = ['The lake is calm today. I do not trust it when it is calm.', 'If you see a goat wandering about, it is not mine. Not anymore.'];
NPCS.merchant.lines = ['Everything must go! Except me. I am staying.'];
NPCS.smith.lines = ['Mind the sparks.', 'Deep iron sings when you strike it. Gives me shivers.'];

// ---- Pets, titles, dyes -----------------------------------------------------
export const PETS = {
  fox:    { name: 'Ember', kind: 'Fox', sprite: 'pet_fox', desc: 'A red fox who is mostly tail.' },
  owl:    { name: 'Hoot', kind: 'Owl', sprite: 'pet_owl', desc: 'A barn owl from the shrine belfry. Judges you silently.' },
  dragon: { name: 'Cinder', kind: 'Baby Dragon', sprite: 'pet_dragon', desc: 'Hatched in the Deep. Sneezes sparks.' },
};
export const TITLES = {
  slime_slayer: 'Slime Slayer', goblinbane: 'Goblinbane', friend_of_pip: 'Friend of Pip', hat_finder: 'Hat Finder',
  delver: 'Delver of the Deep', webwalker: 'Webwalker', kingslayer: 'Kingslayer', smiths_favorite: "Hilda's Favorite", keeper: 'Keeper of the Shrine',
  defender: 'Defender of Hollowmere', lake_legend: 'Lake Legend', master_angler: 'Master Angler',
};
Object.assign(TITLES, QUEST_TITLES);
// canvas filters applied to the armor layer
export const DYES = [
  { name: 'Natural', filter: null },
  { name: 'Crimson', filter: 'sepia(0.7) hue-rotate(-45deg) saturate(2.6) brightness(0.92)' },
  { name: 'Azure', filter: 'sepia(0.6) hue-rotate(165deg) saturate(2.3) brightness(1.02)' },
  { name: 'Emerald', filter: 'sepia(0.6) hue-rotate(60deg) saturate(2.1)' },
  { name: 'Gilded', filter: 'sepia(1) saturate(2.6) brightness(1.15) contrast(1.05)' },
  { name: 'Shadow', filter: 'grayscale(0.75) brightness(0.5) contrast(1.25)' },
  { name: 'Frost', filter: 'grayscale(0.9) brightness(1.45) contrast(0.95)' },
  { name: 'Harvest', filter: 'sepia(0.9) hue-rotate(-18deg) saturate(3) brightness(1.02)' },
];

// ---- The Hollow Deep --------------------------------------------------------------
export const FLOORS = [
  { name: 'The Goblin Tunnels', theme: 'cave', ambient: [64, 56, 46], mobs: ['goblin_miner', 'goblin_miner', 'goblin'], boss: 'goblin_foreman',
    decor: ['cart', 'beam', 'rockpile', 'crate', 'barrel'], traps: true, webs: false },
  { name: 'The Spider Caves', theme: 'cave', ambient: [58, 64, 72], mobs: ['spider', 'spider', 'spiderling', 'spiderling'], boss: 'spider_queen',
    decor: ['eggsac', 'bones', 'rockpile', 'web', 'web'], traps: false, webs: true },
  { name: 'The Crypt', theme: 'crypt', ambient: [40, 40, 62], mobs: ['skeleton', 'skeleton', 'skeleton_archer'], boss: 'hollow_king',
    decor: ['pillar', 'coffin', 'bones', 'candles'], traps: true, webs: false },
];

export const PROJECTILES = {
  arrow:    { speed: 15, range: 9, sprite: 'proj_arrow', dirs: true, radius: 0.45 },
  web:      { speed: 9, range: 9, sprite: 'proj_web', frames: 1, radius: 0.55, slow: 3 },
  shadowbolt: { speed: 9, range: 10, sprite: 'proj_shadow', frames: 3, radius: 0.5, light: '170,110,255' },
  bolt:     { speed: 11, range: 8, sprite: 'proj_bolt', frames: 3, radius: 0.45, light: '150,200,255' },
  fireball: { speed: 10, range: 9, sprite: 'proj_fireball', frames: 4, radius: 0.5, aoe: 1.6, light: '255,140,60' },
};

// ---- Quests ----------------------------------------------------------------
// kind: 'kill' (target, count) · 'collect' (item, count, taken at turn-in) · 'talk' (bring word to turnin)
// giver offers the quest; turnin (defaults to giver) completes it.
// Reward gear is given in the player's own class: [slot, tier, rarity].
export const QUESTS = {
  slimes: {
    title: 'Slime Season', giver: 'elder', requires: null, kind: 'kill', target: 'slime', count: 5,
    offer: 'The southern meadow is crawling with slimes again. They eat the turnips, the fences, and on one occasion a goat. Thin them out, would you? Five should teach them.',
    progress: 'Still slimes in the meadow, I see. Head south down the road.',
    done: 'Splendid! The goat would thank you, if it could. Take these. And Hilda at the forge can make use of any slime gel you find.',
    reward: { gold: 40, xp: 60, items: [['potion', 3]], title: 'slime_slayer' },
  },
  goblins: {
    title: 'Goblins in the Wood', giver: 'elder', requires: 'slimes', kind: 'kill', target: 'goblin', count: 6,
    offer: 'Worse news: goblins have been raiding carts on the eastern road. Follow it into the forest and drive them back. Six of them ought to make the rest think twice.',
    progress: 'The goblins still lurk along the eastern road.',
    done: 'You have the makings of a true warden. Take this armor, it was made for someone like you.',
    reward: { gold: 100, xp: 160, items: [['potion', 2]], gear: [['armor', 1, 1]] },
  },
  chief: {
    title: 'The Goblin Chief', giver: 'elder', requires: 'goblins', kind: 'kill', target: 'goblin_chief', count: 1,
    offer: 'Their leader, Grukk, camps at the far end of the forest road. While he lives the raids will continue. End this.',
    progress: 'Grukk still sits by his fire in the eastern camp. Be careful.',
    done: 'You did it! Hollowmere owes you everything. Take this. ...What is that in your pack? A map, from his tent? Let me see.',
    reward: { gold: 250, xp: 400, gear: [['weapon', 2, 2]], items: [['sealed_map', 1]], title: 'goblinbane' },
  },
  map: {
    title: 'The Sealed Map', giver: 'elder', turnin: 'wren', requires: 'chief', kind: 'talk',
    offer: 'This seal... I have seen it once, carved under the shrine. The goblins were not raiding for loot. They were digging. Take the map to Sister Wren. Quickly, and quietly.',
    progress: 'Sister Wren tends the shrine just northeast of the square. She will know what the seal means.',
    done: 'So it is true. Under the forest lies the Hollow Deep, where a king who would not die was sealed away long ago. And the goblins have dug right to his door.',
    reward: { xp: 120 }, take: [['sealed_map', 1]],
  },
  deep1: {
    title: 'Into the Hollow Deep', giver: 'wren', requires: 'map', kind: 'kill', target: 'goblin_foreman', count: 1,
    offer: 'The tunnel mouth is at the goblin camp. Someone drives those miners deeper every day. Go down, find who gives the orders, and stop the digging.',
    progress: 'The tunnel is at the back of the goblin camp. The foreman will be deep inside.',
    done: 'The digging has stopped. But listen... can you hear it? Something below is still knocking. From the other side.',
    reward: { gold: 200, xp: 450, title: 'delver', items: [['potion', 3]] },
  },
  deep2: {
    title: 'Silk and Shadow', giver: 'wren', requires: 'deep1', kind: 'kill', target: 'spider_queen', count: 1,
    offer: 'The second level was a nest long before the goblins came. Its queen guards the stair to the crypt. You will have to go through her.',
    progress: 'The queen waits on the second level. Bring fire, or at least courage.',
    done: 'You are covered in webs. And something green. Do not touch the altar. The crypt is open now, and the king knows you are coming.',
    reward: { gold: 300, xp: 700, title: 'webwalker', dye: 5 },
  },
  deep3: {
    title: 'The Hollow King', giver: 'wren', requires: 'deep2', kind: 'kill', target: 'hollow_king', count: 1,
    offer: 'At the bottom of the crypt sits the Hollow King, a ruler who traded his heart for a crown that never lets him rest. Put him back to sleep. For good, this time.',
    progress: 'The Hollow King waits at the bottom of the crypt.',
    done: 'It is over. The knocking has stopped. Something followed you up, though. It hatched in the dark, and it seems to have decided you are its mother.',
    reward: { gold: 600, xp: 1500, title: 'kingslayer', pet: 'dragon', dye: 4 },
  },
  pip: {
    title: 'A Friend for Pip', giver: 'pip', requires: null, kind: 'collect', item: 'gel', count: 5,
    offer: 'Bram says foxes love slime gel. That is probably a lie, but it is the only plan I have! Bring me five gel and I will make a fox trap. A nice one. With a pillow.',
    progress: 'Five slime gel! The slimes are in the meadow south of here. Please hurry, Captain Whiskers is getting jealous.',
    done: 'IT WORKED! I caught TWO foxes! This one likes you more than me anyway. Her name is Ember. Be nice to her.',
    reward: { xp: 120, pet: 'fox', title: 'friend_of_pip' },
  },
  tobin: {
    title: 'The Lucky Hat', giver: 'tobin', requires: null, kind: 'collect', item: 'tobin_hat', count: 1,
    offer: 'My lucky hat blew into the meadow and a slime ate it. Swallowed it whole! I would get it back myself, but my knees and my dignity both say no.',
    progress: 'One of those meadow slimes has my hat inside it. You will know it when you see it. It will look smug.',
    done: 'My hat! It smells of slime and regret, but it is mine. Here, take this dye. My late wife made it. She said it was the color of the lake on a good day.',
    reward: { gold: 60, xp: 140, title: 'hat_finder', dye: 2 },
  },
  rod: {
    title: 'A Rod to Fish With', giver: 'tobin', turnin: 'innkeeper', requires: null, kind: 'talk',
    offer: 'You want to fish? Ha! Good. Somebody should. My spare rod is at the Sleeping Goat. Bess borrowed it three winters ago to stir the soup pot and never gave it back. Go and ask her for it.',
    progress: 'Bess at the Sleeping Goat has my spare rod. The inn is on the east side of the square.',
    done: 'Tobin\'s rod? It\'s been in the stew pot so long it tastes of onions. Here, take it, and a tin of worms. Click the water to cast, and when the float dips, click again! Quick about it.',
    reward: { xp: 40, items: [['fishing_rod', 1], ['worms', 10]] },
  },
  harvest1: {
    title: 'A First Harvest', giver: 'farmer', requires: null, kind: 'collect', item: 'carrot', count: 4,
    offer: 'Want to try your hand at farming? Out past the inn, east of the square, is Hollowmere Farms: two big fenced fields free for anyone to work. Here: a shovel and some carrot seeds. Dig a hole in the tilled earth, click it to plant, and come back in a few minutes. Bring me four carrots and I will set you up properly.',
    progress: 'Four carrots. Dig a hole in the fields at Hollowmere Farms with the shovel, click the hole to plant a seed, and pick them when they are ripe.',
    done: 'Look at those! Proper carrots. Here is a scythe for the grain, some wheat seed and a sack of bone meal. Bone meal on a fresh planting makes a bigger crop, and now and then something truly special.',
    reward: { gold: 25, xp: 80, items: [['scythe', 1], ['seed_wheat', 5], ['bone_meal', 3]] },
    start: [['shovel', 1], ['seed_carrot', 3]],
  },
  bream: {
    title: 'Something for the Pot', giver: 'tobin', requires: 'rod', kind: 'collect', item: 'bream', count: 1,
    offer: 'Got the rod? Good. Now catch me a lake bream. They bite all day out on the lake. I have not eaten fish I caught myself in a very long time. Do not tell Bess.',
    progress: 'One lake bream. Fish the lake, not the river.',
    done: 'Look at that! A fine bream. Here, have some of my glow bait. Rare fish cannot resist it. And keep an eye on the deep water at night... I have seen something out there. Something big.',
    reward: { gold: 30, xp: 120, items: [['glow_bait', 5]] },
  },
  legend: {
    title: 'The Thing in the Lake', giver: 'tobin', requires: 'bream', kind: 'collect', item: 'lake_horror', count: 1,
    offer: 'Forty years I have watched it. A shadow under the boats. Bigger than a cart. Nobody believes me. Catch it, and they will. Night and storms, that is when it rises. You will need to be a fine angler.',
    progress: 'It rises at night, and in storms. Fish the deep water of the lake. Bring it to me.',
    done: 'By the... it is REAL! I KNEW it! Forty years! I am going to hang it over the inn door. Bess will hate it. Here, take everything I have saved. You are a legend.',
    reward: { gold: 400, xp: 800, title: 'lake_legend' },
  },
  silk: {
    title: 'Silk for the Shrine', giver: 'wren', requires: 'deep1', kind: 'collect', item: 'silk', count: 6,
    offer: 'The shrine bell rope is rotting through. Spider silk from the Deep is the only thing strong enough. Six strands should do.',
    progress: 'Six strands of spider silk, from the second level of the Deep.',
    done: 'Perfect. The owl in the belfry has been watching you since you arrived. I think he wants to go with you. He does not like many people.',
    reward: { xp: 400, pet: 'owl', title: 'keeper' },
  },
  iron: {
    title: 'Deep Iron', giver: 'smith', requires: 'deep1', kind: 'collect', item: 'deep_iron', count: 6,
    offer: 'Those miners were digging up deep iron. I have not worked it since I was an apprentice. Bring me six chunks and I will show you what it can become.',
    progress: 'Six deep iron. The goblin miners on the first level carry it.',
    done: 'Listen to it ring! Bring me a fang from the spider queen or a shard of that king\'s crown, and I can forge you something truly special.',
    reward: { gold: 150, xp: 300, title: 'smiths_favorite', dye: 1 },
  },
};
Object.assign(QUESTS, QUESTS_NEW);
// roughly in the order you meet them
export const QUEST_ORDER = ['slimes', 'pip', 'tobin', 'rod', 'goblins', 'cart_goods', 'harvest1', 'bream', 'watch_report', 'goblin_scout', 'chief', 'map',
  ...QUEST_ORDER_NEW.filter((q) => !['cart_goods', 'watch_report', 'goblin_scout'].includes(q) && !q.startsWith('trial') && !q.startsWith('bounty')).slice(0, 10),
  'deep1', 'iron', 'silk', ...QUEST_ORDER_NEW.filter((q) => q.startsWith('trial10')), 'deep2', ...QUEST_ORDER_NEW.filter((q) => !['cart_goods', 'watch_report', 'goblin_scout'].includes(q) && !q.startsWith('trial') && !q.startsWith('bounty')).slice(10),
  'deep3', 'legend', ...QUEST_ORDER_NEW.filter((q) => q.startsWith('trial20')), ...QUEST_ORDER_NEW.filter((q) => q.startsWith('bounty'))];
paceQuests(QUESTS);
// quest items that only drop while the quest is active
export const QUEST_DROPS = { slime: [['tobin_hat', 0.3, 'tobin']] };
for (const [k, v] of Object.entries(QUEST_DROPS_NEW)) QUEST_DROPS[k] = [...(QUEST_DROPS[k] || []), ...v];

export function xpToNext(level) { return xpCurve(level); }

// ---- mana: every hero has a pool that refills; skills cost more the longer their cooldown
export const MANA = { warrior: [90, 6], ranger: [110, 8], mage: [140, 12] };
export function maxManaFor(cls, level) { const [b, g] = MANA[cls] || MANA.warrior; return Math.round(b + (level - 1) * g); }
export function skillCost(name) { const S = SKILLS[name]; return S ? Math.max(10, Math.min(60, Math.round(8 + S.cd * 2))) : 0; }

// ---- World clock & weather ------------------------------------------------------
export const DAY_LENGTH_SEC = 20 * 60;     // one full day + night
// time-of-day 0..1: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk
export const DAWN = 0.15, DUSK = 0.85;   // 14 minutes of daylight, 6 of night

// crafting materials on the monsters that carry them (shared/crafting.js)
for (const [mob, list] of Object.entries(CRAFT_DROPS)) if (MOBS[mob]) MOBS[mob].loot = [...MOBS[mob].loot, ...list];

// ---------------------------------------------------------------- prices
// Shops charge well above an item's base value; they buy back at a fraction. Gear and big
// purchases cost the most, so armour upgrades take some saving up (quests alone won't cover it).
// shop prices: gear costs several times what it sells back for, so it takes some hunting to afford
const BUY_MULT = { weapon: 3.5, armor: 3.5, offhand: 3.5, mount: 2.5, consumable: 2, potion: 2, food: 1.8, material: 2.5 };
export function buyPrice(item, r = 0) {
  const d = ITEMS[item]; if (!d) return 0;
  const k = BUY_MULT[d.type] ?? (d.slot ? 3.5 : 2.5);
  return Math.max(1, Math.round(d.price * k * (r ? RARITY[r].mult : 1)));
}
export function sellPrice(it) {
  const d = ITEMS[it.item]; if (!d) return 0;
  return Math.max(1, Math.floor(d.price * 0.35 * RARITY[it.r || 0].mult));
}
// who will buy from your pack: anyone with a stall, a trade or a counter (not guards or passers-by)
export function npcBuys(kind) { const n = NPCS[kind]; return !!n && !n.guard && !!n.role && !['guard', 'critter', 'station'].includes(n.role); }
// quests pay less gold than they used to; the rest comes from hunting and selling
export const QUEST_GOLD = 0.45;
// experience for a kill scales with the monster's level against yours (grey monsters give little)
export function xpScale(mobLv, pLv) {
  if (!mobLv) return 1;
  const d = mobLv - pLv;
  if (d <= -5) return 0.1;                 // grey: barely worth it, go somewhere harder
  if (d < 0) return 1 + d * 0.18;
  return Math.min(1.4, 1 + d * 0.08);
}
