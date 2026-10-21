// The guided start on Tutorial Island, levels 1 to 5. Every new hero gets their own copy of the
// island (an instance, like a Hollow Deep floor): nobody else can see them, or be seen, until
// they take the ferry to Hollowmere. Finishing the guide, or skipping it at any point, brings
// them to the town square in the shared world.
// Installed onto World's prototype (see the bottom of world.js).
//
// State per hero: p.tut = { s: step, done }. The client shows the current step (title, what to
// do, a counter, and an arrow at the place to go) from snapshot.self.tut, and plays the opening
// scene at step 0.
import { MOBS, xpToNext, gearFor } from './content.js';
import { dirFromVector } from './constants.js';
import { TICK_RATE } from './constants.js';
import { S2C } from './protocol.js';
import { generateStarter } from './starter.js';

const T = (s) => Math.round(s * TICK_RATE);
// Each step: what the panel says, and how it ends: `npc` (talk to them), `goal` [monster, how
// many, label] (with `area` for the arrow when none are in sight, `lvl` reached on finishing and
// `done` said then), or its own rule in tutorialTick. About ten minutes from beach to ferry.
export const TUT_STEPS = [
  { id: 'intro', title: 'Tutorial Island', text: '' },
  { id: 'wake', title: 'Find the Survivors', text: 'You washed up by the wreck. Smoke is rising inland: the survivors have made camp. Walk there: click on the ground, or use W A S D.', npc: 'isle_captain' },
  { id: 'talk', title: 'Speak with the Captain', text: 'Click on Captain Harlan (or stand next to him and press E).', npc: 'isle_captain' },
  { id: 'fight', title: 'Your First Fight', text: 'Slimes are fouling the tide pools on the east shore. Click one to attack it. Keep an eye on your health in the top left.', goal: ['tide_slime', 6, 'Tide slimes'], area: 'pools', lvl: 2, done: 'Well fought! Now pick up what they dropped.' },
  { id: 'loot', title: 'Grab the Loot', text: 'Monsters drop gold and items. Walk over them to pick them up, or press V to loot everything nearby.' },
  { id: 'gear', title: 'Salvaged Armour', text: 'The captain sent you armour from the wreck. Open your bags (I) and click it to put it on.' },
  { id: 'skill', title: 'Learn a Skill', text: 'You levelled up and earned a skill point. Press K to open your skills and click Learn on one. Then drag it onto your action bar wherever you like.' },
  { id: 'cook', title: 'The Ship\'s Cook', text: 'Mira the cook is by the camp fire. She has something for you: talk to her.', npc: 'isle_cook' },
  { id: 'crabs', title: 'Skitterer Cove', text: 'Sand skitterers are picking through the ship\'s stores on the south beach. Drive them off, and use your new skill. If you get hurt, drink a potion (its button is on your action bar).', goal: ['sand_skitterer', 5, 'Sand skitterers'], area: 'cove', lvl: 3, done: 'The stores are safe. Level 3! You have another skill point to spend (K).' },
  { id: 'wolves', title: 'The Pinewood', text: 'Young wolves prowl the pinewood to the west, and they hunt in packs. Pull them one at a time and keep your skills rolling.', goal: ['young_wolf', 6, 'Young wolves'], area: 'woods', done: 'The pack is thinning. Their alpha is still out there.' },
  { id: 'alpha', title: 'Greymuzzle', text: 'The pack\'s alpha, Greymuzzle, dens at the far side of the pinewood. Bosses hit hard: watch its wind-up and step away, and drink a potion if you need one.', goal: ['pinewood_alpha', 1, 'Greymuzzle defeated'], area: 'den', lvl: 4, done: 'Greymuzzle is down! Level 4. The way to the north bluff is open.' },
  { id: 'lookout', title: 'The Lookout', text: 'Brann the lookout is watching the goblins from the path to the north bluff. Find out what he has seen.', npc: 'isle_lookout' },
  { id: 'scouts', title: 'Goblin Scouts', text: 'Goblin scouts are camped on the north bluff. Thin out their numbers before you face their leader.', goal: ['goblin_scout', 5, 'Goblin scouts'], area: 'goblins', done: 'The scouts are scattered. Snikt is all that\'s left.' },
  { id: 'snikt', title: 'Snikt the Scout Leader', text: 'Defeat Snikt, the leader of the goblin scouts. He is tougher than anything on the isle: use everything you have learned.', goal: ['scout_leader', 1, 'Snikt defeated'], area: 'goblins', done: 'Snikt is beaten! Report back to Captain Harlan.' },
  { id: 'report', title: 'Report to the Captain', text: 'Go back to Captain Harlan at the camp and tell him the scouts are gone.', npc: 'isle_captain' },
  { id: 'ferry', title: 'The Ferry to Hollowmere', text: 'Captain Harlan left you a chest on the jetty to the south-west: open it (click it). Then board the ferry, or talk to Old Wyck, to sail for Hollowmere.' },
];
const LAST = TUT_STEPS.length - 1;
const STEP = Object.fromEntries(TUT_STEPS.map((t, i) => [t.id, i]));
const sid = (p) => TUT_STEPS[p.tut?.s]?.id;

export const tutorialMethods = {
  // a brand-new hero (and a client that can show it) starts on the island
  tutorialStart(p) {
    if (p.tut?.done) return;
    const fresh = p.level === 1 && !Object.keys(p.quests).length && p.xp < 50;
    if (!p.tut) {
      if (!fresh || !p.tutClient) {
        p.tut = { s: 99, done: true };
        // a brand-new hero that can't play the island (bots) starts as if they had: level 5, armour on
        if (fresh) { this.levelTo(p, 5); const a = gearFor(p.cls, 'armor', 1); if (!p.equip.armor && a) { p.equip.armor = { item: a, r: 1 }; this.recalcStats(p); p.hp = p.maxHp; } p.selfDirty = true; }
        return;
      }
      p.tut = { s: 0 };
    }
    if (!p.tutClient) return;
    this.enterStarter(p);
    p.selfDirty = true;
  },

  // admin testing: this hero becomes a brand-new level 1 again and wakes on a fresh island
  resetHero(p) {
    this.tradeCancel?.(this.tradeOf?.(p), `${p.name} was reset, so the trade was cancelled.`);
    this.dismissPet?.(p);
    const f = this.spawnPlayer(null, p.name, p.cls, null); this.ents.delete(f.id);
    const keep = new Set(['id', 'clientId', 'name', 'cls', 'kind', 'x', 'y', 'zone', 'dir', 'friends', 'admin', 'tutClient', 'party', 'guild']);
    for (const k of Object.keys(f)) if (!keep.has(k)) p[k] = f[k];
    p.tut = { s: 0 }; p.anim = 'idle'; p.animLock = 0; p.god = false;
    this.recalcStats(p); p.hp = p.maxHp; if (p.maxMp != null) p.mp = p.maxMp;
    const old = p.zone;
    this.enterStarter(p);
    if (old !== p.zone) this.cleanupZone(old);
    p.selfDirty = true;
  },

  // ---------------------------------------------------------------- the island instance
  enterStarter(p) {
    const id = `isle${this.nextZone++}`, seed = 1 + Math.floor(this.rng() * 1e6);
    const map = generateStarter(seed), A = map.starter.areas;
    const z = { id, kind: 'starter', map, seed, owner: p.id };
    this.zones.set(id, z);
    this.spawnNpc('isle_captain', A.captain.x, A.captain.y, 1, { zone: id });
    this.spawnNpc('isle_ferryman', A.ferryman.x, A.ferryman.y, 3, { zone: id });
    this.spawnNpc('isle_cook', A.cook.x, A.cook.y, 2, { zone: id });
    this.spawnNpc('isle_lookout', A.lookout.x, A.lookout.y, 6, { zone: id });
    this.spawnNpc('isle_sailor1', A.sailor1.x, A.sailor1.y, 1, { zone: id });
    this.spawnNpc('isle_sailor2', A.sailor2.x, A.sailor2.y, 5, { zone: id });
    this.newEnt({ type: 'portal', kind: 'ferry', x: A.ferry.x, y: A.ferry.y, zone: id, name: 'Ferry to Hollowmere' });
    // the island's monsters are this hero's alone, and don't come back once beaten
    for (const group of Object.values(map.starter.mobs)) for (const s of group) {
      const m = this.spawnMob(s.kind, s.x, s.y, id, { tutFor: p.id });
      if (MOBS[s.kind].boss) m.boss = true;
    }
    // back where they were in the guide (a hero who logged out half way comes back at the camp)
    const at = p.tut.s <= 1 ? A.spawn : { x: A.camp.x, y: A.camp.y + 2 };
    this.movePlayer(p, id, at.x, at.y);
    p.tutKills = 0;
  },
  isleZone(p) { const z = this.zones.get(p.zone); return z?.kind === 'starter' ? z : null; },
  isleNpc(p, kind) { for (const e of this.ents.values()) if (e.type === 'npc' && e.kind === kind && e.zone === p.zone) return e; return null; },
  // off the island, into the shared world: the town square
  leaveIsle(p, how) {
    const was = this.isleZone(p);
    const spot = this.map.playerSpawn;
    if (was) this.movePlayer(p, 'world', spot.x, spot.y);
    if (how === 'ferry') this.privateEvent(p, { e: 'sys', text: 'The ferry bumps against Hollowmere\'s jetty. Old Wyck points you toward the town square.' });
    this.broadcastEvent({ e: 'sys', text: `${p.name} the ${p.cls[0].toUpperCase() + p.cls.slice(1)} arrived in Hollowmere.` });
    this.privateEvent(p, { e: 'arrived', how });
  },

  // ---------------------------------------------------------------- talking on the island
  isleTalk(p, n) {
    const say = (text, options) => this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: n.name, text, options });
    const fin = !p.tut || p.tut.done, s = fin ? 'done' : sid(p), past = (id) => fin || p.tut.s > STEP[id];
    const bye = (label = 'Understood') => [{ id: 'bye', label }];
    n.dir = Math.round(((Math.atan2(p.y - n.y, p.x - n.x) / (Math.PI / 4)) + 8)) % 8; n.facingUntil = this.tick + T(8);
    if (n.kind === 'isle_ferryman') {
      if (!fin && s !== 'ferry') return say('Can\'t take you across yet, friend. The captain wants a word with everyone who came off that ship. And mind the goblins on the bluff.', bye('I\'ll see the captain'));
      const chest = this.isleChest(p);
      return say(`Hollowmere's just across the water. Town square, market, the Sleeping Goat.${chest && !chest.opened ? ' And don\'t forget the captain\'s chest there on the jetty: that\'s yours.' : ''} Climb aboard when you're ready.`, [{ id: 'board', label: 'Take me to Hollowmere' }, { id: 'bye', label: 'Not yet' }]);
    }
    if (n.kind === 'isle_sailor1' || n.kind === 'isle_sailor2') return this.isleSideTalk(p, n, say, bye);
    if (n.kind === 'isle_cook') {
      if (s === 'cook') {
        this.tutAdvance(p, STEP.crabs);
        return say('So you\'re the one who\'s been clearing the shore! Here: healing draughts, brewed from what I saved from the galley. Drink one when a fight turns against you; your potion button is on the action bar.\n\nAnd while you\'re at it: sand skitterers are picking through our stores on the south beach. Chase them off before they eat everything we have left.', bye('I\'ll chase them off'));
      }
      if (!past('cook')) return say('Mind the fire, love. Go and see the captain first, he\'s been asking for everyone.', bye('All right'));
      return say(s === 'crabs' ? 'The skitterers are on the south beach, by the stores. Don\'t let them pinch you!' : 'You look half starved. Hollowmere\'s inn, the Sleeping Goat, does a fine stew. Tell them Mira sent you.', bye());
    }
    if (n.kind === 'isle_lookout') {
      if (s === 'lookout') {
        this.tutAdvance(p, STEP.scouts);
        return say('Keep your head down! I\'ve been counting them since dawn: half a dozen scouts round a fire up on the bluff, and Snikt, their leader, barking orders.\n\nScouts first. If Snikt brings his whole crew down on you at once, you won\'t walk away. Pull them one or two at a time.', bye('One or two at a time'));
      }
      if (!past('lookout')) return say('Shh! Goblins on the bluff. Come back when you\'ve dealt with the wolves; I can\'t watch two fronts at once.', bye('I\'ll be back'));
      return say(s === 'scouts' || s === 'snikt' ? 'Snikt\'s the big one by the tents. Watch for his wind-up.' : 'Not a goblin in sight. Never thought I\'d see the day.', bye());
    }
    // Captain Harlan
    if (s === 'wake' || s === 'talk' || s === 'intro') {
      this.tutAdvance(p, STEP.fight, 'Captain Harlan: "Slimes in the tide pools, east shore. Clear them before they get into the stores."');
      return say('You\'re alive! Good. Half the crew made it ashore, and the goblins that rammed us are watching from the north bluff.\n\nFirst things first: slimes are fouling the tide pools on the east shore. Clear them out, and we\'ll find you something better than wet rags.\n\nAnd if you have a moment, Tobias and Edda by the fire could use a hand.', bye('I\'ll deal with them'));
    }
    if (s === 'report') {
      this.tutAdvance(p, STEP.ferry);
      return say('Snikt\'s gone? Ha! That\'ll teach them to hunt shipwrecks.\n\nYou\'ve earned your passage. Old Wyck the ferryman is at the jetty on the south-west shore; he\'ll row you to Hollowmere. Tell Elder Maren that Harlan sends his regards. And take this, for the road.', bye('Thank you, Captain'));
    }
    if (s === 'ferry') return say('The jetty is down the path to the south-west. Hollowmere has work for someone like you.', bye('On my way'));
    if (s === 'done') return say('The ferry can take you across whenever you like. The isle is quiet now, thanks to you.', bye('Farewell'));
    const hints = { fight: 'The tide pools are east of here. Slimes are slow: hit them and step back.', loot: 'Pick up what they dropped: walk over it, or press V.', gear: 'Put that armour on: open your bags with I and click it.', skill: 'You\'ve earned a skill point. Press K and learn a skill.', cook: 'Mira wants a word. She\'s by the fire.', crabs: 'Skitterers on the south beach. Mira will be grateful.', wolves: 'The pinewood is west. Wolves hunt in packs: fight them one at a time.', alpha: 'Greymuzzle dens at the far side of the pinewood. Careful.', lookout: 'Brann is on the path to the north bluff. He\'s been watching the goblins.', scouts: 'Clear the scouts on the bluff first.', snikt: 'Snikt is the big one by the tents.' };
    return say(hints[s] || 'Stay sharp.', bye());
  },
  isleDialog(p, choice) {
    if (choice === 'board') this.isleBoard(p);
    if (choice === 'boot_yes' || choice === 'wood_yes') this.isleSideStart(p, choice === 'boot_yes' ? 'boot' : 'wood');
  },

  // ---------------------------------------------------------------- the survivors' small favours
  // Tobias lost his lucky boot to the tide (it's washed up somewhere on the sand); Edda wants
  // three pieces of driftwood for the fire. Both optional, a minute each, a small reward.
  isleSideTalk(p, n, say, bye) {
    const S = p.isleSide || (p.isleSide = {}), boot = n.kind === 'isle_sailor1', k = boot ? 'boot' : 'wood';
    const have = boot ? this.countItem(p, 'tobias_boot') : this.countItem(p, 'driftwood');
    if (!S[k] && have) S[k] = 'on';            // came back after logging out with it already found
    if (S[k] === 'done') {
      const L = boot ? ['Lucky boot back on, lucky Tobias. Thanks again, friend.', 'Goblins rammed us in the storm. Never seen longboats move like that.', 'Buy me an ale at the Sleeping Goat in Hollowmere, if I ever get there.']
        : ['That fire will see us through the night. You have my thanks.', 'Keep your blade dry and your boots drier. Salt rots everything.', 'If Snikt\'s lot come down off that bluff again, we\'re done. Don\'t let them.'];
      return say(L[(this.tick / TICK_RATE / 6 | 0) % L.length], bye('Take care'));
    }
    if (S[k] === 'on' && have >= (boot ? 1 : 3)) {
      this.removeItem(p, boot ? 'tobias_boot' : 'driftwood', boot ? 1 : 3);
      S[k] = 'done';
      const gold = boot ? 25 : 20;
      p.gold += gold; this.grantXp(p, boot ? 70 : 60);
      if (boot) this.addItem(p, 'potion', 2); else this.addItem(p, 'bandage', 3);
      p.selfDirty = true;
      this.privateEvent(p, { e: 'loot', text: boot ? `Tobias gave you ${gold} gold and 2 healing potions.` : `Edda gave you ${gold} gold and 3 bandages.`, r: 0 });
      this.privateEvent(p, { e: 'sidedone', text: boot ? 'Favour done: Tobias\'s Lucky Boot' : 'Favour done: Wood for the Fire' });
      return say(boot ? 'My boot! My lucky boot! Ha, I knew the sea would give it back. Here, take these: I won\'t be needing potions if I\'ve got my luck back.'
        : 'Good dry wood, that. The fire will last the night now. Here, bandages from the ship\'s chest: tie one on when you\'re hurt and it heals you slowly.', bye('Glad to help'));
    }
    if (S[k] === 'on') return say(boot ? 'Still no sign of it? It\'ll be on the sand somewhere along the shore, where the tide left it. It glints, the buckle does.'
      : `${have ? `${have} so far. ` : ''}Three pieces of driftwood, friend. The sea throws it up all along the beaches.`, bye('I\'ll keep looking'));
    return say(boot ? 'Ugh... my leg\'s still ringing from the rocks. Worse, I lost my boot in the surf. My LUCKY boot. My grandfather wore that boot at the Battle of the Reeds.\n\nIf you see it on the sand anywhere, would you bring it back?'
      : 'Twelve of us went into the water. Nine came out. You were one of the lucky ones.\n\nThis fire won\'t last the night. Bring me three pieces of driftwood from the beaches, and I\'ll make it worth your while.',
    [{ id: boot ? 'boot_yes' : 'wood_yes', label: boot ? 'I\'ll look for your boot' : 'I\'ll gather driftwood' }, { id: 'bye', label: 'Not now' }]);
  },
  isleSideStart(p, k) {
    const z = this.isleZone(p); if (!z) return;
    const S = p.isleSide || (p.isleSide = {}); if (S[k]) return;
    S[k] = 'on';
    // what to find lies on the sand at the water's edge, glinting
    const m = z.map, spots = [];
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (m.terrain[y * m.w + x] !== 1 || m.solid[y * m.w + x]) continue;                  // sand
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.terrain[(y + dy) * m.w + x + dx] === 0);
      if (wet) spots.push({ x: x + 0.5, y: y + 0.5 });
    }
    const A = m.starter.areas, far = spots.filter((q) => Math.hypot(q.x - A.spawn.x, q.y - A.spawn.y) > 6);
    const pick = (list, n) => { const out = []; for (let t = 0; t < 300 && out.length < n && list.length; t++) { const q = list[Math.floor(this.rng() * list.length)]; if (out.every((o) => Math.hypot(o.x - q.x, o.y - q.y) > 9)) out.push(q); } return out; };
    for (const q of pick(far.length ? far : spots, k === 'boot' ? 1 : 3))
      this.newEnt({ type: 'loot', kind: k === 'boot' ? 'tobias_boot' : 'driftwood', qty: 1, r: 0, x: q.x, y: q.y, zone: z.id, owner: null, ownerUntil: 0, expires: Infinity, glint: 1 });
    this.privateEvent(p, { e: 'sys', text: k === 'boot' ? 'Favour: find Tobias\'s lucky boot on the sand at the water\'s edge (look for the glint).' : 'Favour: gather 3 pieces of driftwood from the beaches for Edda.' });
  },
  // the first time a hero falls on the island, Mira is the face they see
  isleFirstFall(p) {
    const n = this.isleNpc(p, 'isle_cook'); if (!n || !this.ents.has(p.id)) return;
    this.teleport(p, n.x + 0.9, n.y + 0.9);          // you come round with her kneeling beside you
    n.dir = 3; n.facingUntil = this.tick + T(8);
    this.later(0.6, () => this.ents.has(p.id) && this.send(p.clientId, { t: S2C.DIALOG, npc: n.id, name: n.name, text: 'Easy now, easy... you took a bad hit out there. The lads carried you back.\n\nListen to an old ship\'s cook: drink a healing potion BEFORE you\'re on your knees (your potion button, or press 1). And fight one at a time: hit the nearest from a distance and let it come to you, don\'t wade into the middle of a pack.',
      options: [{ id: 'bye', label: 'Thanks, Mira' }] }));
  },

  // ---------------------------------------------------------------- the camp at rest
  // the islanders aren't statues: they look about, mutter, wince; Brann paces his post
  isleIdle(n) {
    if (n.facingUntil && this.tick < n.facingUntil) { if (n.anim === 'walk') this.setAnim(n, 'idle'); return; }
    if (n.facingUntil) { n.dir = n.homeDir; n.facingUntil = 0; }
    if (n.kind === 'isle_lookout') {
      // a few steps one way, a pause, a few steps back
      const o = n.origin, tgt = n.paceOut ? { x: o.x + 1.6, y: o.y - 1.0 } : o;
      if (this.tick >= (n.paceAt || 0)) {
        const dx = tgt.x - n.x, dy = tgt.y - n.y, d = Math.hypot(dx, dy), v = 1.1 / TICK_RATE;
        if (d > v) { n.x += dx / d * v; n.y += dy / d * v; n.dir = dirFromVector(dx, dy); if (n.anim !== 'walk') this.setAnim(n, 'walk'); return; }
        n.x = tgt.x; n.y = tgt.y; n.paceOut = !n.paceOut; n.paceAt = this.tick + T(3 + this.rng() * 4);
        this.setAnim(n, 'idle'); n.dir = 6;    // looking up at the bluff
      }
      return;
    }
    if (this.tick < (n.idleAt ?? (n.idleAt = this.tick + T(3 + this.rng() * 8)))) return;
    n.idleAt = this.tick + T(8 + this.rng() * 9);
    const EMOTES = {
      isle_captain: ['studies a sea chart', 'glares up at the bluff', 'mutters about goblins', 'counts the crates'],
      isle_cook: ['stirs the pot', 'tastes the stew', 'adds a pinch of salt', 'fans the fire'],
      isle_sailor1: ['winces', 'rubs his leg', 'groans', 'shifts closer to the fire'],
      isle_sailor2: ['sharpens a knife', 'stares out to sea', 'stretches stiffly', 'pokes the fire'],
      isle_ferryman: ['coils a rope', 'squints at the sky', 'whistles a sea shanty'],
    };
    const L = EMOTES[n.kind]; if (!L) return;
    // a glance one way or the other, and now and then a little something to show for it
    n.dir = (n.homeDir + [0, 1, 7, 0][Math.floor(this.rng() * 4)]) % 8; n.facingUntil = this.tick + T(2.5);
    if (this.rng() < 0.55) this.zoneEvent(n.zone, { e: 'emote', id: n.id, text: L[Math.floor(this.rng() * L.length)] });
  },

  isleBoard(p) {
    const z = this.isleZone(p);
    if (!z || p.riding) return;
    if (p.tut && !p.tut.done && sid(p) !== 'ferry') return this.privateEvent(p, { e: 'sys', text: 'Old Wyck: "The captain wants a word first, friend."' });
    // the captain's chest goes along if it was left unopened
    const chest = this.isleChest(p);
    if (chest && !chest.opened) { chest.opened = true; this.setAnim(chest, 'open'); this.addItem(p, 'potion', 5); p.gold += 40; this.addItem(p, gearFor(p.cls, 'weapon', 1), 1, 1); p.selfDirty = true; this.privateEvent(p, { e: 'loot', text: 'Old Wyck stowed the captain\'s chest aboard: 40 gold, 5 healing potions and a fine weapon.', r: 1 }); }
    // aboard: the ship casts off and sails away from the isle, then the crossing to Hollowmere
    const A = z.map.starter.areas, ship = [...this.ents.values()].find((e) => e.type === 'portal' && e.kind === 'ferry' && e.zone === p.zone);
    if (!ship) return this.tutFinish(p, 'ferry');
    p.riding = true; p.path = null; p.moveDir = null; p.target = null; p.selfDirty = true;
    this.teleport(p, ship.x, ship.y);
    this.privateEvent(p, { e: 'ferryride', id: ship.id });
    const dx = ship.x - A.jetty.x, dy = ship.y - A.jetty.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const steps = 70;
    for (let i = 1; i <= steps; i++) this.later(i * 0.1, () => {
      if (!this.ents.has(p.id) || p.zone !== ship.zone) return;
      const k = i / steps, v = 0.03 + 0.14 * k;            // gathering speed as the sails fill
      ship.x += ux * v; ship.y += uy * v; p.x = ship.x; p.y = ship.y;
    });
    this.later(steps * 0.1 + 0.2, () => { if (!this.ents.has(p.id)) return; p.riding = false; this.tutFinish(p, 'ferry'); });
  },
  isleChest(p) { for (const e of this.ents.values()) if (e.type === 'chest' && e.isleReward === p.id && e.zone === p.zone) return e; return null; },
  // Captain Harlan's thanks: it bursts open with the reward spilling out onto the jetty
  openIsleChest(p, c) {
    const drop = (k, q, r = 0) => this.dropLoot(k, q, c.x + (this.rng() - 0.5) * 1.2, c.y + 0.6 + this.rng() * 0.5, c.zone, p.id, r);
    drop('gold', 40); drop('potion', 5); drop(gearFor(p.cls, 'weapon', 1), 1, 1);
    this.privateEvent(p, { e: 'sys', text: 'The captain\'s chest: 40 gold, healing potions and a fine weapon. Pick them up (V loots everything nearby).' });
  },

  // ---------------------------------------------------------------- steps
  tutAdvance(p, to, msg) {
    p.tut.s = to; p.selfDirty = true; p.tutKills = 0;
    if (msg) this.privateEvent(p, { e: 'sys', text: msg });
    this.privateEvent(p, { e: 'tutstep', s: to });
    const id = TUT_STEPS[to]?.id;
    if (id === 'gear') {
      // the first piece of real gear: Fine armour for the hero's class, salvaged from the wreck
      this.addItem(p, gearFor(p.cls, 'armor', 1), 1, 1);
      this.privateEvent(p, { e: 'loot', text: 'Captain Harlan sent you armour salvaged from the wreck.', r: 1 });
    }
    if (id === 'crabs') {
      this.addItem(p, 'potion', 3);
      this.privateEvent(p, { e: 'loot', text: 'Mira gave you 3 healing potions.', r: 0 });
    }
    if (id === 'ferry') {
      this.levelTo(p, 5);
      // the reward waits in a chest on the jetty
      const z = this.isleZone(p), A = z?.map.starter.areas;
      if (A && !this.isleChest(p)) this.newEnt({ type: 'chest', kind: 'chest_big', x: (A.jetty.x + A.ferryman.x) / 2, y: (A.jetty.y + A.ferryman.y) / 2, zone: z.id, dir: 1, isleReward: p.id });
    }
    p.tutAt = this.tick;
  },
  // a goal step is done: its level, its words, and on to the next
  tutGoalDone(p) {
    const st = TUT_STEPS[p.tut.s];
    if (st.lvl) this.levelTo(p, st.lvl);
    this.tutAdvance(p, p.tut.s + 1, st.done);
  },
  // at least this level (the island's steps hand out the first levels like quests would)
  levelTo(p, L) { while (p.level < L) this.grantXp(p, Math.max(1, xpToNext(p.level) - p.xp + 1)); },
  tutFinish(p, how) {
    for (const it of ['tobias_boot', 'driftwood']) { const n = this.countItem(p, it); if (n) this.removeItem(p, it, n); }
    if (!p.tut.done) { p.tut = { s: 99, done: true }; this.privateEvent(p, { e: 'tutdone' }); this.checkAchievements?.(p); }
    p.selfDirty = true;
    this.leaveIsle(p, how);
  },
  tutorialOp(p, m) {
    if (!p.tut || p.tut.done) return;
    if (m.op === 'intro' && p.tut.s === 0) this.tutAdvance(p, 1);
    else if (m.op === 'skip') {
      // the town is for level 5 and up: a hero who skips the island gets what it would have given
      this.levelTo(p, 5);
      if (!p.equip.armor && !p.inv.some((it) => it && it.item === gearFor(p.cls, 'armor', 1))) this.addItem(p, gearFor(p.cls, 'armor', 1), 1, 1);
      if (sid(p) !== 'ferry') { this.addItem(p, 'potion', 5); p.gold += 40; }
      this.privateEvent(p, { e: 'sys', text: 'Guide skipped. You are level 5, with armour from the wreck in your bags (press I to put it on). Welcome to Hollowmere! Elder Maren by the fountain has work for new arrivals.' });
      this.tutFinish(p, 'skip');
    }
    else if (m.op === 'next' && sid(p) === 'loot') this.tutAdvance(p, STEP.gear);
  },
  tutorialKill(p, m) {
    if (!p.tut || p.tut.done) return;
    const goal = TUT_STEPS[p.tut.s]?.goal;
    if (!goal || m.kind !== goal[0]) return;
    if (++p.tutKills < goal[1]) { p.selfDirty = true; return; }
    this.tutGoalDone(p);
  },
  tutorialEvent(p, what) {
    if (!p.tut || p.tut.done) return;
    if (what === 'loot' && sid(p) === 'loot') this.tutAdvance(p, STEP.gear);
  },
  // every second: steps that finish by where you are or what you have
  tutorialTick(p) {
    const t = p.tut; if (!t || t.done || !p.tutClient) return;
    // a hero in the guide who is somehow not on their island (e.g. reconnected) goes back to it
    if (!this.isleZone(p) && p.anim !== 'die') { this.enterStarter(p); return; }
    const id = sid(p), st = TUT_STEPS[t.s] || {};
    const cap = this.isleNpc(p, 'isle_captain');
    const left = (kind) => [...this.ents.values()].some((m) => m.tutFor === p.id && m.kind === kind && m.hp > 0);
    if (id === 'wake' && cap && Math.hypot(cap.x - p.x, cap.y - p.y) < 4) this.tutAdvance(p, STEP.talk);
    else if (st.goal && this.tick - p.tutAt > T(3) && !left(st.goal[0])) this.tutGoalDone(p);   // none left to fight
    else if (id === 'loot' && this.tick - p.tutAt > T(30)) this.tutAdvance(p, STEP.gear);
    else if (id === 'gear' && p.equip.armor) this.tutAdvance(p, STEP.skill, 'Looking sharp! Armour makes you much harder to hurt.');
    else if (id === 'skill' && Object.values(p.skills).some((r) => r > 0)) this.tutAdvance(p, STEP.cook, 'A new skill! Drag it from the skills window (K) onto your action bar to put it where you like.');
  },
  // what the client shows: the step, a counter, and where its arrow points
  tutView(p) {
    const t = p.tut; if (!t || t.done || !p.tutClient) return null;
    const step = TUT_STEPS[t.s]; if (!step) return null;
    const z = this.isleZone(p), A = z?.map.starter.areas;
    let at = null;
    const nearest = (kind) => [...this.ents.values()].filter((e) => e.tutFor === p.id && e.kind === kind && e.hp > 0 && e.zone === p.zone).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (step.npc) { const n = this.isleNpc(p, step.npc); if (n) at = [n.x, n.y]; }
    else if (step.goal) { const m = nearest(step.goal[0]); if (m) at = [m.x, m.y]; else if (A?.[step.area]) at = [A[step.area].x, A[step.area].y]; }
    else if (step.id === 'ferry' && A) { const c = this.isleChest(p); at = c && !c.opened ? [c.x, c.y] : [A.ferry.x, A.ferry.y]; }
    const goal = step.goal ? `${step.goal[2]}: ${Math.min(p.tutKills || 0, step.goal[1])} / ${step.goal[1]}` : undefined;
    return { s: t.s, n: LAST, title: step.title, text: step.text, at: at && [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10], goal };
  },
};
