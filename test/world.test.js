import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { World, positionOf } from '../server/world.js';
import { Table, fmt } from '../server/table.js';
import { Detection } from '../server/detection.js';

const T = '48353983'; // the table that starts empty
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// A club without simulated players, so every chip belongs to a bot or You.
function closedWorld(opts) {
  const w = new World(opts);
  w.settings.npcTraffic = false;
  for (const t of w.tables.values()) t.seats.fill(null);
  for (const a of [...w.accounts.values()]) if (a.kind === 'npc') w.accounts.delete(a.id);
  return w;
}

// All money in a closed club: club chips, requests, queue, tables (stacks, top-ups, pot) and rake taken.
function ledger(w) {
  let n = 0;
  for (const a of w.accounts.values()) n += a.clubChips;
  for (const r of [...w.requests, ...w.queue]) n += r.amount;
  for (const t of w.tables.values()) n += t.chipsOnTable() + t.rakeCollected;
  return n;
}
const rake = w => [...w.tables.values()].reduce((x, t) => x + t.rakeCollected, 0);

function clock(t) { t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 }); }
function run(t, w, ms, each) {
  for (let i = 0; i < ms / 100; i++) { t.mock.timers.tick(100); w.tick(Date.now()); each?.(); }
}
const seat = (w, id, amount = 10000, table = T) => { const r = w.requestSeat(id, table, amount); w.resolveRequest(r.id, true); };
const addFillers = w => { while (w.accounts.size < 9) w.createBot(`Filler${w.accounts.size}`); };
function fillTable(w) {
  addFillers(w);
  for (const a of [...w.accounts.values()].filter(a => a.kind === 'bot').slice(0, 8)) seat(w, a.id);
  assert.equal(w.table(T).emptySeats().length, 0);
}

test('money is conserved through request, reject, queue, cancel, top-up, play, leave and delete', t => {
  clock(t);
  const w = closedWorld();
  addFillers(w);
  const tb = w.table(T), you = w.account('you');
  const total = ledger(w);

  const r = w.requestSeat('you', T, 5000);
  assert.equal(you.clubChips, 95000);
  assert.equal(ledger(w), total);
  w.resolveRequest(r.id, false);
  assert.equal(you.clubChips, 100000);

  fillTable(w);
  w.requestSeat('you', T, 7000);
  w.resolveRequest(w.requests[0].id, true);
  assert.ok(w.queue.some(q => q.accountId === 'you'), 'queued at a full table');
  assert.equal(ledger(w), total);
  w.cancelRequest('you');
  assert.equal(you.clubChips, 100000);
  assert.equal(w.queue.length, 0);

  w.requestSeat('you', T, 7000);
  w.resolveRequest(w.requests[0].id, true);
  const first = tb.seats.find(Boolean).accountId;
  w.leave(first); // no hand yet: frees the seat, the queue fills it
  run(t, w, 100);
  assert.equal(you.tableId, T);
  assert.equal(ledger(w), total);

  run(t, w, 30000, () => assert.equal(ledger(w), total));
  const s = tb.seats[tb.seatOf('you')];
  try { w.topUp('you', Math.max(1, Math.min(1000, tb.maxBuyIn - s.stack - s.topUp))); } catch {}
  run(t, w, 30000, () => assert.equal(ledger(w), total));

  for (const x of tb.seats.filter(Boolean)) w.leave(x.accountId);
  run(t, w, 20000);
  assert.equal(tb.seats.filter(Boolean).length, 0, 'everyone has left');
  assert.equal(ledger(w), total);
  assert.equal([...w.accounts.values()].reduce((n, a) => n + a.clubChips, 0) + rake(w), total, 'all back in club chips');

  const bot = w.accounts.get(first);
  const gone = bot.clubChips;
  w.deleteBot(first);
  assert.equal(ledger(w), total - gone);
  w.stop();
});

test('a restart pays back queued buy-ins and chips already in the pot', t => {
  clock(t);
  const dir = mkdtempSync(join(tmpdir(), 'hm-world-'));
  const statePath = join(dir, 'state.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = closedWorld({ statePath });
  const tb = w.table(T);
  fillTable(w);
  w.requestSeat('you', T, 7000);
  w.resolveRequest(w.requests[0].id, true);
  const pot = () => (tb.hand && tb.hand.phase !== 'done' ? [...tb.hand.players.values()].reduce((x, p) => x + p.total, 0) : 0);
  for (let i = 0; i < 600 && !(tb.hand?.phase === 'betting' && pot() > tb.sb + tb.bb); i++) run(t, w, 100);
  assert.ok(pot() > tb.sb + tb.bb, 'mid-hand with chips in the pot');

  w.flushSave();
  const saved = JSON.parse(readFileSync(statePath, 'utf8')).accounts;
  assert.equal(saved.find(a => a.id === 'you').clubChips, 100000, 'queued buy-in is saved');
  const live = ledger(w) - rake(w);
  assert.equal(saved.reduce((n, a) => n + a.clubChips, 0), live);
  w.stop();

  const w2 = new World({ statePath });
  assert.equal([...w2.accounts.values()].filter(a => a.kind !== 'npc').reduce((n, a) => n + a.clubChips, 0), live);
  w2.stop();

  // Saves are throttled, not debounced: a club that changes every 100 ms still gets written.
  rmSync(statePath);
  const w3 = new World({ statePath });
  for (let i = 0; i < 10; i++) { w3.changed(); t.mock.timers.tick(100); }
  assert.ok(existsSync(statePath));
  w3.stop();
});

test('seat numbers are validated before any chips move', t => {
  clock(t);
  const w = closedWorld();
  const you = w.account('you');
  for (const bad of [99, 8, -1, 1.5, 'abc', '', true, {}]) {
    assert.throws(() => w.requestSeat('you', T, 5000, bad), /Invalid seat/, String(bad));
    assert.equal(you.clubChips, 100000);
    assert.equal(you.pendingReq, null);
  }
  const r = w.requestSeat('you', T, 5000, '3');
  assert.equal(r.seat, 3);
  w.resolveRequest(r.id, true);
  assert.equal(w.table(T).seatOf('you'), 3);
  w.stop();
});

test('simulated players are removed when rejected, cancelled or taken off the queue', t => {
  clock(t);
  const w = closedWorld();
  const a = w.newNpc();
  w.resolveRequest(w.requestSeat(a.id, T, 5000).id, false);
  const b = w.newNpc();
  w.requestSeat(b.id, T, 5000);
  w.cancelRequest(b.id);
  fillTable(w);
  const c = w.newNpc();
  w.resolveRequest(w.requestSeat(c.id, T, 5000).id, true);
  assert.equal(w.queue.length, 1);
  w.cancelRequest(c.id);
  const snap = w.snapshot();
  for (const x of [a, b, c]) {
    assert.ok(!w.accounts.has(x.id));
    assert.ok(!w.detection.players.has(x.id), 'never played, so no detection record');
    assert.equal(snap.truth[x.id], 'npc');
  }
  assert.equal(w.queue.length, 0);
  w.stop();
});

test('departed simulated players keep only a bounded detection history', t => {
  clock(t);
  const w = closedWorld();
  const npcs = Array.from({ length: 30 }, () => w.newNpc());
  for (const a of npcs) w.detection.onHandEnd({ players: [{ accountId: a.id }, { accountId: 'you' }] }, Date.now());
  for (const a of npcs) w.dropNpc(a);
  const kept = npcs.filter(a => w.detection.players.has(a.id));
  assert.equal(kept.length, 20);
  assert.deepEqual(kept, npcs.slice(-20), 'the most recent ones');
  assert.equal(w.detection.partners.get('you').size, 20, 'pairs of forgotten players are gone too');
  assert.equal(w.newNpc().name.startsWith('guest'), false);
  w.stop();
});

test('deleted bots stay "bot" in the ground truth', t => {
  clock(t);
  const w = closedWorld();
  const b = w.createBot('Tmp');
  w.detection.onHandEnd({ players: [{ accountId: b.id }, { accountId: 'you' }] }, Date.now());
  w.deleteBot(b.id);
  const snap = w.snapshot();
  assert.equal(snap.truth[b.id], 'bot');
  assert.equal(snap.truth.you, 'you');
  assert.ok(snap.detection.some(r => r.id === b.id));
  w.stop();
});

test('bot config: think-time sliders push each other; junk is ignored', t => {
  clock(t);
  const w = closedWorld();
  const b = w.createBot('Cfg');
  w.configureBot(b.id, { thinkMin: 1.2 });
  assert.deepEqual([b.config.thinkMin, b.config.thinkMax], [1.2, 1.8]);
  w.configureBot(b.id, { thinkMin: 8 });
  assert.deepEqual([b.config.thinkMin, b.config.thinkMax], [8, 8]);
  w.configureBot(b.id, { thinkMax: 2 });
  assert.deepEqual([b.config.thinkMin, b.config.thinkMax], [2, 2]);
  const before = { ...b.config };
  w.configureBot(b.id, { thinkMin: 'fast', thinkMax: 'x', bluff: null, skill: 'toString', style: 'constructor', rit: 'maybe' });
  w.configureBot(b.id, { thinkMin: NaN, thinkMax: Infinity, bluff: '', skill: ['pro'] });
  assert.deepEqual(b.config, before);
  const loaded = w.addAccount({ kind: 'bot', name: 'Old', config: { thinkMin: null, thinkMax: 'x', skill: '__proto__', bluff: 70 } });
  assert.deepEqual(loaded.config, { skill: 'medium', style: 'smc', rit: 'twice', bluff: 70, thinkMin: 0.8, thinkMax: 1.8, autoTopUp: false });
  w.stop();
});

test('an empty stack cannot sit back in', t => {
  clock(t);
  const w = closedWorld();
  const b = [...w.accounts.values()].find(a => a.kind === 'bot');
  seat(w, b.id);
  const tb = w.table(T), s = tb.seats[tb.seatOf(b.id)];
  s.stack = 0; s.sittingOut = true;
  assert.throws(() => w.setSitOut(b.id, false), /Top up first/);
  w.setEnabled(b.id, true);
  assert.equal(s.sittingOut, true);
  s.topUp = 5000;
  w.setSitOut(b.id, false);
  assert.equal(s.sittingOut, false);
  w.stop();
});

test('top-ups the table has to clamp are refunded to club chips', t => {
  clock(t);
  const w = closedWorld();
  const tb = w.table(T), npc = w.newNpc();
  w.onTableEvent('topUpRefund', { table: tb, accountId: 'you', amount: 700 });
  w.onTableEvent('topUpRefund', { table: tb, accountId: npc.id, amount: 700 });
  assert.equal(w.account('you').clubChips, 100700);
  assert.equal(npc.clubChips, 0);
  w.stop();
});

test('position runs from 0 (first to act after the flop) to 1 (the button)', () => {
  const tb = new Table({ id: 't', name: 'T', sb: 50, bb: 100 });
  for (const i of [0, 2, 3, 5, 7]) tb.sit(`p${i}`, `P${i}`, 10000, i);
  for (let n = 0; n < 5; n++) {
    tb.startHand(0);
    const seats = [...tb.hand.players.keys()];
    const pos = Object.fromEntries(seats.map(i => [i, positionOf(tb, i)]));
    assert.equal(pos[tb.button], 1);
    assert.equal(pos[tb.nextFrom(tb.button, j => tb.hand.players.has(j))], 0);
    for (const i of seats) assert.ok(pos[i] >= 0 && pos[i] <= 1);
    assert.equal(new Set(Object.values(pos)).size, seats.length);
    tb.hand = null;
  }
  const hu = new Table({ id: 'h', name: 'H', sb: 50, bb: 100 });
  hu.sit('a', 'A', 10000); hu.sit('b', 'B', 10000);
  hu.startHand(0);
  assert.equal(positionOf(hu, hu.button), 1);
  assert.equal(positionOf(hu, hu.hand.bbSeat), 0);
});

test('toggling a bot off and on mid-turn never makes it act early', t => {
  clock(t);
  const w = closedWorld();
  const tb = w.table(T), b = [...w.accounts.values()].find(a => a.kind === 'bot');
  w.configureBot(b.id, { thinkMin: 3, thinkMax: 3.1, style: 'station' });
  seat(w, 'you'); seat(w, b.id);
  const times = [];
  const orig = w.onTableEvent.bind(w);
  w.onTableEvent = (type, d) => { if (type === 'action' && d.accountId === b.id) times.push(d.ms); orig(type, d); };
  run(t, w, 90000, () => {
    const h = tb.hand;
    if (h?.phase !== 'betting') return;
    const who = tb.seats[h.toAct]?.accountId;
    if (who === b.id && Date.now() - h.turnStartedAt < 150) { w.setEnabled(b.id, false); w.setEnabled(b.id, true); }
    if (who === 'you') { const L = tb.legal(h.toAct); w.act('you', L.canRaise && Math.random() < 0.7 ? { type: 'raise', amount: L.minTo } : { type: L.canCheck ? 'check' : 'call' }); }
  });
  assert.ok(times.length > 5);
  assert.ok(Math.min(...times) >= 3000, `decision times ${times}`);
  w.stop();
});

test("reconnecting doesn't answer run-it-twice for a bot left to the operator", t => {
  clock(t);
  const w = closedWorld();
  const tb = w.table(T), b = [...w.accounts.values()].find(a => a.kind === 'bot');
  w.configureBot(b.id, { style: 'station', rit: 'optional' });
  seat(w, 'you', 2000); seat(w, b.id, 2000);
  for (let i = 0; i < 3000 && tb.hand?.phase !== 'rit'; i++) run(t, w, 100, () => {
    const h = tb.hand;
    if (h?.phase === 'betting' && tb.seats[h.toAct]?.accountId === 'you') { const L = tb.legal(h.toAct); w.act('you', L.canRaise ? { type: 'raise', amount: L.maxTo } : { type: 'call' }); }
  });
  assert.equal(tb.hand?.phase, 'rit');
  w.reload(b.id);
  run(t, w, 4500);
  assert.equal(tb.hand.rit.answers[b.id], undefined);
  w.stop();
});

test('lastDecision: bots only, tagged with hand and table, bets called bets', t => {
  clock(t);
  const w = new World({});
  w.settings.npcTraffic = false;
  const tb = w.table(T), b = [...w.accounts.values()].find(a => a.kind === 'bot');
  w.configureBot(b.id, { skill: 'pro', style: 'aggro', thinkMin: 0.5, thinkMax: 0.6 });
  seat(w, 'you'); seat(w, b.id);
  const word = { bets: 'bet', raises: 'raise', calls: 'call', checks: 'check', folds: 'fold' };
  const seen = new Set();
  let prev = null;
  run(t, w, 240000, () => {
    const h = tb.hand;
    if (h?.phase === 'betting' && tb.seats[h.toAct]?.accountId === 'you') w.act('you', { type: tb.legal(h.toAct).canCheck ? 'check' : 'call' });
    const d = b.lastDecision;
    if (!d || d === prev) return;
    prev = d;
    seen.add(d.action);
    assert.equal(d.tableId, T);
    assert.equal(d.handNo, tb.handNo);
    const line = tb.log.findLast(l => l.startsWith(`${b.name} `) && /^\S+ (bets|raises|calls|checks|folds)/.test(l));
    assert.equal(word[line.split(' ')[1]], d.action, line);
    if (d.action === 'bet' || d.action === 'raise') assert.ok(line.includes(fmt(d.amount)), `${line} vs ${d.amount}`);
  });
  assert.ok(seen.has('bet'), [...seen].join());
  const snap = w.snapshot();
  assert.ok(snap.accounts.find(a => a.id === b.id).lastDecision);
  for (const a of snap.accounts.filter(a => a.kind !== 'bot')) assert.equal(a.lastDecision, null, a.name);
  w.stop();
});

test("a new occupant never shows the previous player's hand", t => {
  clock(t);
  const w = closedWorld();
  const tb = w.table(T);
  fillTable(w);
  for (let i = 0; i < 3000 && !(tb.hand?.phase === 'done' && tb.hand.shown.size); i++) run(t, w, 100);
  const [i] = tb.hand.shown;
  assert.equal(w.snapshot().tables.find(x => x.id === T).seats[i].shown, true);
  // The engine no longer frees a seat before cleanup, but the snapshot must not rely on that.
  tb.seats[i] = { ...tb.seats[i], accountId: 'you', name: 'You' };
  const row = w.snapshot().tables.find(x => x.id === T).seats[i];
  assert.deepEqual([row.inHand, row.folded, row.hole, row.shown], [false, false, null, false]);
  w.stop();
});

test('detection: pairs indexed per player, report throttled, forget() prunes', () => {
  const d = new Detection();
  d.p('a', 'A', 'dev'); d.p('b', 'B', 'dev'); d.p('c', 'C', 'other');
  for (let i = 0; i < 40; i++) d.onHandEnd({ players: [{ accountId: 'a' }, { accountId: 'b' }, { accountId: 'c' }] }, i * 1000);
  const r0 = d.report(new Set(['a']), 0);
  const a0 = r0.find(r => r.id === 'a');
  assert.equal(a0.seated, true);
  assert.ok(a0.flags.some(f => /Sits with same-device accounts: B \(100% of hands\)/.test(f.text)));
  d.onAction({ accountId: 'c', ms: 1000, street: 0, type: 'call', legal: { toCall: 1 } });
  assert.equal(d.report(new Set(), 500).find(r => r.id === 'c').decisions, 0, 'cached within a second');
  assert.equal(d.report(new Set(), 1000).find(r => r.id === 'c').decisions, 1);
  d.forget('b');
  assert.deepEqual([...d.partners.get('a').keys()], ['c']);
  assert.equal(d.report(new Set(), 2000).some(r => r.id === 'b'), false);
  d.reset(new Set(['a']));
  assert.deepEqual(d.report(new Set(), 2100).map(r => r.id), ['a'], 'reset shows at once');
});

/* ---------- the real server over WebSocket ---------- */

function startServer(env) {
  const proc = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env: { ...process.env, HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const ready = new Promise((res, rej) => {
    proc.stdout.on('data', c => { out += c; const m = out.match(/running at http:\/\/[\d.]+:(\d+)/); if (m) res(+m[1]); });
    proc.stderr.on('data', c => { out += c; });
    proc.on('exit', code => rej(new Error(`server exited ${code}: ${out}`)));
  });
  const exited = new Promise(res => proc.on('exit', code => res(code)));
  return { proc, ready, exited, log: () => out };
}

function client(port, headers) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
  let seq = 0, state = null;
  const pending = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'state') state = m.data;
    else if (m.type === 'reply') pending.get(m.id)?.(m);
  });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
  const send = (cmd, args) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, res);
    setTimeout(() => rej(new Error(`no reply to ${cmd}`)), 3000);
    ws.send(JSON.stringify({ id, cmd, args }));
  });
  return { ws, opened, send, state: () => state };
}

test('server: commands, validation, origin check, bad messages, port clash and shutdown save', { timeout: 30000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hm-server-'));
  const statePath = join(dir, 'state.json');
  const srv = startServer({ PORT: '0', STATE_PATH: statePath });
  t.after(() => { srv.proc.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); });
  const port = await srv.ready;

  await assert.rejects(client(port, { Origin: 'https://evil.example' }).opened, /HTTP 401|HTTP 403/);
  const other = client(port, { Origin: 'http://localhost:9999' });
  await other.opened;
  other.ws.close();

  const c = client(port);
  await c.opened;
  c.ws.send('null');
  c.ws.send('[1,2]');
  c.ws.send('{"cmd":');
  assert.equal((await c.send('chips.add', { id: 'you', amount: 5 })).ok, true, 'socket still works after junk');
  assert.match((await c.send('constructor', {})).error, /Unknown command/);
  assert.match((await c.send('hasOwnProperty', {})).error, /Unknown command/);

  assert.equal((await c.send('table.create', { sb: 0, bb: 1 })).error, 'Small blind must be more than 0');
  assert.equal((await c.send('table.create', { sb: 1, bb: 0.5 })).error, 'Big blind must be at least the small blind');
  assert.equal((await c.send('table.create', { sb: 1, bb: 2000 })).error, 'Big blind can be at most 1000');
  assert.equal((await c.send('seat.request', { id: 'you', tableId: T, amount: 50, seat: 99 })).error, 'Invalid seat');

  assert.deepEqual((await c.send('seat.request', { id: 'you', tableId: T, amount: 50 })).result, { status: 'pending' });
  await c.send('host.settings', { patch: { autoAccept: true } });
  const bots = c.state().accounts.filter(a => a.kind === 'bot');
  assert.deepEqual((await c.send('seat.request', { id: bots[0].id, tableId: T, amount: 50 })).result, { status: 'seated' });
  const busy = c.state().tables.find(x => x.id === '88634828');
  const free = busy.seats.filter(s => !s).length;
  for (let i = 1; i <= free; i++) assert.deepEqual((await c.send('seat.request', { id: bots[i].id, tableId: busy.id, amount: 100 })).result, { status: 'seated' });
  assert.deepEqual((await c.send('seat.request', { id: bots[free + 1].id, tableId: busy.id, amount: 100 })).result, { status: 'queued' });

  const cfg = { ...bots[0].config };
  assert.equal((await c.send('bot.config', { id: bots[0].id, patch: { thinkMin: 'fast', skill: 'toString' } })).ok, true);
  await c.send('chips.add', { id: 'you', amount: 0.01 }); // one more round trip so the state is current
  assert.deepEqual(c.state().accounts.find(a => a.id === bots[0].id).config, cfg);

  // A second copy on the same port must exit instead of running a headless club.
  const clash = startServer({ PORT: String(port), STATE_PATH: join(dir, 'clash.json') });
  clash.ready.catch(() => {});
  assert.equal(await clash.exited, 1);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(existsSync(join(dir, 'clash.json')), false);

  // Ctrl+C / SIGTERM writes the latest state straight away. You: 1000 + 5 + 0.01 + 10 (the pending 50 still counts).
  assert.equal((await c.send('chips.add', { id: 'you', amount: 10 })).ok, true);
  srv.proc.kill('SIGTERM');
  assert.equal(await srv.exited, 0);
  const you = JSON.parse(readFileSync(statePath, 'utf8')).accounts.find(a => a.id === 'you');
  assert.equal(you.clubChips, 100000 + 500 + 1 + 1000);
});
