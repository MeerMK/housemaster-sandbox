// The sandbox "club": accounts, tables, buy-in requests, bot + simulated-player controllers, chat, detection.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Table, fmt } from './table.js';
import { cardStr } from './cards.js';
import { decide, decideRit, SKILLS, STYLES } from './brain.js';
import { equity } from './equity.js';
import { Detection } from './detection.js';

const CLUB = 'Ace Of Poker';
const DEVICE_DASHBOARD = 'dev-7f3a-dashboard-host'; // every bot runs from the same machine
const NPC_NAMES = ['Karim_88', 'lucky7', 'Nour.S', 'AhmadK', 'moe_z', 'Rania', 'Hadi99', 'ZeeBee', 'Fadi.M', 'Lina_P', 'Tarek', 'omar.b',
  'Sami77', 'Maya', 'jad_jad', 'Rami.K', 'Dana', 'Nadim', 'Hussein', 'Lara.M', 'Walid', 'yasmine', 'Bilal', 'Ziad'];
const NPC_CHAT = { win: ['ty', 'ty ty', 'finally', 'gg'], lose: ['nh', 'wow', 'unreal', 'every time', 'gg'], random: ['gl all', 'hi', 'brb', 'lol'] };

const DEFAULT_BOT_CONFIG = { skill: 'medium', style: 'smc', rit: 'twice', bluff: 50, thinkMin: 0.8, thinkMax: 1.8, autoTopUp: false };
const KEEP_DEPARTED = 20; // detection records kept for simulated players who have left

const rid = (n = 5) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const pick = a => a[Math.floor(Math.random() * a.length)];
const lognormal = (median, sigma) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random()));
const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(+v) ? +v : null;

// Applies a settings patch (from the UI or the save file) to a bot config; anything invalid is ignored.
function patchBotConfig(c, patch) {
  c = { ...c };
  if (typeof patch.skill === 'string' && Object.hasOwn(SKILLS, patch.skill)) c.skill = patch.skill;
  if (typeof patch.style === 'string' && Object.hasOwn(STYLES, patch.style)) c.style = patch.style;
  if (['optional', 'once', 'twice'].includes(patch.rit)) c.rit = patch.rit;
  const bluff = num(patch.bluff), tMin = num(patch.thinkMin), tMax = num(patch.thinkMax);
  if (bluff != null) c.bluff = Math.max(0, Math.min(100, bluff));
  // The slider the user moved keeps its value; the other one follows it.
  if (tMin != null) { c.thinkMin = Math.max(0.3, Math.min(10, tMin)); c.thinkMax = Math.max(c.thinkMax, c.thinkMin); }
  if (tMax != null) { c.thinkMax = Math.max(0.3, Math.min(14, tMax)); c.thinkMin = Math.min(c.thinkMin, c.thinkMax); }
  if (patch.autoTopUp != null) c.autoTopUp = !!patch.autoTopUp;
  return c;
}

// 0 = first to act after the flop (just left of the button) … 1 = the button, ranked among the players dealt in.
export function positionOf(t, seat) {
  const after = i => (i - t.button - 1 + t.maxSeats) % t.maxSeats;
  const order = [...t.hand.players.keys()].sort((x, y) => after(x) - after(y));
  return order.indexOf(seat) / Math.max(1, order.length - 1);
}

// What the table really does with an action: an impossible raise becomes a call/check and the size is clamped.
function resolved(x, L) {
  const raise = x.type === 'raise' || x.type === 'bet';
  if (raise && L.canRaise) return { action: L.isBet ? 'bet' : 'raise', amount: Math.max(L.minTo, Math.min(L.maxTo, Math.round(x.amount))) };
  if (raise || x.type === 'call') return L.toCall ? { action: 'call', amount: L.toCall } : { action: 'check', amount: null };
  return { action: x.type, amount: null };
}

export class World {
  constructor({ statePath, onChange = () => {} } = {}) {
    this.statePath = statePath;
    this.onChange = onChange;
    this.accounts = new Map();
    this.tables = new Map();
    this.requests = [];
    this.queue = [];
    this.history = [];
    this.chats = new Map();
    this.detection = new Detection();
    this.settings = { autoAccept: false, npcTraffic: true };
    this.timers = new Set();
    this.ritAskedAt = new Map();
    this.formerKinds = new Map(); // deleted bots and departed simulated players: id -> kind
    this.departed = [];
    this.load();
  }

  /* ---------- setup & persistence ---------- */

  load() {
    let saved = null;
    if (this.statePath && existsSync(this.statePath)) {
      try { saved = JSON.parse(readFileSync(this.statePath, 'utf8')); } catch { saved = null; }
    }
    const tableDefs = saved?.tables || [
      { id: '88634828', sb: 100, bb: 200 },
      { id: '67012320', sb: 50, bb: 100 },
      { id: '48353983', sb: 50, bb: 100 },
    ];
    for (const t of tableDefs) this.addTable(t);

    const accts = saved?.accounts || [
      ...['Maverick', 'Blaze77', 'StoneCold', 'QuietKing', 'LuckyDraw'].map((name, i) => ({
        kind: 'bot', name, config: { ...DEFAULT_BOT_CONFIG, ...[{ skill: 'pro' }, { style: 'aggro' }, { style: 'nit' }, {}, { skill: 'fish' }][i] } })),
      { kind: 'you', name: 'You', id: 'you' },
    ];
    for (const a of accts) this.addAccount(a);
    if (saved?.settings) Object.assign(this.settings, saved.settings);

    // Fill the two busy tables with simulated regulars.
    const seedNpc = (tableId, n) => { for (let i = 0; i < n; i++) { const a = this.newNpc(); this.table(tableId).sit(a.id, a.name, this.table(tableId).bb * (40 + Math.floor(Math.random() * 60))); a.tableId = tableId; } };
    seedNpc('88634828', 5);
    seedNpc('67012320', 4);
  }

  // Throttled, not debounced: a busy club changes every few hundred ms and must still get saved.
  save() {
    if (!this.statePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flushSave(); }, 500);
  }

  flushSave() {
    if (!this.statePath) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    // A restart pays everything an account owns back as club chips (a hand in progress counts as cancelled).
    const accounts = [...this.accounts.values()].filter(a => a.kind !== 'npc').map(a => ({
      id: a.id, kind: a.kind, name: a.name, pid: a.pid, clubChips: this.moneyOf(a), config: a.config, enabled: a.enabled }));
    const tables = [...this.tables.values()].map(t => ({ id: t.id, name: t.name, sb: t.sb, bb: t.bb }));
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ accounts, tables, settings: this.settings }, null, 2));
      renameSync(tmp, this.statePath); // a crash mid-write must not leave a truncated save (load() would reset everything)
    } catch (e) { console.error('save failed:', e.message); }
  }

  // Club chips + a pending or queued buy-in + stack, top-up and chips already in the current pot.
  moneyOf(a) {
    const r = a.pendingReq && (this.requests.find(x => x.id === a.pendingReq) || this.queue.find(x => x.id === a.pendingReq));
    return a.clubChips + (r?.amount || 0) + this.stackOf(a);
  }

  stackOf(a) {
    const t = a.tableId && this.tables.get(a.tableId);
    const i = t ? t.seatOf(a.id) : -1;
    if (i === -1) return 0;
    const s = t.seats[i], p = t.hand?.phase !== 'done' && t.hand?.players.get(i);
    return s.stack + s.topUp + (p && p.accountId === a.id ? p.total : 0);
  }

  addTable({ id = String(10000000 + Math.floor(Math.random() * 89999999)), sb, bb, name }) {
    if (this.tables.has(id)) throw new Error('Table exists');
    const t = new Table({ id, name: name || `${fmt(sb)}/${fmt(bb)} PLO`, sb, bb, onEvent: (type, d) => this.onTableEvent(type, d) });
    t.createdAt = Date.now();
    this.tables.set(id, t);
    this.chats.set(id, []);
    return t;
  }

  addAccount({ id, kind, name, pid, clubChips, config, enabled }) {
    const a = {
      id: id || randomUUID().slice(0, 8), kind, name, pid: pid || rid(),
      clubChips: clubChips ?? (kind === 'npc' ? 0 : 100000),
      enabled: enabled ?? true, connected: true,
      fingerprint: kind === 'bot' ? DEVICE_DASHBOARD : `dev-${rid(4).toLowerCase()}-${kind}`,
      config: kind === 'bot' ? patchBotConfig(DEFAULT_BOT_CONFIG, config || {}) : config || null,
      tableId: null, pendingReq: null, lastDecision: null, tiltHands: 0, ritPending: null,
    };
    this.accounts.set(a.id, a);
    this.detection.p(a.id, a.name, a.fingerprint);
    return a;
  }

  newNpc() {
    // Prefer a name nobody in the detection list has had, so a newcomer isn't confused with someone who left.
    const live = new Set([...this.accounts.values()].map(a => a.name));
    const known = new Set([...this.detection.players.values()].map(s => s.name));
    const name = NPC_NAMES.find(n => !live.has(n) && !known.has(n)) || NPC_NAMES.find(n => !live.has(n)) || `guest${rid(3)}`;
    const skill = pick(['fish', 'fish', 'fish', 'medium', 'medium', 'pro']);
    const style = pick(['smc', 'smc', 'aggro', 'station', 'nit']);
    return this.addAccount({ kind: 'npc', name, config: { skill, style, rit: 'optional', bluff: 50 } });
  }

  // Simulated players are throwaway accounts; keep detection stats only for the last few who actually played.
  dropNpc(a) {
    if (a.kind !== 'npc') return;
    this.accounts.delete(a.id);
    this.formerKinds.set(a.id, 'npc');
    if (!this.detection.players.get(a.id)?.hands) return this.detection.forget(a.id);
    this.departed.push(a.id);
    while (this.departed.length > KEEP_DEPARTED) this.detection.forget(this.departed.shift());
  }

  table(id) { const t = this.tables.get(id); if (!t) throw new Error('Unknown table'); return t; }
  account(id) { const a = this.accounts.get(id); if (!a) throw new Error('Unknown account'); return a; }
  kindOf(id) { return this.accounts.get(id)?.kind ?? this.formerKinds.get(id); }

  addHistory(entry) {
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, 60);
  }

  /* ---------- buy-in requests ---------- */

  requestSeat(accountId, tableId, amount, seat) {
    const a = this.account(accountId), t = this.table(tableId);
    amount = Math.round(amount);
    if (a.tableId) throw new Error(`${a.name} is already at a table`);
    if (a.pendingReq) throw new Error(`${a.name} already has a pending request`);
    if (!(amount >= t.minBuyIn && amount <= t.maxBuyIn)) throw new Error(`Buy-in must be ${fmt(t.minBuyIn)} – ${fmt(t.maxBuyIn)}`);
    if (a.kind !== 'npc' && amount > a.clubChips) throw new Error('Not enough club chips');
    if (seat != null) {
      seat = typeof seat === 'number' || (typeof seat === 'string' && seat.trim()) ? Number(seat) : NaN;
      if (!Number.isInteger(seat) || seat < 0 || seat >= t.maxSeats) throw new Error('Invalid seat');
      if (t.seats[seat]) throw new Error('That seat is taken');
    }
    if (a.kind !== 'npc') a.clubChips -= amount;
    const r = { id: rid(8), accountId, tableId, amount, seat: seat ?? null, at: Date.now() };
    this.requests.push(r);
    a.pendingReq = r.id;
    if (this.settings.autoAccept) this.resolveRequest(r.id, true);
    this.changed();
    return r;
  }

  resolveRequest(reqId, accept) {
    const i = this.requests.findIndex(r => r.id === reqId);
    if (i === -1) throw new Error('Request not found');
    const r = this.requests.splice(i, 1)[0];
    const a = this.account(r.accountId), t = this.table(r.tableId);
    a.pendingReq = null;
    const entry = { name: a.name, pid: a.pid, amount: r.amount, tableId: t.id, at: Date.now(), accountId: a.id };
    if (!accept) {
      this.addHistory({ ...entry, status: 'Rejected' });
      if (a.kind === 'npc') this.dropNpc(a); else a.clubChips += r.amount;
    } else if (t.emptySeats().length === 0) {
      this.queue.push({ ...r });
      a.pendingReq = r.id;
      this.addHistory({ ...entry, status: 'Queued' });
    } else {
      // The seat asked for may have been taken meanwhile; any free seat will do then.
      t.sit(a.id, a.name, r.amount, r.seat != null && !t.seats[r.seat] ? r.seat : undefined);
      a.tableId = t.id;
      this.addHistory({ ...entry, status: 'Accepted' });
    }
    this.changed();
  }

  leaveQueue(accountId) {
    const i = this.queue.findIndex(q => q.accountId === accountId);
    if (i === -1) return;
    const q = this.queue.splice(i, 1)[0];
    const a = this.account(accountId);
    a.pendingReq = null;
    if (a.kind === 'npc') this.dropNpc(a); else a.clubChips += q.amount;
  }

  seatFromQueue(tableId) {
    const t = this.table(tableId);
    while (t.emptySeats().length) {
      const i = this.queue.findIndex(q => q.tableId === tableId);
      if (i === -1) return;
      const q = this.queue.splice(i, 1)[0];
      const a = this.account(q.accountId);
      a.pendingReq = null;
      t.sit(a.id, a.name, q.amount);
      a.tableId = t.id;
      t.addLog(`${a.name} seated from the queue`);
    }
  }

  cancelRequest(accountId) {
    const a = this.account(accountId);
    const r = this.requests.find(x => x.accountId === accountId);
    if (r) {
      this.requests.splice(this.requests.indexOf(r), 1);
      a.pendingReq = null;
      if (a.kind === 'npc') this.dropNpc(a); else a.clubChips += r.amount;
    } else this.leaveQueue(accountId);
    this.changed();
  }

  /* ---------- seat actions ---------- */

  leave(accountId) {
    const a = this.account(accountId);
    if (!a.tableId) { this.cancelRequest(accountId); return; }
    this.table(a.tableId).stand(accountId);
    this.changed();
  }

  setSitOut(accountId, value) {
    const a = this.account(accountId);
    if (!a.tableId) throw new Error(`${a.name} is not at a table`);
    const t = this.table(a.tableId), s = t.seats[t.seatOf(accountId)];
    if (!value && s && !t.hasChips(t.seatOf(accountId))) throw new Error('Top up first — the stack is empty');
    t.setSittingOut(accountId, value);
    this.changed();
  }

  topUp(accountId, amount) {
    const a = this.account(accountId);
    amount = Math.round(amount);
    if (!a.tableId) throw new Error(`${a.name} is not at a table`);
    if (!(amount > 0)) throw new Error('Enter an amount');
    if (amount > a.clubChips) throw new Error('Not enough club chips');
    this.table(a.tableId).topUp(accountId, amount);
    a.clubChips -= amount;
    this.changed();
  }

  addClubChips(accountId, amount) {
    const a = this.account(accountId);
    amount = Math.round(amount);
    if (!(amount > 0 && amount <= 1000000)) throw new Error('Amount must be between 0.01 and 10,000');
    a.clubChips += amount;
    this.changed();
  }

  act(accountId, action) {
    const a = this.account(accountId);
    if (!a.tableId) throw new Error('Not at a table');
    this.table(a.tableId).act(accountId, action);
    this.changed();
  }

  answerRit(accountId, choice) {
    const a = this.account(accountId);
    if (!a.tableId) throw new Error('Not at a table');
    const t = this.table(a.tableId);
    t.answerRit(accountId, choice);
    const asked = this.ritAskedAt.get(`${t.id}:${t.hand?.no}`);
    if (asked) this.detection.onRit(accountId, choice === 'twice' ? 'twice' : 'once', Date.now() - asked);
    a.ritPending = null;
    this.changed();
  }

  chat(accountId, text) {
    const a = this.account(accountId);
    text = String(text || '').trim().slice(0, 140);
    if (!text) throw new Error('Empty message');
    const tableId = a.tableId || this.requests.find(r => r.accountId === accountId)?.tableId;
    if (!tableId) throw new Error(`${a.name} is not at a table`);
    this.pushChat(tableId, a.name, text);
  }

  pushChat(tableId, from, text) {
    const c = this.chats.get(tableId);
    c.push({ from, text, at: Date.now() });
    if (c.length > 60) c.shift();
    this.changed();
  }

  /* ---------- bot management ---------- */

  createBot(name) {
    name = String(name || '').trim().slice(0, 18);
    if (!name) throw new Error('Name required');
    if ([...this.accounts.values()].some(a => a.name.toLowerCase() === name.toLowerCase())) throw new Error('Name already taken');
    const a = this.addAccount({ kind: 'bot', name });
    this.changed();
    return a;
  }

  deleteBot(id) {
    const a = this.account(id);
    if (a.kind !== 'bot') throw new Error('Only bots can be deleted');
    if (a.tableId || a.pendingReq) throw new Error('Leave the table first');
    this.accounts.delete(id);
    this.formerKinds.set(id, 'bot'); // its detection record stays, and the evaluation must still know it was a bot
    this.changed();
  }

  configureBot(id, patch) {
    const a = this.account(id);
    if (a.kind !== 'bot') throw new Error('Not a bot');
    a.config = patchBotConfig(a.config, patch && typeof patch === 'object' ? patch : {});
    this.changed();
  }

  setEnabled(id, value) {
    const a = this.account(id);
    a.enabled = value;
    if (a.tableId) {
      const t = this.table(a.tableId);
      if (value) { const s = t.seats[t.seatOf(id)]; if (s && s.stack + s.topUp > 0) s.sittingOut = false; this.resumeTurn(a); }
    }
    this.changed();
  }

  reload(id) {
    const a = this.account(id);
    a.connected = false;
    this.changed();
    this.later(1500, () => {
      a.connected = true;
      if (a.tableId) { const t = this.tables.get(a.tableId); t?.addLog(`${a.name} reconnected`); }
      this.resumeTurn(a);
      this.changed();
    });
  }

  resumeTurn(a) {
    const t = a.tableId && this.tables.get(a.tableId);
    if (!t?.hand) return;
    if (t.hand.phase === 'betting' && t.seats[t.hand.toAct]?.accountId === a.id) this.scheduleDecision(t, a);
    // Same rule as the ritOffer event: an 'optional' bot waits for the operator.
    if (t.hand.phase === 'rit' && !t.hand.rit.answers[a.id] && (a.kind === 'npc' || a.config.rit !== 'optional')) this.scheduleRit(t, a);
  }

  /* ---------- automated players ---------- */

  onTableEvent(type, d) {
    const t = d.table;
    if (type === 'turn') {
      const a = this.accounts.get(d.accountId);
      if (a && (a.kind === 'bot' || a.kind === 'npc')) this.scheduleDecision(t, a);
    } else if (type === 'action') {
      this.detection.onAction(d);
    } else if (type === 'ritOffer') {
      this.ritAskedAt.set(`${t.id}:${t.hand.no}`, Date.now());
      for (const id of d.accountIds) {
        const a = this.accounts.get(id);
        if (!a) continue;
        a.ritPending = t.id;
        if (a.kind === 'npc' || (a.kind === 'bot' && a.config.rit !== 'optional')) this.scheduleRit(t, a);
      }
    } else if (type === 'handEnd') {
      this.detection.onHandEnd(d.result, Date.now());
      for (const p of d.result.players) {
        const a = this.accounts.get(p.accountId);
        if (!a) continue;
        a.ritPending = null;
        if (a.tiltHands > 0) a.tiltHands--;
        const lost = p.total - p.won;
        if (lost > t.bb * 50) a.tiltHands = 12;
        if (a.kind === 'npc' && Math.random() < 0.25) {
          if (p.won - p.total > t.bb * 30) this.later(1200, () => this.pushChat(t.id, a.name, pick(NPC_CHAT.win)));
          else if (lost > t.bb * 30) this.later(1500, () => this.pushChat(t.id, a.name, pick(NPC_CHAT.lose)));
        }
      }
      this.afterHand(t);
    } else if (type === 'topUpRefund') {
      const a = this.accounts.get(d.accountId);
      if (a && a.kind !== 'npc') a.clubChips += d.amount;
    } else if (type === 'left') {
      const a = this.accounts.get(d.accountId);
      if (a) {
        a.tableId = null; a.ritPending = null;
        if (a.kind === 'npc') this.dropNpc(a);
        else a.clubChips += d.stack;
      }
      // 'left' only fires outside a running hand (or right before the next deal), so seat the queue now.
      this.seatFromQueue(t.id);
    }
    this.changed();
  }

  afterHand(t) {
    // Runs just after settlement, before the next hand starts.
    for (const s of t.seats) {
      if (!s) continue;
      const a = this.accounts.get(s.accountId);
      if (!a) continue;
      if (a.kind === 'bot' && a.config.autoTopUp && s.stack < t.maxBuyIn * 0.6 && !s.leaving) {
        const need = Math.min(t.maxBuyIn - s.stack - s.topUp, a.clubChips);
        if (need > 0) { t.topUp(a.id, need); a.clubChips -= need; }
      }
      if (a.kind === 'npc') {
        a.handsHere = (a.handsHere || 0) + 1;
        const busted = s.stack + s.topUp < t.bb * 5;
        if (busted && Math.random() < 0.6) s.topUp += t.bb * (40 + Math.floor(Math.random() * 60)) - s.stack, s.sittingOut = false;
        else if (busted || (a.handsHere > 40 && Math.random() < 0.02)) s.leaving = true;
        else if (!s.sittingOut && Math.random() < 0.01) { s.sittingOut = true; this.later(20000 + Math.random() * 40000, () => { if (t.seats[t.seatOf(a.id)]) t.seats[t.seatOf(a.id)].sittingOut = false; }); }
      }
    }
  }

  scheduleDecision(t, a) {
    const handNo = t.hand.no, street = t.hand.street, seat = t.seatOf(a.id);
    let delay;
    if (a.kind === 'bot') {
      if (!a.enabled || !a.connected) return; // an off/disconnected bot simply times out
      delay = (a.config.thinkMin + Math.random() * (a.config.thinkMax - a.config.thinkMin)) * 1000;
    } else {
      // Humans: log-normal think time, occasional long tanks on big decisions.
      const L = t.legal(seat);
      const big = L.toCall > L.pot * 0.5;
      delay = Math.min(12000, lognormal(big ? 2.6 : 1.3, 0.65) * 1000);
    }
    // Only the latest timer may act: toggling a bot off and on mid-turn must not leave an early one behind.
    const token = a.turnToken = {};
    this.later(delay, () => {
      const h = t.hand;
      if (a.turnToken !== token || !h || h.no !== handNo || h.phase !== 'betting' || h.toAct !== seat || h.street !== street) return;
      if (a.kind === 'bot' && (!a.enabled || !a.connected)) return;
      const p = h.players.get(seat), L = t.legal(seat);
      const live = t.livePlayers();
      const { action, why } = decide(a.config, {
        hole: p.hole, board: h.board, legal: L, street,
        opponents: live.length - 1, position: positionOf(t, seat), bb: t.bb,
        tilt: a.tiltHands > 0,
        opp: this.detection.foldToBet(live.filter(x => x.seat !== seat).map(x => x.accountId)),
      });
      let done = action;
      try { t.act(a.id, action); } catch { done = { type: L.canCheck ? 'check' : 'fold' }; try { t.act(a.id, done); } catch {} }
      if (a.kind === 'bot') a.lastDecision = { why, ...resolved(done, L), at: Date.now(), street, handNo, tableId: t.id };
      this.changed();
    });
  }

  scheduleRit(t, a) {
    const handNo = t.hand.no, token = a.turnToken = {};
    const delay = a.kind === 'bot' ? 1000 + Math.random() * 1000 : lognormal(2.2, 0.5) * 1000;
    this.later(delay, () => {
      const h = t.hand;
      if (a.turnToken !== token || !h || h.no !== handNo || h.phase !== 'rit' || h.rit.answers[a.id]) return;
      if (a.kind === 'bot' && (!a.enabled || !a.connected)) return;
      const p = h.players.get(t.seatOf(a.id));
      const eq = p ? equity(p.hole, h.board, Math.max(1, t.livePlayers().length - 1), 150) : 0.5;
      try { this.answerRit(a.id, decideRit(a.config, eq)); } catch {}
    });
  }

  /* ---------- clock ---------- */

  tick(now = Date.now()) {
    for (const t of this.tables.values()) {
      const before = `${t.hand?.no}:${t.hand?.phase}:${t.hand?.street}:${t.hand?.toAct}`;
      try { t.tick(now); } catch (e) { console.error(`table ${t.id} tick failed:`, e); }
      if (before !== `${t.hand?.no}:${t.hand?.phase}:${t.hand?.street}:${t.hand?.toAct}`) this.changed();
    }
    // Simulated players drift in and out of the club.
    if (this.settings.npcTraffic && now - (this.lastTraffic || 0) > 25000) {
      this.lastTraffic = now;
      const target = [...this.tables.values()].filter(t => t.seats.filter(Boolean).length < 6 && t.seats.filter(Boolean).length > 0 || t.id === '48353983' && Math.random() < 0.2);
      if (target.length && Math.random() < 0.7) {
        const t = pick(target);
        const a = this.newNpc();
        try { this.requestSeat(a.id, t.id, t.bb * (40 + Math.floor(Math.random() * 60))); } catch { this.dropNpc(a); }
      }
    }
    // Simulated players give up on requests the host ignores.
    for (const r of [...this.requests]) {
      const a = this.accounts.get(r.accountId);
      if (a?.kind === 'npc' && now - r.at > 90000) {
        this.requests.splice(this.requests.indexOf(r), 1);
        this.addHistory({ name: a.name, pid: a.pid, amount: r.amount, tableId: r.tableId, at: now, status: 'Expired', accountId: a.id });
        this.dropNpc(a);
        this.changed();
      }
    }
    // Detection changes the throttled report hasn't shown yet still need one more broadcast.
    if (this.detection.stale && now - this.detection.reportAt >= 1000) this.dirty = true;
  }

  later(ms, fn) {
    const h = setTimeout(() => {
      this.timers.delete(h);
      try { fn(); } catch (e) { console.error('scheduled task failed:', e); }
    }, ms);
    this.timers.add(h);
  }

  changed() { this.dirty = true; this.onChange(); this.save(); }

  stop() { for (const h of this.timers) clearTimeout(h); clearTimeout(this.saveTimer); this.saveTimer = null; }

  /* ---------- snapshot for the UI ---------- */

  snapshot() {
    const seated = new Set();
    const tables = [...this.tables.values()].map(t => {
      const h = t.hand;
      const seats = t.seats.map((s, i) => {
        if (!s) return null;
        seated.add(s.accountId);
        const a = this.accounts.get(s.accountId);
        // Someone new in this seat must not inherit the previous occupant's hand entry (and cards).
        const p0 = h?.players.get(i), p = p0?.accountId === s.accountId ? p0 : undefined;
        const showCards = p && (a?.kind !== 'npc' || h.shown.has(i));
        return {
          seat: i, accountId: s.accountId, name: s.name, kind: a?.kind, stack: s.stack, topUp: s.topUp,
          sittingOut: s.sittingOut, leaving: s.leaving, lastAction: s.lastAction,
          inHand: !!p, folded: p?.folded ?? false, allIn: p?.allIn ?? false, committed: p?.committed ?? 0,
          hole: showCards ? p.hole.map(cardStr) : null, shown: !!p && h.shown.has(i),
          maxTopUp: t.topUpRoom(i), busted: !t.hasChips(i),
        };
      });
      return {
        id: t.id, name: t.name, sb: t.sb, bb: t.bb, minBuyIn: t.minBuyIn, maxBuyIn: t.maxBuyIn, createdAt: t.createdAt,
        rakePct: t.rakePct, rakeCap: t.rakeCap, actionTime: t.actionTimeMs, rakeCollected: t.rakeCollected,
        seats, button: t.button, handNo: t.handNo,
        hand: h && {
          no: h.no, phase: h.phase, street: h.street, board: h.board.map(cardStr),
          boards: h.boards && h.phase === 'done' ? h.boards.map(b => b.map(cardStr)) : null,
          pot: [...h.players.values()].reduce((x, p) => x + p.total, 0),
          toAct: h.toAct, deadline: h.deadline, currentBet: h.currentBet,
          rit: h.rit && { deadline: h.rit.deadline, answers: h.rit.answers, result: h.rit.result || null },
          winners: h.winners, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
          legal: h.phase === 'betting' && h.toAct >= 0 ? t.legal(h.toAct) : null,
        },
        log: t.log.slice(-40), chat: this.chats.get(t.id).slice(-40),
        results: t.results.slice(0, 8).map(r => ({ no: r.no, rake: r.rake, winners: r.winners })),
      };
    });
    const accounts = [...this.accounts.values()].map(a => ({
      id: a.id, kind: a.kind, name: a.name, pid: a.pid, clubChips: a.clubChips, enabled: a.enabled, connected: a.connected,
      config: a.kind === 'bot' ? a.config : null, npcProfile: a.kind === 'npc' ? a.config : null,
      // A simulated player's reasons quote its equity, which would leak its hidden cards.
      tableId: a.tableId, pendingReq: a.pendingReq, lastDecision: a.kind === 'bot' ? a.lastDecision : null, tilt: a.tiltHands > 0, ritPending: a.ritPending,
      queued: this.queue.some(q => q.accountId === a.id),
      requestTable: this.requests.find(r => r.accountId === a.id)?.tableId || this.queue.find(q => q.accountId === a.id)?.tableId || null,
    }));
    const nameOf = id => this.accounts.get(id)?.name || '—';
    return {
      now: Date.now(), club: CLUB, settings: this.settings,
      skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { label: v.label, desc: v.desc }])),
      styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, { label: v.label, desc: v.desc }])),
      accounts, tables,
      // Ground truth for the detection evaluation, including accounts that no longer exist.
      truth: Object.fromEntries([...this.formerKinds, ...[...this.accounts.values()].map(a => [a.id, a.kind])]),
      requests: this.requests.map(r => ({ ...r, name: nameOf(r.accountId), pid: this.accounts.get(r.accountId)?.pid, kind: this.accounts.get(r.accountId)?.kind })),
      queue: this.queue.map(q => ({ ...q, name: nameOf(q.accountId), pid: this.accounts.get(q.accountId)?.pid })),
      history: this.history.slice(0, 40).map(h => ({ ...h, kind: this.kindOf(h.accountId) ?? (h.accountId && 'gone') })),
      detection: this.detection.report(seated),
    };
  }
}
