// Wire protocol. Every interaction between the client and the simulation goes
// through these messages — even in single-player, where the "server" is a
// World instance running inside the browser tab. That is what makes turning
// on real multiplayer a transport swap rather than a rewrite.

import { PROTOCOL_VERSION } from './constants.js';

// client -> server
export const C2S = {
  HELLO: 'hello',       // { name, cls?, save?, proto }
  MOVE: 'move',         // { x, y }               click-to-move target
  DIR: 'dir',           // { dx, dy }             keyboard movement (world space, 0,0 = stop)
  ATTACK: 'attack',     // { id }
  INTERACT: 'interact', // { id }                 talk to NPC / pick up loot
  USE: 'use',           // { slot }               use / equip inventory item
  UNEQUIP: 'unequip',   // { slot: 'weapon'|'armor' }
  SELL: 'sell',         // { slot }
  BUY: 'buy',           // { npc, item }
  DIALOG: 'dialog',     // { npc, choice }
  SKILL: 'skill',       // { slot: 0-6, x, y }       cast at / toward a world point
  LEARN: 'learn',       // { skill }                 spend a skill point
  CRAFT: 'craft',       // { npc, recipe }
  SETPET: 'setpet',     // { pet }                   '' to dismiss
  SETTITLE: 'settitle', // { title }                 '' for none
  SETDYE: 'setdye',     // { dye: 0 }                remove dye
  CHAT: 'chat',         // { text }
  PREFS: 'prefs',       // { auto: 0|1|2, loot?: 0|1 }  auto-attack: off / fight back when hit / also attack enemies nearby; auto-loot
  PING: 'ping',         // { t }
  BANK: 'bank',         // { op: 'dep'|'wd'|'depgold'|'wdgold'|'buy', slot?, one?, amount? }
  FISH: 'fish',         // { x, y }               cast your line at a water point
  HOOK: 'hook',         // {}                     strike when a fish bites
  FARM: 'farm',         // { op: 'dig'|'forage', x, y }   dig a hole in a field / search wild flowers for seeds
  MOUNT: 'mount',       // {}                     call your mount / get down
  HEARTH: 'hearth',     // {}                     use the hearthstone
  TRAVEL: 'travel',     // { x, y }               walk to a far-away point (world map, quest tracker)
  LOOTALL: 'lootall',   // {}                     pick up everything of yours lying close by
  SORT: 'sort',         // { where: 'pack'|'bank' }  tidy a bag: stacks merged, like with like
  PARTY: 'party',       // { op: 'invite'|'accept'|'decline'|'leave'|'kick'|'lead', name? }
  TRADE: 'trade',       // { op: 'ask'|'yes'|'no'|'add'|'remove'|'gold'|'accept'|'cancel', name?, slot?, i?, amount? }
  DESTROY: 'destroy',   // { slot, qty }           throw an item away for good
  DROP: 'drop',         // { slot, qty }           put an item on the ground (not in town)
  GUILD: 'guild',       // { op, name?, tag?, text?, slot?, i?, amount? }   guilds (see shared/world_social.js)
  FRIEND: 'friend',     // { op: 'add'|'remove', name }
  TUT: 'tut',           // { op: 'intro'|'skip'|'next' }   the guided start
};

// server -> client
export const S2C = {
  WELCOME: 'welcome',   // { id, seed, tick, proto, tickRate, zone }
  SNAP: 'snap',         // { tick, ents:[...], self?, ev:[...] }
  DIALOG: 'dialog',     // { npc, name, text, options:[{id,label}] }
  SHOP: 'shop',         // { npc, name, stock:[{item, price}] }
  CRAFT: 'craft',       // { npc, name, at }        open the crafting window (at: forge | brew | cook)
  BANK: 'bank',         // { npc, name, clerk }      open the bank window
  ZONE: 'zone',         // { zone: { id, kind, seed, floor, name } }   you moved to another map
  PONG: 'pong',         // { t }
  ERROR: 'error',       // { message }
};

export function encode(msg) { return JSON.stringify(msg); }
export function decode(raw) {
  try { const m = JSON.parse(raw); return m && typeof m.t === 'string' ? m : null; } catch { return null; }
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const str = (v, max) => typeof v === 'string' && v.length <= max;

// Server-side validation: never trust a client message's shape.
export function validate(m) {
  if (!m || typeof m !== 'object') return false;
  switch (m.t) {
    case C2S.HELLO: return str(m.name, 24) && m.proto === PROTOCOL_VERSION && (m.cls === undefined || str(m.cls, 16));
    case C2S.MOVE: return num(m.x) && num(m.y);
    case C2S.DIR: return num(m.dx) && num(m.dy) && Math.abs(m.dx) <= 1.01 && Math.abs(m.dy) <= 1.01;
    case C2S.ATTACK: case C2S.INTERACT: return int(m.id);
    case C2S.USE: case C2S.SELL: return int(m.slot);
    case C2S.UNEQUIP: return m.slot === 'weapon' || m.slot === 'armor';
    case C2S.BUY: return int(m.npc) && str(m.item, 32);
    case C2S.DIALOG: return int(m.npc) && str(m.choice, 32);
    case C2S.SKILL: return int(m.slot) && m.slot >= 0 && m.slot <= 6 && num(m.x) && num(m.y);
    case C2S.LEARN: return str(m.skill, 32);
    case C2S.CRAFT: return int(m.npc) && str(m.recipe, 32);
    case C2S.SETPET: return str(m.pet, 16);
    case C2S.SETTITLE: return str(m.title, 32);
    case C2S.SETDYE: return m.dye === 0;
    case C2S.CHAT: return str(m.text, 200);
    case C2S.PREFS: return int(m.auto) && m.auto >= 0 && m.auto <= 2 && (m.loot === undefined || m.loot === 0 || m.loot === 1);
    case C2S.PING: return num(m.t);
    case C2S.FISH: return num(m.x) && num(m.y);
    case C2S.HOOK: return true;
    case C2S.FARM: return (m.op === 'dig' || m.op === 'forage') && num(m.x) && num(m.y);
    case C2S.MOUNT: case C2S.HEARTH: case C2S.LOOTALL: return true;
    case C2S.SORT: return m.where === 'pack' || m.where === 'bank';
    case C2S.PARTY: return ['invite', 'accept', 'decline', 'leave', 'kick', 'lead'].includes(m.op) && (m.name === undefined || str(m.name, 24));
    case C2S.TRAVEL: return num(m.x) && num(m.y);
    case C2S.TRADE: return ['ask', 'yes', 'no', 'add', 'remove', 'gold', 'accept', 'cancel'].includes(m.op) && (m.name === undefined || str(m.name, 24))
      && (m.slot === undefined || (int(m.slot) && m.slot >= 0 && m.slot < 200)) && (m.i === undefined || (int(m.i) && m.i >= 0 && m.i < 10)) && (m.amount === undefined || (num(m.amount) && m.amount >= 0 && m.amount <= 1e9));
    case C2S.DESTROY: case C2S.DROP: return int(m.slot) && m.slot >= 0 && m.slot < 200 && int(m.qty) && m.qty >= 1 && m.qty <= 9999;
    case C2S.BANK: return ['dep', 'wd', 'depgold', 'wdgold', 'buy'].includes(m.op) && (m.slot === undefined || (int(m.slot) && m.slot >= 0 && m.slot < 100))
      && (m.amount === undefined || (num(m.amount) && m.amount >= 0 && m.amount <= 1e9)) && (m.one === undefined || typeof m.one === 'boolean');
    case C2S.GUILD: return ['create', 'invite', 'accept', 'decline', 'leave', 'kick', 'promote', 'demote', 'lead', 'motd', 'disband', 'dep', 'wd', 'depgold', 'wdgold', 'view'].includes(m.op)
      && (m.name === undefined || str(m.name, 24)) && (m.tag === undefined || str(m.tag, 8)) && (m.text === undefined || str(m.text, 140))
      && (m.slot === undefined || (int(m.slot) && m.slot >= 0 && m.slot < 200)) && (m.i === undefined || (int(m.i) && m.i >= 0 && m.i < 40)) && (m.amount === undefined || (num(m.amount) && m.amount >= 0 && m.amount <= 1e9));
    case C2S.FRIEND: return (m.op === 'add' || m.op === 'remove') && str(m.name, 24);
    case C2S.TUT: return ['intro', 'skip', 'next'].includes(m.op);
    default: return false;
  }
}
