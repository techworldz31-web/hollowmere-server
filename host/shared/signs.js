// Hanging signs: a painted picture board for every shop, trainer, stall and useful spot, so you
// can tell at a glance what is sold or done there. Shared by the map generator (where they
// go), the sprite baker (how each one hangs) and the client (the name you see on hover).
//
// style: 'e' hangs from an iron bracket on an east-facing wall, 's' from a south-facing wall,
// 'p' from the arm of a wooden post (a post sign stands on its own tile).
export const SIGN_BOARDS = {
  general: { style: 'e', title: 'General Store', sub: 'Bram the Trader · supplies, gear and bags' },
  armor:   { style: 'e', title: 'The Armory', sub: 'Garrick the Armorer · weapons and armour' },
  apoth:   { style: 'e', title: 'Apothecary', sub: 'Mira the Apothecary · potions and dyes' },
  inn:     { style: 's', title: 'The Sleeping Goat', sub: 'Bess the Innkeeper · food, drink and rest' },
  chapel:  { style: 's', title: 'Chapel', sub: 'Sister Wren · healing and quests' },
  bank:    { style: 's', title: 'Bank of Hollowmere', sub: 'Your bank vault, safe with the clerks' },
  smith:   { style: 'p', title: 'Smithy', sub: 'Hilda the Smith · smithing and crafting' },
  farmer:  { style: 'p', title: 'Produce Stall', sub: 'Farmer Oswin · seeds, food and farm tools' },
  warrior: { style: 'p', title: 'Warrior Trainer', sub: 'Weapon-Master Torvald' },
  ranger:  { style: 'p', title: 'Ranger Trainer', sub: 'Huntmaster Sylvi' },
  mage:    { style: 'p', title: 'Mage Trainer', sub: 'Archmage Corvin' },
  fish:    { style: 'p', title: 'Fishing Spot', sub: 'Old Tobin · fishing and quests' },
  stable:  { style: 'p', title: 'Stables', sub: 'Rest your horse here' },
  cook:    { style: 'p', title: 'Camp Fire', sub: 'Cook your catch and your meals here' },
  saw:     { style: 'p', title: 'Workbench', sub: 'Craft here' },
  // market days and the harvest festival
  spice:   { style: 'p', title: 'Spice Stall', sub: 'Zara the Spice Trader (market days)' },
  tackle:  { style: 'p', title: 'Tackle & Lures', sub: 'Old Finch (market days)' },
  curio:   { style: 'p', title: 'Curios', sub: 'Madame Orla (market days)' },
  harvest: { style: 'p', title: 'Harvest Stall', sub: 'Hattie of the Harvest (festival)' },
};
export const SIGN_KINDS = Object.keys(SIGN_BOARDS);
export const boardSprite = (k) => `hsign_${k}`;

// the outposts' painted name boards
export const CAMP_BOARDS = {
  thornwick: { title: 'Thornwick Lodge', sub: 'Whisperwood · levels 6-10' },
  ridgewatch: { title: 'Ridgewatch Outpost', sub: 'Westreach Highlands · levels 11-14' },
  hermitage: { title: 'The Hermitage', sub: 'Frostridge · levels 14-17' },
  fenwatch: { title: 'Fenwatch', sub: 'The Blackmarsh · levels 17-20' },
};
export const CAMP_KINDS = Object.keys(CAMP_BOARDS);

// crossroads signposts. Each arm points along a map direction (n = up-right on screen,
// e = down-right, s = down-left, w = up-left) and names where that road goes.
export const CROSSROADS = {
  north: { title: 'Crossroads', arms: [['w', 'The Lake', 'Westreach Highlands 11-14'], ['e', 'Goblin Camp 4-6', 'Frostridge 14-17'], ['s', 'Hollowmere', 'town']] },
  south: { title: 'Crossroads', arms: [['w', 'Willow Ford', 'Whisperwood 6-10'], ['s', 'The Meadow', 'slimes, level 1'], ['n', 'Hollowmere', 'town']] },
  east:  { title: 'Crossroads', arms: [['e', 'The Mill', 'Fenwatch · Blackmarsh 17-20'], ['w', 'Hollowmere', 'town']] },
};
export const CROSS_KINDS = Object.keys(CROSSROADS);
const DIR_WORD = { n: 'North', e: 'East', s: 'South', w: 'West' };
export const crossTip = (k) => ({ title: CROSSROADS[k].title, sub: CROSSROADS[k].arms.map(([d, a, b]) => `${DIR_WORD[d]}: ${a}${b && b !== 'town' ? ` (${b})` : ''}`).join(' · ') });
