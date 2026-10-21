// The five newer gear slots: helm, gloves and boots (class-made, tiers 1-4, drawn on the
// character), ring and amulet (anyone may wear them, tiers 1-4). content.js merges these into ITEMS.
//
// Base stats follow the armour of the same tier; Fine and Masterwork pieces also roll bonus
// stats (shared/stats.js GEAR_BONUS) when they are made.

export const GEAR_SLOTS = ['weapon', 'armor', 'helm', 'gloves', 'boots', 'ring', 'amulet'];
export const VISIBLE_SLOTS = ['helm', 'gloves', 'boots'];       // drawn on the hero (layers h1-4, g1-4, b1-4)
export const SLOT_NAMES = { weapon: 'Weapon', armor: 'Armour', helm: 'Helm', gloves: 'Gloves', boots: 'Boots', ring: 'Ring', amulet: 'Amulet' };

const ARMOR_DEF = { warrior: [4, 9, 16, 24], ranger: [3, 7, 12, 18], mage: [2, 6, 11, 16] };
const PRICE = [30, 100, 260, 560];
const NAMES = {
  warrior: {
    helm:   [['Iron Cap', 'A dented iron skullcap with a leather lining.'], ['Steel Helm', 'A rounded steel helm with a nose guard.'], ['Crested Greathelm', 'Full-faced steel crowned with a red crest.'], ['Hollowsteel Visor', 'Black steel, gold-trimmed, with a narrow eye slit.']],
    gloves: [['Leather Gloves', 'Thick hide with a padded palm.'], ['Mail Gauntlets', 'Riveted rings over leather.'], ['Plate Gauntlets', 'Articulated steel plates to the wrist.'], ['Hollowsteel Grips', 'Black steel claws with gold knuckles.']],
    boots:  [['Leather Boots', 'Hobnailed and broken in.'], ['Chain Sabatons', 'Mail over the shin, iron toes.'], ['Plate Sabatons', 'Polished plate from knee to toe.'], ['Hollowsteel Greaves', 'Black plate that rings on stone.']],
  },
  ranger: {
    helm:   [['Leather Cap', 'A snug cap of soft leather.'], ["Hunter's Hood", 'A deep green hood that hides your face.'], ['Shadow Cowl', 'A dark cowl with a mask of fine silk.'], ['Nightstalker Mask', 'A purple hood and a mask that drinks the light.']],
    gloves: [["Archer's Bracers", 'Leather bracers that spare your wrist from the string.'], ["Fletcher's Gloves", 'Three-fingered gloves, waxed and worn.'], ['Silkstring Gloves', 'Spider silk sewn into supple leather.'], ['Nightstalker Grips', 'Violet leather with silver claws.']],
    boots:  [['Soft Boots', 'Quiet as a cat on the forest floor.'], ['Treader Boots', 'Laced to the knee for long hunts.'], ['Shadowstep Boots', 'Dark leather, never a creak.'], ['Nightstalker Boots', 'Silk-lined, silent, and swift.']],
  },
  mage: {
    helm:   [['Wool Hood', 'Blue wool, warm and slightly singed.'], ["Adept's Hat", 'A pointed hat with a silver band.'], ['Starweave Circlet', 'A silver circlet set with a glowing stone.'], ['Crown of the Deep', 'Gold spines around a violet shard that whispers.']],
    gloves: [['Linen Wraps', 'Wrapped hands steady the casting.'], ['Silk Gloves', 'Blue silk with a gold hem.'], ['Runed Gloves', 'Runes along the fingers glow when you cast.'], ['Voidtouched Gloves', 'Black silk; the fingertips spark.']],
    boots:  [['Cloth Shoes', 'Soft shoes for long hours in the library.'], ["Adept's Slippers", 'Embroidered, upturned toes.'], ['Starwalker Boots', 'Silver stars stitched up the side.'], ['Deepwalker Boots', 'Gold-tipped boots that leave no footprints.']],
  },
};
const RINGS = [['Copper Band', 'A plain copper ring.'], ['Silver Ring', 'Bright silver, a little too big.'], ['Moonstone Ring', 'The stone glows faintly at night.'], ['Crown-Shard Ring', 'A sliver of the Hollow King\'s crown, set in gold.']];
const AMULETS = [['Bone Charm', 'Knucklebones on a thong. For luck.'], ['Silver Pendant', 'A silver leaf on a fine chain.'], ['Sunstone Amulet', 'Warm to the touch, even in winter.'], ['Heart of the Deep', 'A violet stone that beats, slowly.']];

export const GEAR_ITEMS = {};
for (const [cls, slots] of Object.entries(NAMES)) {
  const c = cls[0];
  for (const [slot, list] of Object.entries(slots)) list.forEach(([name, desc], i) => {
    const t = i + 1, ad = ARMOR_DEF[cls][i];
    // kept modest: defense comes straight off every hit, so a little goes a long way
    const st = slot === 'helm' ? { def: Math.max(1, Math.round(ad * 0.15)), hp: [5, 10, 16, 24][i] }
      : slot === 'gloves' ? { atk: [1, 2, 3, 5][i] }
      : { def: Math.max(1, Math.round(ad * 0.1)), hp: [3, 6, 10, 14][i] };
    GEAR_ITEMS[`${slot}_${c}${t}`] = { name, type: slot, cls, tier: t, ...st, price: PRICE[i], icon: `item_${slot}_${c}${t}`, desc };
  });
}
RINGS.forEach(([name, desc], i) => { GEAR_ITEMS[`ring_${i + 1}`] = { name, type: 'ring', tier: i + 1, atk: [1, 2, 4, 6][i], price: PRICE[i] + 20, icon: `item_ring_${i + 1}`, desc }; });
AMULETS.forEach(([name, desc], i) => { GEAR_ITEMS[`amulet_${i + 1}`] = { name, type: 'amulet', tier: i + 1, hp: [8, 16, 28, 40][i], price: PRICE[i] + 30, icon: `item_amulet_${i + 1}`, desc }; });

// what a random gear drop is: weapons and armour as before, the new pieces just as often
export const DROP_SLOTS = [['weapon', 20], ['armor', 20], ['helm', 15], ['gloves', 15], ['boots', 15], ['ring', 7.5], ['amulet', 7.5]];

// The picture layers that make up a hero, back to front, for gear g = [weapon, armour, dye, helm,
// gloves, boots] tiers. Each armour tier is baked as its body (aN) plus its own head, hand and foot
// pieces (aNh, aNg, aNb); a helm, gloves or boots you wear take the place of the armour's own piece.
// -> [[layer, dyed]]
export function gearLayers(g = [], { weapon = true } = {}) {
  const [w = 0, a = 0, , h = 0, gl = 0, b = 0] = g, out = [['body', false]];
  if (b) out.push(['b' + b, false]); else if (a) out.push([`a${a}b`, true]);
  if (a) out.push(['a' + a, true]);
  if (gl) out.push(['g' + gl, false]); else if (a) out.push([`a${a}g`, true]);
  if (h) out.push(['h' + h, false]); else if (a) out.push([`a${a}h`, true]);
  if (w && weapon) out.push(['w' + w, false]);
  return out;
}
