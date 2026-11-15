// Pot-limit Omaha (4-card) cash table. All money is integer cents.
// Time is passed in explicitly (tick(now)) so the engine is deterministic under test.
import { freshDeck, shuffle, cardStr } from './cards.js';
import { bestOmaha, categoryOf, CATEGORY } from './evaluator.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const RESULT_PAUSE_MS = 3500;
const RUNOUT_STEP_MS = 900;
const RIT_WINDOW_MS = 6000;

export class Table {
  constructor({ id, name, sb, bb, maxSeats = 8, minBuyInBB = 20, maxBuyInBB = 100,
    rakePct = 0.069, rakeCap = 799, actionTimeMs = 15000, onEvent = () => {} }) {
    Object.assign(this, { id, name, sb, bb, maxSeats, minBuyInBB, maxBuyInBB, rakePct, rakeCap, actionTimeMs, onEvent });
    this.seats = Array(maxSeats).fill(null);
    this.button = -1;
    this.hand = null;
    this.handNo = 0;
    this.nextHandAt = 0;
    this.log = [];
    this.results = [];
    this.rakeCollected = 0;
  }

  get minBuyIn() { return this.bb * this.minBuyInBB; }
  get maxBuyIn() { return this.bb * this.maxBuyInBB; }

  /* ---------- seating ---------- */

  seatOf(accountId) { return this.seats.findIndex(s => s?.accountId === accountId); }
  emptySeats() { return this.seats.map((s, i) => s ? -1 : i).filter(i => i >= 0); }

  sit(accountId, name, amount, seatIndex) {
    if (this.seatOf(accountId) !== -1) throw new Error('Already seated at this table');
    if (seatIndex != null && !(Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex < this.maxSeats))
      throw new Error('Invalid seat');
    if (amount < this.minBuyIn || amount > this.maxBuyIn)
      throw new Error(`Buy-in must be between ${this.minBuyIn / 100} and ${this.maxBuyIn / 100}`);
    const free = this.emptySeats();
    if (!free.length) throw new Error('Table is full');
    const idx = seatIndex ?? free[0];
    if (this.seats[idx]) throw new Error('Seat taken');
    this.seats[idx] = { accountId, name, stack: amount, sittingOut: false, leaving: false, topUp: 0, lastAction: null };
    this.addLog(`${name} sits down with ${fmt(amount)}`);
    return idx;
  }

  // Leaves now if not in the current hand. Otherwise the seat is freed by cleanupAfterHand (never mid-hand, so a
  // newcomer can't inherit this hand's entry): a player with a betting decision left folds now, while an all-in
  // player (or one waiting on run-it-twice / the runout) stays in and is paid what they win.
  // Returns the stack cashed out, or null if the leave is deferred.
  stand(accountId, now = Date.now()) {
    const i = this.seatOf(accountId);
    if (i === -1) return 0;
    const h = this.hand, s = this.seats[i], p = h?.players.get(i);
    if (!p) return this.removeSeat(i);
    if (s.leaving) return null;
    s.leaving = true;
    if (p.folded) return null;
    if (h.phase === 'betting' && !p.allIn) {
      if (h.toAct === i) this.act(accountId, { type: 'fold' }, now);
      else p.folded = true, this.afterFoldOutOfTurn(i, now);
    } else if (h.phase === 'rit') this.answerRit(accountId, 'once');
    return null;
  }

  removeSeat(i) {
    const s = this.seats[i];
    this.seats[i] = null;
    this.addLog(`${s.name} leaves the table`);
    this.onEvent('left', { table: this, accountId: s.accountId, stack: s.stack + s.topUp });
    return s.stack + s.topUp;
  }

  setSittingOut(accountId, value) {
    const i = this.seatOf(accountId);
    if (i === -1) throw new Error('Not seated');
    this.seats[i].sittingOut = value;
    this.addLog(`${this.seats[i].name} ${value ? 'sits out' : 'is back'}`);
  }

  // Chips added mid-hand are applied when the next hand starts.
  topUp(accountId, amount) {
    const i = this.seatOf(accountId);
    if (i === -1) throw new Error('Not seated');
    const room = this.topUpRoom(i);
    if (amount > room) throw new Error(`Max top-up right now is ${fmt(room)}`);
    this.seats[i].topUp += amount;
  }

  // Chips still live in the pot count as stack, or winning them back would lift the next stack past the max.
  // Folded chips are gone, so they don't.
  topUpRoom(i) {
    const s = this.seats[i], h = this.hand;
    const p = h && h.phase !== 'done' ? h.players.get(i) : null;
    const inPot = p && p.accountId === s.accountId && !p.folded ? p.total : 0;
    return Math.max(0, this.maxBuyIn - s.stack - inPot - s.topUp);
  }

  // Still has chips that can play: behind, pending, or live in the running hand.
  hasChips(i) {
    const s = this.seats[i], h = this.hand;
    const p = h && h.phase !== 'done' ? h.players.get(i) : null;
    return s.stack + s.topUp > 0 || !!(p && p.accountId === s.accountId && !p.folded);
  }

  /* ---------- hand lifecycle ---------- */

  eligibleSeats() {
    return this.seats.map((s, i) => (s && !s.sittingOut && !s.leaving && s.stack + s.topUp > 0 ? i : -1)).filter(i => i >= 0);
  }

  nextFrom(i, pred) {
    for (let k = 1; k <= this.maxSeats; k++) {
      const j = (i + k) % this.maxSeats;
      if (pred(j)) return j;
    }
    return -1;
  }

  startHand(now) {
    for (const s of this.seats) if (s) {
      // Winning a pot after topping up can leave no room for the whole top-up; the excess goes back to the account.
      const add = Math.min(s.topUp, Math.max(0, this.maxBuyIn - s.stack));
      if (add < s.topUp) {
        this.addLog(`${s.name}'s top-up is capped at the max buy-in (${fmt(s.topUp - add)} returned)`);
        this.onEvent('topUpRefund', { table: this, accountId: s.accountId, amount: s.topUp - add });
      }
      s.stack += add; s.topUp = 0; s.lastAction = null;
    }
    const elig = this.eligibleSeats();
    if (elig.length < 2) { this.hand = null; return false; }

    this.handNo++;
    const inHand = new Set(elig);
    this.button = this.nextFrom(this.button, j => inHand.has(j));
    const deck = shuffle(freshDeck());
    const players = new Map();
    for (const i of elig) {
      players.set(i, { seat: i, accountId: this.seats[i].accountId, hole: deck.splice(0, 4),
        committed: 0, total: 0, folded: false, allIn: false, acted: false, faced: 0, vpip: false, pfr: false });
    }
    const h = this.hand = {
      no: this.handNo, deck, board: [], boards: null, street: 0, players,
      currentBet: 0, minRaise: this.bb,
      toAct: -1, turnStartedAt: 0, deadline: 0, phase: 'betting',
      rit: null, sawFlop: false, winners: null, shown: new Set(),
    };

    let sbSeat, bbSeat;
    if (elig.length === 2) { sbSeat = this.button; bbSeat = this.nextFrom(sbSeat, j => inHand.has(j)); }
    else { sbSeat = this.nextFrom(this.button, j => inHand.has(j)); bbSeat = this.nextFrom(sbSeat, j => inHand.has(j)); }
    this.post(sbSeat, this.sb);
    this.post(bbSeat, this.bb);
    // A short all-in blind doesn't lower the price: everyone else still calls the full big blind.
    h.currentBet = this.bb;
    h.sbSeat = sbSeat; h.bbSeat = bbSeat;

    this.addLog(`— Hand #${h.no} — button: ${this.seats[this.button].name}`);
    this.onEvent('handStart', { table: this, seats: [...players.keys()] });
    this.setTurn(this.findNextToAct(bbSeat), now);
    return true;
  }

  post(i, amount) {
    const s = this.seats[i], p = this.hand.players.get(i);
    const amt = Math.min(amount, s.stack);
    s.stack -= amt; p.committed += amt; p.total += amt;
    if (s.stack === 0) p.allIn = true;
  }

  needsAction(p) {
    const h = this.hand;
    if (p.folded || p.allIn) return false;
    const others = [...h.players.values()].filter(q => q !== p && !q.folded);
    // Nobody left who could answer a raise: only a bigger bet this street (a folded leaver's included) is still a decision.
    if (others.every(q => q.allIn)) return [...h.players.values()].some(q => q !== p && q.committed > p.committed);
    return !p.acted || p.committed < h.currentBet;
  }

  findNextToAct(from) {
    const h = this.hand;
    const j = this.nextFrom(from, k => h.players.has(k) && this.needsAction(h.players.get(k)));
    return j;
  }

  setTurn(seat, now) {
    const h = this.hand;
    if (seat === -1) return this.endStreet(now);
    h.toAct = seat;
    h.turnStartedAt = now;
    h.deadline = now + this.actionTimeMs;
    this.onEvent('turn', { table: this, seat, accountId: this.seats[seat].accountId, legal: this.legal(seat) });
  }

  livePlayers() { return [...this.hand.players.values()].filter(p => !p.folded); }

  legal(seat) {
    const h = this.hand, p = h.players.get(seat), s = this.seats[seat];
    const toCall = Math.min(h.currentBet - p.committed, s.stack);
    const potTotal = [...h.players.values()].reduce((a, q) => a + q.total, 0);
    const cap = p.committed + s.stack;
    const othersCanAct = [...h.players.values()].some(q => q !== p && !q.folded && !q.allIn);
    // Reopened by at least one full raise since they last acted — several short all-ins can add up to one.
    const reopened = !p.acted || h.currentBet - p.faced >= h.minRaise;
    const canRaise = s.stack > toCall && othersCanAct && reopened;
    const potMax = h.currentBet + potTotal + (h.currentBet - p.committed);
    const maxTo = Math.min(potMax, cap);
    let minTo = h.currentBet === 0 ? this.bb : h.currentBet + Math.max(h.minRaise, this.bb);
    minTo = Math.min(minTo, cap);
    return { toCall, canCheck: toCall === 0, canRaise, minTo, maxTo, committed: p.committed,
      stack: s.stack, pot: potTotal, currentBet: h.currentBet, isBet: h.currentBet === 0 };
  }

  act(accountId, action, now = Date.now()) {
    const h = this.hand;
    if (!h || h.phase !== 'betting') throw new Error('No action expected right now');
    const seat = this.seatOf(accountId);
    if (seat !== h.toAct) throw new Error('Not your turn');
    const p = h.players.get(seat), s = this.seats[seat];
    const L = this.legal(seat);
    let type = action.type;
    if (type === 'check' && !L.canCheck) throw new Error('Cannot check — there is a bet to call');
    if (type === 'call' && L.toCall === 0) type = 'check';
    if ((type === 'raise' || type === 'bet') && !L.canRaise) type = L.toCall ? 'call' : 'check';

    let label;
    if (type === 'fold') {
      p.folded = true; label = 'folds';
    } else if (type === 'check') {
      label = 'checks';
    } else if (type === 'call') {
      const amt = L.toCall;
      s.stack -= amt; p.committed += amt; p.total += amt;
      if (s.stack === 0) p.allIn = true;
      label = `calls ${fmt(amt)}${p.allIn ? ' (all-in)' : ''}`;
      if (h.street === 0) p.vpip = true;
    } else if (type === 'raise' || type === 'bet') {
      let to = Math.round(action.amount);
      if (!Number.isFinite(to)) throw new Error('Raise amount required');
      to = Math.max(L.minTo, Math.min(L.maxTo, to));
      const put = to - p.committed;
      s.stack -= put; p.committed = to; p.total += put;
      if (s.stack === 0) p.allIn = true;
      const inc = to - h.currentBet;
      if (inc >= h.minRaise) h.minRaise = inc;
      label = `${L.isBet ? 'bets' : 'raises to'} ${fmt(to)}${p.allIn ? ' (all-in)' : ''}`;
      h.currentBet = Math.max(h.currentBet, to);
      if (h.street === 0) { p.vpip = true; p.pfr = true; }
    } else throw new Error(`Unknown action ${type}`);

    p.acted = true;
    p.faced = h.currentBet;
    s.lastAction = label.split(' ')[0];
    this.addLog(`${s.name} ${label}`);
    this.onEvent('action', { table: this, seat, accountId, type, street: h.street, ms: now - h.turnStartedAt, legal: L, label });

    if (this.livePlayers().length === 1) return this.finishHand(now);
    this.setTurn(this.findNextToAct(seat), now);
  }

  // A player left mid-hand while it wasn't their turn.
  afterFoldOutOfTurn(seat, now) {
    const h = this.hand;
    this.addLog(`${this.seats[seat].name} folds`);
    if (this.livePlayers().length === 1) return this.finishHand(now);
    // The player to act may be left with nobody who could respond (e.g. only all-ins remain).
    if (!this.needsAction(h.players.get(h.toAct))) this.setTurn(this.findNextToAct(h.toAct), now);
  }

  endStreet(now) {
    const h = this.hand;
    for (const p of h.players.values()) { p.committed = 0; p.acted = false; p.faced = 0; }
    h.currentBet = 0; h.minRaise = this.bb; h.toAct = -1;

    const live = this.livePlayers();
    const canAct = live.filter(p => !p.allIn);
    if (h.street === 3) return this.finishHand(now);

    if (canAct.length <= 1) {
      // Nobody left to bet: offer run-it-twice (if more than one card to come... or any card to come), then run it out.
      h.phase = 'rit';
      h.rit = { answers: {}, deadline: now + RIT_WINDOW_MS };
      // Someone already leaving isn't asked; they run it once.
      const asked = live.filter(p => !this.seats[p.seat].leaving);
      for (const p of live) if (!asked.includes(p)) h.rit.answers[p.accountId] = 'once';
      this.addLog('All-in — run it twice?');
      this.onEvent('ritOffer', { table: this, accountIds: asked.map(p => p.accountId) });
      return;
    }
    this.dealStreet();
    this.setTurn(this.nextFrom(this.button, k => h.players.has(k) && this.needsAction(h.players.get(k))), now);
  }

  dealStreet() {
    const h = this.hand;
    h.street++;
    h.deck.shift(); // burn
    const n = h.street === 1 ? 3 : 1;
    h.board.push(...h.deck.splice(0, n));
    if (h.street === 1) h.sawFlop = true;
    this.addLog(`${STREETS[h.street][0].toUpperCase() + STREETS[h.street].slice(1)}: ${h.board.map(cardStr).join(' ')}`);
    this.onEvent('street', { table: this, street: h.street });
  }

  answerRit(accountId, choice) {
    const h = this.hand;
    if (!h || h.phase !== 'rit') throw new Error('No run-it-twice decision pending');
    const seat = this.seatOf(accountId);
    const p = h.players.get(seat);
    if (!p || p.folded) throw new Error('Not in this pot');
    if (h.rit.answers[accountId]) return;
    h.rit.answers[accountId] = choice === 'twice' ? 'twice' : 'once';
    this.addLog(`${this.seats[seat].name} chooses run it ${h.rit.answers[accountId]}`);
  }

  resolveRit() {
    const h = this.hand;
    const live = this.livePlayers();
    const twice = live.every(p => h.rit.answers[p.accountId] === 'twice') && h.street < 3;
    h.rit.result = twice ? 'twice' : 'once';
    h.phase = 'runout';
    h.runoutStep = 0;
    if (twice) {
      this.addLog('Running it twice');
      // Deal board 2 from the same deck, after board 1's cards.
      const remaining = 5 - h.board.length;
      const deckCopy = h.deck.slice();
      const b1 = h.board.slice(), b2 = h.board.slice();
      let k = 0;
      const burn = () => k++;
      const draw = () => deckCopy[k++];
      const streetsLeft = 3 - h.street;
      for (let s = 0; s < streetsLeft; s++) { burn(); const n = h.street + s === 0 ? 3 : 1; for (let i = 0; i < n; i++) b1.push(draw()); }
      for (let s = 0; s < streetsLeft; s++) { burn(); const n = h.street + s === 0 ? 3 : 1; for (let i = 0; i < n; i++) b2.push(draw()); }
      if (b1.length !== 5 || b2.length !== 5 || remaining < 1) throw new Error('bad run-it-twice runout');
      h.boards = [b1, b2];
    }
  }

  runoutStep(now) {
    const h = this.hand;
    if (h.boards) {
      h.board = h.boards[0];
      h.street = 3; h.sawFlop = true;
      this.addLog(`Board 1: ${h.boards[0].map(cardStr).join(' ')}`);
      this.addLog(`Board 2: ${h.boards[1].map(cardStr).join(' ')}`);
      return this.finishHand(now);
    }
    this.dealStreet();
    if (h.street === 3) return this.finishHand(now);
    h.nextStepAt = now + RUNOUT_STEP_MS;
  }

  /* ---------- settlement ---------- */

  // { uncalled: { seat, amount } | null, pots: [{ amount, eligible }] }. The biggest live contribution's excess
  // over everyone else's (folded players included) was never called, so it goes back unraked and isn't "won".
  buildPots() {
    const h = this.hand;
    const contrib = [...h.players.values()].map(p => ({ seat: p.seat, amt: p.total, folded: p.folded }));
    const [top, second] = [...contrib].sort((a, b) => b.amt - a.amt);
    let uncalled = null;
    if (!top.folded && top.amt > (second?.amt || 0)) {
      uncalled = { seat: top.seat, amount: top.amt - (second?.amt || 0) };
      top.amt -= uncalled.amount;
    }
    const pots = [];
    while (true) {
      const live = contrib.filter(c => !c.folded && c.amt > 0);
      if (!live.length) break;
      const m = Math.min(...live.map(c => c.amt));
      let amount = 0;
      for (const c of contrib) { const take = Math.min(c.amt, m); amount += take; c.amt -= take; }
      pots.push({ amount, eligible: live.map(c => c.seat) });
    }
    // Folded chips above every live stake are dead money for the last pot — or for whoever is left, when
    // they have nothing in (e.g. both blinds leave before the button acts).
    const rest = contrib.reduce((a, c) => a + c.amt, 0);
    if (rest && pots.length) pots[pots.length - 1].amount += rest;
    else if (rest) pots.push({ amount: rest, eligible: this.livePlayers().map(p => p.seat) });
    return { uncalled, pots };
  }

  // Winners for one board, ordered clockwise from the first seat left of the button (odd chips go first).
  winnersOn(board, eligible) {
    const h = this.hand;
    let best = -1, win = [];
    for (const seat of eligible) {
      const sc = bestOmaha(h.players.get(seat).hole, board);
      if (sc > best) { best = sc; win = [seat]; } else if (sc === best) win.push(seat);
    }
    const order = s => (s - this.button - 1 + 2 * this.maxSeats) % this.maxSeats;
    win.sort((a, b) => order(a) - order(b));
    return { seats: win, score: best };
  }

  finishHand(now) {
    const h = this.hand;
    h.phase = 'done';
    h.toAct = -1;
    const { uncalled, pots } = this.buildPots();
    const payouts = new Map();
    const pay = (seat, amt) => payouts.set(seat, (payouts.get(seat) || 0) + amt);
    if (uncalled) {
      pay(uncalled.seat, uncalled.amount);
      this.addLog(`Uncalled ${fmt(uncalled.amount)} returned to ${this.seats[uncalled.seat].name}`);
    }

    // No flop, no drop.
    let rake = 0;
    if (h.sawFlop && pots.length) {
      const gross = pots.reduce((a, p) => a + p.amount, 0);
      rake = Math.min(this.rakeCap, Math.floor(gross * this.rakePct));
      let left = rake;
      for (const p of pots) { const t = Math.min(left, p.amount); p.amount -= t; left -= t; }
    }

    const live = this.livePlayers();
    const summary = [];
    if (live.length === 1) {
      const seat = live[0].seat, won = pots.reduce((a, p) => a + p.amount, 0);
      if (won) pay(seat, won);
      summary.push({ seat, name: this.seats[seat].name, amount: won, hand: null });
    } else {
      const boards = h.boards || [h.board];
      for (const pot of pots) {
        const parts = boards.length === 2 ? [Math.floor(pot.amount / 2), pot.amount - Math.floor(pot.amount / 2)] : [pot.amount];
        parts.forEach((amt, bi) => {
          const { seats, score } = this.winnersOn(boards[bi], pot.eligible);
          const each = Math.floor(amt / seats.length);
          let odd = amt - each * seats.length;
          for (const s of seats) {
            const won = each + (odd-- > 0 ? 1 : 0);
            pay(s, won);
            summary.push({ seat: s, name: this.seats[s].name, amount: won, hand: CATEGORY[categoryOf(score)], board: boards.length === 2 ? bi + 1 : null });
          }
        });
      }
      for (const p of live) h.shown.add(p.seat);
    }

    const paid = [...payouts.values()].reduce((a, b) => a + b, 0);
    const putIn = [...h.players.values()].reduce((a, p) => a + p.total, 0);
    if (paid + rake !== putIn) throw new Error(`Hand #${h.no} settles ${fmt(paid + rake)} of ${fmt(putIn)}`);
    this.rakeCollected += rake;
    for (const [seat, amt] of payouts) this.seats[seat].stack += amt;
    // Merge summary lines per seat/board for the log.
    const merged = new Map();
    for (const w of summary) {
      const k = `${w.seat}:${w.board}`;
      const m = merged.get(k);
      if (m) m.amount += w.amount; else merged.set(k, { ...w });
    }
    h.winners = [...merged.values()];
    for (const w of h.winners)
      this.addLog(`${w.name} wins ${fmt(w.amount)}${w.hand ? ` with ${w.hand}` : ''}${w.board ? ` (board ${w.board})` : ''}`);
    if (rake) this.addLog(`Rake: ${fmt(rake)}`);

    const result = { no: h.no, rake, winners: h.winners, payouts: Object.fromEntries(payouts),
      contributions: Object.fromEntries([...h.players.values()].map(p => [p.seat, p.total])),
      players: [...h.players.values()].map(p => ({ seat: p.seat, accountId: p.accountId, vpip: p.vpip, pfr: p.pfr, folded: p.folded, total: p.total, won: payouts.get(p.seat) || 0 })) };
    this.results.unshift(result);
    this.results.length = Math.min(this.results.length, 20);
    this.onEvent('handEnd', { table: this, result });
    this.nextHandAt = now + RESULT_PAUSE_MS;
  }

  cleanupAfterHand() {
    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[i];
      if (!s) continue;
      if (s.leaving) this.removeSeat(i);
      else if (s.stack + s.topUp === 0) { s.sittingOut = true; }
    }
  }

  /* ---------- clock ---------- */

  tick(now) {
    const h = this.hand;
    if (!h) {
      if (now >= this.nextHandAt) this.startHand(now) || (this.nextHandAt = now + 1000);
      return;
    }
    if (h.phase === 'betting' && now >= h.deadline) {
      const seat = h.toAct;
      const s = this.seats[seat];
      this.addLog(`${s.name} timed out`);
      const L = this.legal(seat);
      s.sittingOut = true;
      this.onEvent('timeout', { table: this, accountId: s.accountId });
      this.act(s.accountId, { type: L.canCheck ? 'check' : 'fold' }, now);
    } else if (h.phase === 'rit') {
      const live = this.livePlayers();
      const allAnswered = live.every(p => h.rit.answers[p.accountId]);
      if (allAnswered || now >= h.rit.deadline) {
        for (const p of live) h.rit.answers[p.accountId] ||= 'once';
        this.resolveRit();
        h.nextStepAt = now + RUNOUT_STEP_MS;
      }
    } else if (h.phase === 'runout' && now >= h.nextStepAt) {
      this.runoutStep(now);
    } else if (h.phase === 'done' && now >= this.nextHandAt) {
      this.hand = null;
      this.cleanupAfterHand();
      this.startHand(now) || (this.nextHandAt = now + 1000);
    }
  }

  addLog(line) {
    this.log.push(line);
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
  }

  // Total chips owned by the table (stacks + pending top-ups + in the pot) — used by invariant tests.
  chipsOnTable() {
    let t = 0;
    for (const s of this.seats) if (s) t += s.stack + s.topUp;
    if (this.hand && this.hand.phase !== 'done') for (const p of this.hand.players.values()) t += p.total;
    return t;
  }
}

export const fmt = c => (c / 100).toFixed(2).replace(/\.?0+$/, '');
