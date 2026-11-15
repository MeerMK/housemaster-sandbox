// HTTP (static UI) + WebSocket (live state + commands) for the sandbox.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from './world.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number.isInteger(parseInt(process.env.PORT)) ? parseInt(process.env.PORT) : 4300; // PORT=0 picks a free port
const HOST = process.env.HOST || '127.0.0.1';
const STATE_PATH = process.env.STATE_PATH || join(ROOT, 'data/state.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const STATIC = {
  '/vendor/morphdom.js': join(ROOT, 'node_modules/morphdom/dist/morphdom-umd.min.js'),
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = STATIC[url.pathname];
  if (!file) {
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    file = join(ROOT, 'public', rel);
    if (!file.startsWith(join(ROOT, 'public'))) { res.writeHead(403).end(); return; }
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// A second copy that can't get the port must not keep playing hands and overwriting the save file.
// Registered before the WebSocket server so it runs ahead of ws re-emitting the error.
server.on('error', e => { console.error(`Server error: ${e.message}`); process.exit(1); });

// Browsers let any page open a WebSocket to localhost, so only the dashboard's own origin may connect.
// Other origins must match the Host header and be a bare IP (LAN use) or HOST itself: any other name could be DNS-rebound.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const originOk = (origin, host) => {
  if (!origin || LOCAL_ORIGIN.test(origin)) return true;
  try { const u = new URL(origin); return u.host === host && (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname === HOST); } catch { return false; }
};
const wss = new WebSocketServer({ server, verifyClient: ({ origin, req }) => originOk(origin, req.headers.host) });
const world = new World({ statePath: STATE_PATH });

// Every UI command maps to one world method. Money arrives from the UI in chips (e.g. 25.5) and is converted to cents here.
const cents = x => Math.round(Number(x) * 100);
const COMMANDS = {
  'bot.create': ({ name }) => world.createBot(name),
  'bot.delete': ({ id }) => world.deleteBot(id),
  'bot.enable': ({ id, value }) => world.setEnabled(id, !!value),
  'bot.config': ({ id, patch }) => world.configureBot(id, patch || {}),
  'bot.reload': ({ id }) => world.reload(id),
  // Auto-accept can seat or queue the player straight away, so tell the UI which one happened.
  'seat.request': ({ id, tableId, amount, seat }) => {
    world.requestSeat(id, tableId, cents(amount), seat);
    const a = world.account(id);
    return { status: a.tableId ? 'seated' : world.queue.some(q => q.accountId === id) ? 'queued' : 'pending' };
  },
  'seat.cancel': ({ id }) => world.cancelRequest(id),
  'seat.leave': ({ id }) => world.leave(id),
  'seat.sitout': ({ id, value }) => world.setSitOut(id, !!value),
  'seat.topup': ({ id, amount }) => world.topUp(id, cents(amount)),
  'seat.act': ({ id, type, amount }) => world.act(id, { type, amount: amount != null ? cents(amount) : undefined }),
  'seat.rit': ({ id, choice }) => world.answerRit(id, choice),
  'chips.add': ({ id, amount }) => world.addClubChips(id, cents(amount)),
  'chat.send': ({ id, text }) => world.chat(id, text),
  'host.resolve': ({ reqId, accept }) => world.resolveRequest(reqId, !!accept),
  'host.settings': ({ patch }) => {
    if (patch && typeof patch === 'object') for (const k of ['autoAccept', 'npcTraffic']) if (k in patch) world.settings[k] = !!patch[k];
    world.changed();
  },
  'table.create': ({ sb, bb, name }) => {
    const s = cents(sb), b = cents(bb);
    if (!(s > 0)) throw new Error('Small blind must be more than 0');
    if (!(b >= s)) throw new Error('Big blind must be at least the small blind');
    if (!(b <= 100000)) throw new Error('Big blind can be at most 1000');
    world.addTable({ sb: s, bb: b, name }); world.changed();
  },
  'table.addNpc': ({ tableId }) => {
    const t = world.table(tableId);
    const a = world.newNpc();
    try { world.requestSeat(a.id, tableId, t.bb * (40 + Math.floor(Math.random() * 60))); }
    catch (e) { world.dropNpc(a); throw e; }
  },
  'detection.reset': () => { world.detection.reset(new Set(world.accounts.keys())); world.changed(); },
};

function broadcast() {
  const msg = JSON.stringify({ type: 'state', data: world.snapshot() });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', data: world.snapshot() }));
  // Anything thrown here would escape into ws's receiver and silently stop this socket, so nothing may.
  ws.on('message', raw => {
    try {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      let reply;
      try {
        const fn = Object.hasOwn(COMMANDS, msg.cmd) ? COMMANDS[msg.cmd] : null;
        if (!fn) throw new Error(`Unknown command ${msg.cmd}`);
        const result = fn(msg.args && typeof msg.args === 'object' ? msg.args : {});
        reply = { type: 'reply', id: msg.id, ok: true, result };
      } catch (e) {
        reply = { type: 'reply', id: msg.id, ok: false, error: e?.message ?? String(e) };
      }
      ws.send(JSON.stringify(reply));
      broadcast();
    } catch (e) { console.error('message handling failed:', e); }
  });
});

// Last-resort guard so a bug in one hand can't take the whole sandbox down during a demo.
process.on('uncaughtException', e => console.error('uncaught:', e));
// Write the latest state before exiting (the periodic save lags up to 500 ms).
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { world.flushSave(); process.exit(0); });

server.listen(PORT, HOST, () => {
  // Clock: advance tables, then push state if anything changed (at most ~8×/s). Only once the port is ours.
  setInterval(() => world.tick(Date.now()), 100);
  setInterval(() => { if (world.dirty) { world.dirty = false; broadcast(); } }, 125);
  console.log(`HouseMaster sandbox running at http://${HOST}:${server.address().port}`);
});
