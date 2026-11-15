// UI regression tests: public/app.js runs in a vm sandbox with just enough fake browser to render and handle clicks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

class FakeEl {
  constructor(attrs = {}) { this.attrs = { ...attrs }; this.dataset = {}; this.value = attrs.value ?? ''; this.isConnected = true; }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  focus() {}
}

function load() {
  const listeners = {}, sent = [], timers = [];
  const app = new FakeEl(), toastEl = new FakeEl(), inputs = {};
  let autoscroll = [];
  class FakeWS { constructor() { FakeWS.last = this; this.readyState = 1; } send(m) { sent.push(JSON.parse(m)); } }
  const ctx = vm.createContext({
    console, location: { protocol: 'http:', host: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout: f => timers.push(f), clearTimeout() {}, setInterval: () => 0,
    matchMedia: () => ({ matches: false }), WebSocket: FakeWS,
    // Real morphdom drops attributes the new HTML doesn't carry, so no state may live in data-* on the DOM.
    morphdom: () => { for (const el of autoscroll) el.dataset = {}; },
    document: {
      activeElement: null,
      querySelector: s => (s === '#app' ? app : s === '#toast' ? toastEl : inputs[s] ?? null),
      querySelectorAll: s => (s === '[data-autoscroll]' ? autoscroll : []),
      addEventListener: (type, f) => { listeners[type] = f; },
      getElementById: () => null,
    },
  });
  ctx.window = ctx;
  vm.runInContext(SRC, ctx);
  const ws = FakeWS.last;
  ws.onopen();
  const run = code => vm.runInContext(code, ctx);
  const setState = s => { ctx.__s = s; run('S = __s; offset = 0'); };
  const reply = (id, result, ok = true) => ws.onmessage({ data: JSON.stringify({ type: 'reply', id, ok, result, error: ok ? undefined : result }) });
  const click = (dataset, extra = {}) => listeners.click({ target: { hasAttribute: () => false, closest: () => ({ dataset, disabled: false }) }, ...extra });
  return { ctx, run, setState, reply, click, listeners, sent, timers, toastEl, inputs, setAutoscroll: a => { autoscroll = a; } };
}

const meta = {
  skills: Object.fromEntries(['pro', 'medium', 'fish'].map(k => [k, { label: k, desc: '' }])),
  styles: Object.fromEntries(['nit', 'smc', 'aggro', 'station', 'fold'].map(k => [k, { label: k, desc: '' }])),
};
const cfg = { skill: 'medium', style: 'smc', rit: 'twice', bluff: 50, thinkMin: 0.8, thinkMax: 1.8, autoTopUp: false };
const bot = (id, name, extra = {}) => ({ id, kind: 'bot', name, pid: 'P1', clubChips: 100000, enabled: true, connected: true, config: cfg, npcProfile: null,
  tableId: null, pendingReq: null, lastDecision: null, tilt: false, ritPending: null, queued: false, requestTable: null, ...extra });
const seat = (i, accountId, name, kind, extra = {}) => ({ seat: i, accountId, name, kind, stack: 10000, topUp: 0, sittingOut: false, leaving: false,
  lastAction: null, inHand: false, folded: false, allIn: false, committed: 0, hole: null, shown: false, maxTopUp: 0, ...extra,
  busted: extra.busted ?? ((extra.stack ?? 10000) + (extra.topUp ?? 0) === 0 && !(extra.inHand && !extra.folded)) });
const table = (id, seats, hand = null) => ({ id, name: 'T', sb: 50, bb: 100, minBuyIn: 2000, maxBuyIn: 10000, createdAt: 0, rakePct: 0.069, rakeCap: 799,
  actionTime: 15000, rakeCollected: 0, seats: Array.from({ length: 8 }, (_, i) => seats[i] || null), button: 0, handNo: hand?.no ?? 0, hand, log: [], chat: [], results: [] });
const hand = (no, extra = {}) => ({ no, phase: 'betting', street: 1, board: ['Ah', 'Kd', '2c'], boards: null, pot: 600, toAct: 5, deadline: Date.now() + 9000,
  currentBet: 0, rit: null, winners: null, legal: null, ...extra });
const state = over => ({ now: Date.now(), club: 'Club', settings: { autoAccept: false, npcTraffic: false }, ...meta,
  accounts: [], tables: [], requests: [], queue: [], history: [], detection: [], truth: {}, ...over });

test('send() resolves with the reply result', async () => {
  const u = load();
  const p = u.run('send("seat.request", {})');
  u.reply(u.sent[0].id, { status: 'queued' });
  assert.equal((await p).status, 'queued');
});

test('chips confirm toasts what actually happened, and a double click sends once', async () => {
  for (const [status, msg] of [['seated', 'Gio sat down'], ['queued', 'Table is full — Gio is in the queue'], ['pending', 'Buy-in request sent — approve it in Buy-in Requests']]) {
    const u = load();
    u.setState(state({ accounts: [bot('b1', 'Gio')], tables: [table('t1', [])], settings: { autoAccept: true } }));
    u.run('ui.modal = { type: "chips", id: "b1", tableId: "t1" }');
    u.inputs['#chips-in'] = { value: '50' };
    const first = u.click({ act: 'chips-confirm' });
    const second = u.click({ act: 'chips-confirm' });
    assert.equal(u.sent.length, 1);
    u.reply(u.sent[0].id, { status });
    await Promise.all([first, second]);
    assert.equal(u.toastEl.textContent, msg);
    assert.equal(u.run('ui.modal'), null);
  }
});

test('chips modal warns that a full table means the queue under auto-accept', () => {
  const u = load();
  const full = Array.from({ length: 8 }, (_, i) => seat(i, `n${i}`, `N${i}`, 'npc'));
  u.setState(state({ accounts: [bot('b1', 'Gio')], tables: [table('t1', full)], settings: { autoAccept: true } }));
  u.run('ui.modal = { type: "chips", id: "b1", tableId: "t1" }');
  const html = u.run('renderModal()');
  assert.match(html, /table is full — you'll join the queue/);
  assert.doesNotMatch(html, /seated right away/);
});

test('top up ignores a second click while the first is in flight', async () => {
  const u = load();
  u.setState(state({ accounts: [bot('b1', 'Gio', { tableId: 't1' })], tables: [table('t1', [seat(0, 'b1', 'Gio', 'bot', { stack: 5000 })])] }));
  u.run('ui.modal = { type: "manage", id: "b1" }');
  u.inputs['#topup-in'] = { value: '5' };
  const a = u.click({ act: 'topup', id: 'b1' }), b = u.click({ act: 'topup', id: 'b1' });
  assert.match(u.run('renderModal()'), /data-act="topup" data-id="b1" disabled/);
  u.reply(u.sent[0].id);
  await Promise.all([a, b]);
  assert.equal(u.sent.length, 1);
});

test('last decision only shows for the hand on screen, and opening bets read as bets', () => {
  const u = load();
  const s = seat(0, 'b1', 'Gio', 'bot', { inHand: true, hole: ['As', 'Ks', 'Qs', 'Js'] });
  const dec = (handNo, action = 'bet') => ({ why: 'Value bet (0.67)', action, amount: 528, at: Date.now(), street: 1, handNo, tableId: 't1' });
  u.setState(state({ tables: [table('t1', [s], hand(14))] }));
  const card = d => u.run(`botCard(${JSON.stringify(bot('b1', 'Gio', { tableId: 't1', lastDecision: d }))})`);
  assert.doesNotMatch(card(dec(13, 'fold')), /Last decision/);
  assert.match(card(dec(14)), /Last decision: <b>Bet 5.28<\/b>/);
  assert.match(card(dec(14, 'raise')), /Raise to 5.28/);
});

test('an Off bot on the clock is not shown as thinking', () => {
  const u = load();
  const s = seat(5, 'b1', 'Gio', 'bot', { inHand: true, hole: ['As', 'Ks', 'Qs', 'Js'] });
  u.setState(state({ tables: [table('t1', [, , , , , s], hand(3))] }));
  const html = u.run(`botCard(${JSON.stringify(bot('b1', 'Gio', { tableId: 't1', enabled: false }))})`);
  assert.doesNotMatch(html, /Thinking/);
  assert.match(html, /Bot is off<\/b> — will time out in \d+s/);
});

test('a busted bot cannot Sit and says why; Leave is disabled while leaving', () => {
  const u = load();
  u.setState(state({ tables: [table('t1', [seat(0, 'b1', 'Gio', 'bot', { stack: 0, sittingOut: true }), seat(1, 'b2', 'Shink', 'bot', { leaving: true })])] }));
  const busted = u.run(`botCard(${JSON.stringify(bot('b1', 'Gio', { tableId: 't1' }))})`);
  assert.match(busted, /Busted — top up to play/);
  assert.match(busted, /data-act="sitout" data-v="0" data-id="b1" disabled/);
  const leaving = u.run(`botCard(${JSON.stringify(bot('b2', 'Shink', { tableId: 't1' }))})`);
  assert.match(leaving, /data-act="leave" data-id="b2" disabled/);
});

test("run-it-twice prompt doesn't call the covering player all-in", () => {
  const u = load();
  const you = seat(0, 'you', 'You', 'you', { inHand: true, stack: 4000 });
  const b = seat(1, 'b1', 'Gio', 'bot', { inHand: true, allIn: true, stack: 0 });
  const t = table('t1', [you, b], hand(2, { phase: 'rit', rit: { deadline: Date.now() + 5000, answers: {}, result: null } }));
  u.setState(state({ accounts: [{ ...bot('you', 'You'), kind: 'you' }], tables: [t] }));
  const bar = u.run('actionBar(S.tables[0], acct("you"), locate("you"), true)');
  assert.match(bar, /Your opponent is all-in\. Run it twice\?/);
  u.run('S.tables[0].seats[0].allIn = true');
  assert.match(u.run('actionBar(S.tables[0], acct("you"), locate("you"), true)'), /You're all-in\. Run it twice\?/);
});

test("a busted You can't press I'm back", () => {
  const u = load();
  const t = table('t1', [seat(0, 'you', 'You', 'you', { stack: 0, sittingOut: true })]);
  u.setState(state({ accounts: [{ ...bot('you', 'You'), kind: 'you' }], tables: [t] }));
  const bar = u.run('actionBar(S.tables[0], acct("you"), locate("you"), true)');
  assert.match(bar, /Busted — top up to play/);
  assert.match(bar, /data-act="sitout" data-id="you" data-v="0" disabled/);
});

test('detection scoring uses ground truth for deleted bots', () => {
  const u = load();
  const row = (id, name, level) => ({ id, name, seated: false, hands: 40, score: level === 'high' ? 75 : 10, level, vpip: 0.3, pfr: 0.2, foldToBet: 0.5,
    decisions: 0, avgTime: 0, timeCv: 0, flags: [], fingerprint: 'x', fastest: null, af: 1 });
  u.setState(state({ detection: [row('gone1', 'Gio', 'high'), row('n1', 'Karim', 'low')], truth: { gone1: 'bot', n1: 'npc', you: 'you' } }));
  u.run('ui.reveal = true; ui.detSeated = false; ui.detOpen = "gone1"');
  const html = u.run('renderDetection()');
  assert.match(html, /caught <b>1 of 1<\/b> bot \(high risk\) with <b>0<\/b> false alarms/);
  assert.match(html, /<b>Gio<\/b> <span class="truth bot">BOT<\/span>/);
  assert.match(html, /Bot \(deleted\)/);
});

test('config sliders keep a stable id and Slowest cannot go below Fastest', () => {
  const u = load();
  u.setState(state());
  const html = u.run(`configPanel(${JSON.stringify(bot('b1', 'Gio', { config: { ...cfg, thinkMin: 2.5, thinkMax: 4 } }))})`);
  assert.match(html, /id="thinkMin-b1" data-keep/);
  assert.match(html, /id="thinkMax-b1" data-keep data-cfg="thinkMax" data-id="b1" min="2.5"/);
});

test('dashboard groups are keyed and the Connected icon keeps its shape', () => {
  const u = load();
  u.setState(state({ accounts: [bot('b1', 'A', { tableId: 't1' }), bot('b2', 'B', { pendingReq: 'r1' }), bot('b3', 'C')], tables: [table('t1', [seat(0, 'b1', 'A', 'bot')])] }));
  const html = u.run('renderDashboard()');
  for (const id of ['grp-t1', 'grp-waiting', 'grp-idle']) assert.match(html, new RegExp(`<section class="group" id="${id}">`));
  assert.match(html, /width="22" height="22"[^>]*><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5/);
});

test('data-keep inputs keep their value but refresh placeholder, min and max', () => {
  const u = load();
  u.setState(state());
  const from = new FakeEl({ id: 'topup-in', 'data-keep': '', placeholder: 'max 100', min: '0.01' });
  from.value = '7';
  u.run('keepValue')(from, new FakeEl({ id: 'topup-in', 'data-keep': '', placeholder: 'max 50', max: '50' }));
  assert.deepEqual([from.value, from.getAttribute('placeholder'), from.getAttribute('max'), from.hasAttribute('min')], ['7', 'max 50', '50', false]);
  // A config slider nobody is touching follows the saved value.
  const slider = new FakeEl({ id: 'thinkMax-b1', 'data-keep': '', value: '1.8' });
  slider.dataset.cfg = 'thinkMax';
  u.run('keepValue')(slider, new FakeEl({ id: 'thinkMax-b1', 'data-keep': '', value: '8' }));
  assert.equal(slider.value, '8');
});

test('a log the user scrolled up stays put across re-renders', () => {
  const u = load();
  u.setState(state());
  const log = { id: 'log-t1', scrollHeight: 600, clientHeight: 200, scrollTop: 0, dataset: {} };
  u.setAutoscroll([log]);
  u.run('render()');
  assert.equal(log.scrollTop, 600);             // first sight: jump to the newest line
  log.scrollTop = 100;                          // user scrolls back
  u.run('render()'); u.run('render()');
  assert.equal(log.scrollTop, 100);
  log.scrollTop = 400;                          // back at the bottom: stays pinned as lines arrive
  u.ctx.morphdom = () => { log.dataset = {}; log.scrollHeight = 700; };
  u.run('render()');
  assert.equal(log.scrollTop, 700);
});

test('dragging a text selection out onto the backdrop does not close the modal', () => {
  const u = load();
  u.setState(state());
  u.run('ui.modal = { type: "newBot" }');
  const overlay = { hasAttribute: k => k === 'data-overlay', closest: () => null };
  u.listeners.pointerdown({ target: { hasAttribute: () => false } });
  u.listeners.click({ target: overlay });
  assert.notEqual(u.run('ui.modal'), null);
  u.listeners.pointerdown({ target: overlay });
  u.listeners.click({ target: overlay });
  assert.equal(u.run('ui.modal'), null);
});

test('new table form caps the big blind and the page declares a favicon', () => {
  const u = load();
  u.setState(state());
  u.run('ui.modal = { type: "newTable" }');
  assert.match(u.run('renderModal()'), /id="nt-bb"[^>]*max="1000"/);
  assert.match(HTML, /<link rel="icon"/);
});
