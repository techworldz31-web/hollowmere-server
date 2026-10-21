// Quest availability rules, shared so the server (authoritative) and the
// client (quest markers, quest log) always agree.
import { QUESTS, QUEST_ORDER } from './content.js';

export function questDone(quests, q) { return quests[q]?.state === 'done'; }

export function questComplete(q, st, inv) {
  const d = QUESTS[q];
  if (!st || st.state !== 'active') return false;
  if (d.kind === 'kill') return st.count >= d.count;
  if (d.kind === 'collect') return inv.reduce((n, s) => n + (s?.item === d.item ? s.qty : 0), 0) >= d.count;
  if (d.kind === 'visit') return (st.count || 0) >= 1;
  return true; // talk
}

export function questProgress(q, st, inv) {
  const d = QUESTS[q];
  if (d.kind === 'kill') return Math.min(st?.count || 0, d.count);
  if (d.kind === 'collect') return Math.min(inv.reduce((n, s) => n + (s?.item === d.item ? s.qty : 0), 0), d.count);
  if (d.kind === 'visit') return Math.min(st?.count || 0, 1);
  return 0;
}

// who: { level, cls } of the player (both optional, for older callers)
export function canOffer(quests, q, who = {}) {
  const d = QUESTS[q];
  if (quests[q] || (d.requires && !questDone(quests, d.requires))) return false;
  if (d.cls && who.cls && d.cls !== who.cls) return false;
  if (d.minLv && (who.level ?? 1) < d.minLv) return false;
  return true;
}
// a quest you could take if you were a little stronger (shown as a grey ! over the giver)
export function soonOffer(quests, q, who = {}) {
  const d = QUESTS[q];
  return !quests[q] && (!d.requires || questDone(quests, d.requires)) && (!d.cls || !who.cls || d.cls === who.cls) && d.minLv && (who.level ?? 1) < d.minLv;
}

// What an NPC has for this player: { turnin, offer, progress } quest ids (or null)
export function npcQuestState(npcKind, quests, inv, who = {}) {
  let turnin = null, offer = null, progress = null, soon = null;
  for (const q of QUEST_ORDER) {
    const d = QUESTS[q], st = quests[q];
    if (st?.state === 'active' && (d.turnin || d.giver) === npcKind && questComplete(q, st, inv)) { turnin ??= q; continue; }
    if (d.giver === npcKind && canOffer(quests, q, who)) { offer ??= q; continue; }
    if (d.giver === npcKind && soonOffer(quests, q, who)) soon ??= q;
    if (st?.state === 'active' && (d.giver === npcKind || d.turnin === npcKind)) progress ??= q;
  }
  return { turnin, offer, progress, soon };
}
