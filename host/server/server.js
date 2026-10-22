// Multiplayer server (dormant until you switch the client to online mode).
//
//   npm run dev   -> serves the project for development at http://localhost:8080/client/
//                    (single-player by default; add ?server=ws://localhost:8080 to play online)
//   npm start     -> serves the built game from dist/ and hosts the shared world
//
// It runs the exact same World class the browser uses in single-player; the
// only difference is that the transport is a WebSocket instead of a function call.

import { createServer } from 'node:http';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, renameSync, openSync, fsyncSync, closeSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from '../shared/world.js';
import { encode, decode, C2S, S2C } from '../shared/protocol.js';
import { TICK_MS } from '../shared/constants.js';
import { staticHandler } from '../tools/static.mjs';
import { createAdmin } from './admin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const DEV = process.argv.includes('--dev');
const DATA_DIR = process.env.HM_DATA || join(ROOT, 'server', 'data');
const SAVE_FILE = join(DATA_DIR, 'players.json');
const GUILD_FILE = join(DATA_DIR, 'guilds.json');
const MAIL_FILE = join(DATA_DIR, 'mail.json');
const ACCOUNT_FILE = join(DATA_DIR, 'accounts.json');
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.txt');
// the built game the server hands out (the host package points this at the folder the zips were unpacked into)
const GAME_DIR = process.env.HM_GAME || join(ROOT, 'dist', 'Hollowmere');

// ---- persistence (JSON file; swap for a database later) ----------------------
// NOTE: players are keyed by name with no password. Add real accounts before
// opening this to the public internet.
// ---- safe saving --------------------------------------------------------------------------
// Every data file is written to a temporary file first, flushed to disk, then swapped in, so a
// crash or power cut in the middle of a save can never leave a half-written file. The previous
// copy is kept as <file>.bak, and players.json (with the guilds and the post) is copied into
// data/backups once an hour; the last 72 hourly copies are kept.
const BACKUP_DIR = join(DATA_DIR, 'backups');
function safeWrite(file, text) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp', fd = openSync(tmp, 'w');
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  if (existsSync(file)) { try { copyFileSync(file, file + '.bak'); } catch {} }
  renameSync(tmp, file);
}
// Read a data file. If it's damaged, fall back to its .bak, then to the newest hourly backup.
// If there's a file but none of them can be read, the server stops instead of starting empty
// (starting empty would overwrite everyone's heroes and vaults at the next save).
function safeRead(file, label) {
  const tries = [file, file + '.bak'];
  if (existsSync(BACKUP_DIR)) {
    const base = file.split(/[\\/]/).pop().replace('.json', '');
    tries.push(...readdirSync(BACKUP_DIR).filter((f) => f.startsWith(base + '-')).sort().reverse().map((f) => join(BACKUP_DIR, f)));
  }
  let seen = false;
  for (const f of tries) {
    if (!existsSync(f)) continue;
    seen = true;
    try { const v = JSON.parse(readFileSync(f, 'utf8')); if (f !== file) console.warn(`!! ${label}: ${file} was damaged, loaded ${f} instead.`); return v; }
    catch (e) { console.warn(`!! ${label}: could not read ${f} (${e.message})`); }
  }
  if (seen) { console.error(`!! ${label}: every copy is damaged. Stopping so nothing gets overwritten. Look in ${BACKUP_DIR}.`); process.exit(1); }
  return null;
}
function hourlyBackup() {
  try {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '');
    for (const f of [SAVE_FILE, GUILD_FILE, MAIL_FILE, ACCOUNT_FILE]) {
      if (!existsSync(f)) continue;
      const base = f.split(/[\\/]/).pop().replace('.json', '');
      copyFileSync(f, join(BACKUP_DIR, `${base}-${stamp}.json`));
      const old = readdirSync(BACKUP_DIR).filter((x) => x.startsWith(base + '-')).sort();
      for (const x of old.slice(0, Math.max(0, old.length - 72))) unlinkSync(join(BACKUP_DIR, x));
    }
  } catch (e) { console.error('Hourly backup failed:', e.message); }
}

let saves = safeRead(SAVE_FILE, 'Hero saves') || {};
// accounts: a password per hero name (salted scrypt), set the first time a name is used
let accounts = {};
accounts = safeRead(ACCOUNT_FILE, 'Accounts') || {};
const hashPass = (pass, salt) => scryptSync(String(pass), salt, 32).toString('hex');
function checkPass(name, pass) {
  const key = name.trim().slice(0, 16).toLowerCase() || 'wanderer';
  const a = accounts[key];
  if (!a) return 'new';
  if (typeof pass !== 'string' || !pass) return false;
  const h = Buffer.from(hashPass(pass, a.salt), 'hex'), want = Buffer.from(a.hash, 'hex');
  return h.length === want.length && timingSafeEqual(h, want);
}
function setPass(name, pass) {
  const key = name.trim().slice(0, 16).toLowerCase() || 'wanderer', salt = randomBytes(12).toString('hex');
  accounts[key] = { salt, hash: hashPass(pass, salt), created: new Date().toISOString() };
  safeWrite(ACCOUNT_FILE, JSON.stringify(accounts, null, 1));
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1000);
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { safeWrite(SAVE_FILE, JSON.stringify(saves, null, 1)); } catch (e) { console.error('!! Could not save heroes:', e.message); setTimeout(persist, 5000); }
}
hourlyBackup(); setInterval(hourlyBackup, 60 * 60 * 1000);
const BANK_LOG = join(DATA_DIR, 'bank-log.txt');

const world = new World({
  trustClientSaves: false,   // the server owns progress; client-sent saves are ignored
  hooks: {
    savePlayer: (_cid, name, data) => { saves[name.toLowerCase()] = data; persist(); },
    loadPlayer: (name) => saves[name.toLowerCase()] || null,
    // guilds live in their own file next to the player saves
    loadGuilds: () => safeRead(GUILD_FILE, 'Guilds'),
    // the post: every hero's mailbox, next to the player saves
    loadMail: () => safeRead(MAIL_FILE, 'Mail'),
    saveMail: (m) => { try { safeWrite(MAIL_FILE, JSON.stringify(m)); } catch (e) { console.error('Could not save the mail:', e.message); } },
    // every vault change, one line each, so any vault can be put back by hand
    bankLog: (row) => { try { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); appendFileSync(BANK_LOG, JSON.stringify(row) + '\n'); } catch {} },
    saveGuilds: (g) => { try { safeWrite(GUILD_FILE, JSON.stringify(g)); } catch (e) { console.error('Could not save guilds:', e.message); } },
  },
});

// ---- HTTP (static files) + WebSocket on the same port --------------------------
const serveFiles = staticHandler(DEV ? ROOT : GAME_DIR);
const http = createServer((req, res) => {
  // the invite link: straight into the online game on this server
  if (req.url === '/' || req.url === '') { res.writeHead(302, { Location: DEV ? '/client/?online' : '/Play%20Hollowmere.html?online' }); return res.end(); }
  // Only the game's own files are ever handed out: the page, game.js and the sprite sheets.
  // Saves, passwords, the admin password and logs (all in host/ or server/) can never be reached,
  // however the address is written.
  let path = req.url.split('?')[0]; try { path = decodeURIComponent(path); } catch { res.writeHead(400); return res.end(); }
  const allowed = DEV ? !/(^|[\\/])(server|host)([\\/]|$)|\.\.|[\\]|\/\.\//i.test(path) && !/\/\//.test(path)
    : /^\/(Play Hollowmere\.html|game\.js|favicon\.ico|sprites\/[A-Za-z0-9_.-]+\.(js|txt)|music\/[A-Za-z0-9_.-]+\.(mp3|ogg))$/.test(path) && !path.includes('..');
  if (!allowed) { res.writeHead(404); return res.end(); }
  serveFiles(req, res);
});

const sockets = new Map();   // clientId -> ws
const meta = new Map();      // clientId -> { ip, joinedAt } (for the admin panel)

// ---- admin tools (server/admin.js): /admin <password>, then F8 in game -----------------------
function kickSocket(p, message) {
  for (const [cid, c] of world.clients) {
    if (c.entId !== p.id) continue;
    const ws = sockets.get(cid);
    try { ws?.send(encode({ t: S2C.ERROR, message })); } catch {}
    world.removeClient(cid); sockets.delete(cid); meta.delete(cid);
    setTimeout(() => { try { ws?.close(); } catch {} }, 300);
  }
}
const admin = createAdmin({
  world, meta, kickSocket, dataDir: DATA_DIR,
  passFile: process.env.HM_ADMINPW || join(DATA_DIR, 'ADMIN PASSWORD.txt'),
  send: (cid, msg) => { const ws = sockets.get(cid); if (ws && ws.readyState === 1) ws.send(encode(msg)); },
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

// drop connections that went quiet (a laptop lid closed, Wi-Fi gone) so their hero logs out and saves
setInterval(() => { for (const ws of wss.clients) { if (ws.alive === false) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 20000);

wss.on('connection', (ws, req) => {
  const id = randomUUID();
  // the player's internet address (through the Cloudflare tunnel it arrives in a header)
  const ip = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  let joined = false;
  let budget = 40;           // crude rate limit: 40 msgs/sec
  const refill = setInterval(() => { budget = 40; }, 1000);
  sockets.set(id, ws);

  ws.on('message', (raw) => {
    if (--budget < 0) return;
    const m = decode(raw.toString());
    if (!m) return;
    if (!joined) {
      if (m.t === C2S.HELLO) {
        const name = typeof m.name === 'string' ? m.name : '';
        const fail = (message) => { ws.send(encode({ t: S2C.ERROR, message })); setTimeout(() => ws.close(), 200); };
        const key = name.trim().slice(0, 16).toLowerCase();
        const banned = admin.checkBan(name, ip);
        if (banned) return fail(banned);
        const ok = checkPass(name, m.pass);
        if (!ok) return fail(m.pass ? `Wrong password for ${name.trim()}. (New here? Pick a different name.)` : 'That hero has a password: enter it on the title screen.');
        // the same hero logging in again (a dropped connection, a second tab): the new session takes over
        for (const [cid, c] of world.clients) if (world.ents.get(c.entId)?.name?.toLowerCase() === key) {
          const old = sockets.get(cid);
          try { old?.send(encode({ t: S2C.ERROR, message: 'You logged in somewhere else.' })); } catch {}
          world.removeClient(cid); sockets.delete(cid);
          try { old?.terminate(); } catch {}
        }
        if (ok === 'new' && (typeof m.pass !== 'string' || m.pass.length < 3)) return fail('Pick a password (3+ letters) on the title screen so nobody else can play your hero.');
        joined = world.addClient(id, m);
        if (joined && ok === 'new') setPass(name, m.pass);
        if (joined) {
          meta.set(id, { ip, joinedAt: Date.now() });
          admin.afterJoin(id);
          console.log(`[+] ${name} — ${world.clients.size} online`);
          const p = world.ents.get(world.clients.get(id)?.entId);
          if (p) world.privateEvent(p, { e: 'sys', text: 'Playtest: found a bug or have an idea? Type /bug and what happened, and the host gets it.' });
        }
      }
      return;
    }
    // the admin panel's requests, and /admin, /r in chat (never reach the world or the public chat)
    if (m.t === 'admin') return admin.onMessage(id, m);
    if (m.t === C2S.CHAT && typeof m.text === 'string' && admin.onChat(id, m.text)) return;
    // /bug <what happened>: playtest notes go to server/data/feedback.txt with where you were
    if (m.t === C2S.CHAT && typeof m.text === 'string' && /^\/(bug|feedback)\b/i.test(m.text.trim())) {
      const c = world.clients.get(id), p = c && world.ents.get(c.entId);
      const note = m.text.trim().replace(/^\/(bug|feedback)\s*/i, '').slice(0, 300);
      if (p && note) {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        appendFileSync(FEEDBACK_FILE, `${new Date().toLocaleString()} | ${p.name} (Lv ${p.level} ${p.cls}) at ${p.zone} ${p.x.toFixed(1)},${p.y.toFixed(1)} | ${note}\n`);
        world.privateEvent(p, { e: 'sys', text: 'Thanks! Your note was saved for the developer.' });
        console.log(`[bug] ${p.name}: ${note}`);
      } else if (p) world.privateEvent(p, { e: 'sys', text: 'Type /bug and then what happened, e.g. /bug I got stuck behind the inn.' });
      return;
    }
    world.receive(id, m);
  });
  ws.on('close', () => {
    clearInterval(refill);
    if (joined && sockets.get(id) === ws) world.removeClient(id);
    if (sockets.get(id) === ws) sockets.delete(id);
    if (!sockets.has(id)) meta.delete(id);
    console.log(`[-] client left — ${world.clients.size} online`);
  });
});

// ---- fixed-timestep simulation loop -----------------------------------------
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last; last = now;
  let steps = 0;
  while (acc >= TICK_MS && steps++ < 5) {
    acc -= TICK_MS;
    for (const [cid, msg] of world.step()) {
      const ws = sockets.get(cid);
      if (ws && ws.readyState === 1) ws.send(encode(msg));
    }
  }
  if (acc > TICK_MS * 5) acc = 0;
}, TICK_MS / 2);

http.listen(PORT, process.env.HM_BIND || undefined, () => {
  console.log(`Hollowmere server on http://localhost:${PORT}`);
  console.log(DEV ? `  dev client:   http://localhost:${PORT}/client/` : `  game:         http://localhost:${PORT}/`);
  console.log(`  online play:  add ?server=ws://localhost:${PORT} to the game URL`);
});

function shutdown() {
  for (const [cid] of world.clients) world.removeClient(cid);
  saveNow();
  process.exit(0);
}
// a crash still saves everyone first
process.on('uncaughtException', (e) => { console.error('!! Crash:', e); try { for (const [cid] of world.clients) world.removeClient(cid); } catch {} saveNow(); process.exit(1); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);      // Windows: the host window was closed
