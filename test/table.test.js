import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../server/table.js';
import { parseCards, freshDeck } from '../server/cards.js';

function makeTable(n, stack = 10000, opts = {}) {
  const events = [];
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, onEvent: (type, d) => events.push([type, d]), ...opts });
  const stacks = Array.isArray(stack) ? stack : Array(n).fill(stack);
  for (let i = 0; i < n; i++) t.sit(`p${i}`, `P${i}`, stacks[i]);
  return { t, events };
}

// Whoever is to act does `type`.
const act = (t, type, amount, now = 0) => t.act(t.seats[t.hand.toAct].accountId, { type, amount }, now);

// Fix the hole cards and the five board cards of a hand that has just started.
function rig(t, holes, board) {
  const h = t.hand, used = new Set();
  for (const [seat, cards] of Object.entries(holes)) { h.players.get(+seat).hole = parseCards(cards); parseCards(cards).forEach(c => used.add(c)); }
  const b = parseCards(board); b.forEach(c => used.add(c));
  const rest = freshDeck().filter(c => !used.has(c));
  h.deck = [rest.shift(), b[0], b[1], b[2], rest.shift(), b[3], rest.shift(), b[4], ...rest];
}

// Tick until the hand is settled; returns the clock.
function settle(t, now = 0) {
  while (t.hand && t.hand.phase !== 'done') t.tick(now += 1000);
  return now;
}

const cashedOut = events => events.filter(([type]) => type === 'left').reduce((a, [, d]) => a + d.stack, 0);

test('blinds and first to act (3-handed)', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  const h = t.hand;
  assert.equal(h.players.get(h.sbSeat).total, 50);
  assert.equal(h.players.get(h.bbSeat).total, 100);
  assert.equal(h.toAct, t.button, '3-handed: button acts first preflop');
});

test('heads-up: button posts SB and acts first preflop', () => {
  const { t } = makeTable(2);
  t.startHand(0);
  assert.equal(t.hand.sbSeat, t.button);
  assert.equal(t.hand.toAct, t.button);
});

test('pot-limit maximum raise', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  // Pot is 150; UTG calls 100 then raises pot: 100 + (150 + 100) = 350
  const L = t.legal(t.hand.toAct);
  assert.equal(L.maxTo, 350);
  assert.equal(L.minTo, 200);
});

test('fold to the big blind returns the pot with no rake', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  const first = t.hand.toAct;
  t.act(t.seats[first].accountId, { type: 'fold' });
  t.act(t.seats[t.hand.toAct].accountId, { type: 'fold' });
  assert.equal(t.hand.phase, 'done');
  assert.equal(t.results[0].rake, 0, 'no flop, no drop');
  assert.equal(t.chipsOnTable(), 30000);
});

test('side pots: short all-in can only win the main pot', () => {
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, rakePct: 0 });
  t.sit('short', 'Short', 2000);
  t.sit('a', 'A', 10000);
  t.sit('b', 'B', 10000);
  t.startHand(0);
  // Everyone gets it in.
  let guard = 0;
  while (t.hand.phase === 'betting' && guard++ < 50) {
    const seat = t.hand.toAct, L = t.legal(seat);
    t.act(t.seats[seat].accountId, L.canRaise ? { type: 'raise', amount: L.maxTo } : { type: 'call' });
  }
  const { pots } = t.buildPots();
  assert.equal(pots[0].amount, 6000, 'main pot = 3 × 2000');
  assert.equal(pots[0].eligible.length, 3);
  assert.ok(pots.slice(1).every(p => !p.eligible.includes(0)), 'short stack is not eligible for side pots');
});

// Random play with leaves (in every phase, all-ins included), sit-outs, mid-hand top-ups and timeouts mixed in.
// Chips must be conserved exactly: bought in = on the table + rake + cashed out + refunded top-ups.
test('fuzz: chip conservation over 3000 random hands', () => {
  let out = 0, refunded = 0, refunds = 0;
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, maxBuyInBB: 200, minBuyInBB: 20,
    onEvent: (type, d) => { if (type === 'left') out += d.stack; else if (type === 'topUpRefund') refunded += d.amount, refunds++; } });
  const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const rnd = n => Math.floor(Math.random() * n);
  let broughtIn = 0, now = 0, steps = 0, ritTwice = 0, timeouts = 0;
  const stood = { allIn: 0, betting: 0, rit: 0, runout: 0, done: 0 };
  const sitSomeone = () => {
    const free = t.emptySeats(), idle = ids.filter(id => t.seatOf(id) === -1);
    if (!free.length || !idle.length) return;
    const amt = 2000 + rnd(18001);
    t.sit(idle[rnd(idle.length)], 'X', amt, free[rnd(free.length)]);
    broughtIn += amt;
  };

  while (t.handNo < 3000 && steps++ < 600000) {
    now += 200;
    while (t.seats.filter(Boolean).length < 4) sitSomeone();
    if (Math.random() < 0.02) sitSomeone();
    const seated = t.seats.filter(Boolean), s = seated[rnd(seated.length)];
    const r = Math.random();
    if (r < 0.03) {
      const h = t.hand, p = h?.players.get(t.seatOf(s.accountId));
      if (p && !p.folded && !t.seats[p.seat].leaving) stood[p.allIn && h.phase === 'betting' ? 'allIn' : h.phase]++;
      t.stand(s.accountId, now);
    } else if (r < 0.05) t.setSittingOut(s.accountId, !s.sittingOut);
    else if (r < 0.1) {
      const amt = 100 + rnd(8000);
      try { t.topUp(s.accountId, amt); broughtIn += amt; } catch {}
    }

    const h = t.hand;
    if (h?.phase === 'betting') {
      const seat = h.toAct, p = h.players.get(seat);
      assert.ok(t.seats[seat] && p && t.needsAction(p), `bad turn in hand ${h.no}`);
      if (Math.random() < 0.03) { now = h.deadline; t.tick(now); timeouts++; }
      else {
        const id = t.seats[seat].accountId, L = t.legal(seat), x = Math.random();
        if (x < 0.15 && !L.canCheck) t.act(id, { type: 'fold' }, now);
        else if (x < 0.45 && L.canRaise) t.act(id, { type: 'raise', amount: L.minTo + Math.random() * (L.maxTo - L.minTo) }, now);
        else if (x < 0.55 && L.canRaise) t.act(id, { type: 'raise', amount: L.maxTo }, now);
        else t.act(id, { type: L.canCheck ? 'check' : 'call' }, now);
      }
    } else if (h?.phase === 'rit') {
      for (const p of t.livePlayers()) if (Math.random() < 0.8) t.answerRit(p.accountId, Math.random() < 0.7 ? 'twice' : 'once');
      if (Math.random() < 0.3) now += 7000;
      t.tick(now);
      if (t.hand.rit.result === 'twice') ritTwice++;
    } else {
      now += 4000;
      t.tick(now);
    }

    for (const x of t.seats) if (x) assert.ok(x.stack >= 0 && Number.isInteger(x.stack), `bad stack ${x.stack}`);
    // A seat the running hand still references is never handed to someone else.
    if (t.hand) for (const [i, p] of t.hand.players) assert.equal(t.seats[i]?.accountId, p.accountId, `seat ${i} freed mid-hand`);
    assert.equal(t.chipsOnTable() + t.rakeCollected + out + refunded, broughtIn, `chips not conserved at hand ${t.handNo}`);
    // Busted or sitting-out players come back now and then.
    for (const x of t.seats) if (x?.sittingOut && Math.random() < 0.05) {
      if (x.stack + x.topUp === 0) try { t.topUp(x.accountId, 5000); broughtIn += 5000; } catch {}
      t.setSittingOut(x.accountId, false);
    }
  }
  assert.ok(t.handNo >= 3000, `played ${t.handNo} hands`);
  assert.ok(t.rakeCollected > 0, 'rake was collected');
  assert.ok(ritTwice > 0, 'run it twice happened at least once');
  assert.ok(timeouts > 0 && refunds > 0, `timeouts ${timeouts}, top-up refunds ${refunds}`);
  for (const k of ['allIn', 'betting', 'rit', 'runout']) assert.ok(stood[k] > 0, `nobody left during ${k}: ${JSON.stringify(stood)}`);
});

test('timeout checks or folds and sits the player out', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  const seat = t.hand.toAct;
  t.tick(16000);
  assert.equal(t.hand.players.get(seat).folded, true);
  assert.equal(t.seats[seat].sittingOut, true);
});

test('both blinds leaving out of turn: the dead blinds go to the last player, nothing is lost', () => {
  const { t, events } = makeTable(3);
  t.startHand(0);
  assert.equal(t.hand.toAct, 0, 'button to act, nothing in yet');
  t.stand('p1', 0);
  t.stand('p2', 0);
  assert.equal(t.hand.phase, 'done');
  assert.deepEqual(t.results[0].payouts, { 0: 150 });
  t.tick(10000);
  assert.equal(t.chipsOnTable() + cashedOut(events), 30000);
});

test('an uncalled bet goes back unraked and is not counted as won', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  act(t, 'call'); act(t, 'call'); act(t, 'check'); // 300 in, flop
  const bettor = t.hand.toAct;
  act(t, 'bet', 300); act(t, 'fold'); act(t, 'fold');
  const r = t.results[0];
  assert.equal(r.rake, Math.floor(300 * 0.069), 'raked on the contested 300 only');
  assert.deepEqual(r.payouts, { [bettor]: 600 - r.rake });
  assert.equal(r.winners[0].amount, 300 - r.rake);
  assert.ok(t.log.includes(`Uncalled 3 returned to P${bettor}`));
});

test('leaving while all-in in the run-it-twice window keeps the hand and pays the leaver', () => {
  const { t, events } = makeTable(2, 10000, { rakePct: 0 });
  t.startHand(0);
  rig(t, { 0: 'As Ah Ks Kh', 1: '7c 2d 8s 3h' }, 'Ad Ac Kd 4c 9s');
  while (t.hand.phase === 'betting') {
    const L = t.legal(t.hand.toAct);
    act(t, L.canRaise ? 'raise' : 'call', L.maxTo);
  }
  assert.equal(t.hand.phase, 'rit');
  assert.equal(t.stand('p0', 0), null);
  assert.equal(t.hand.players.get(0).folded, false);
  assert.equal(t.hand.rit.answers.p0, 'once');
  assert.equal(t.stand('p0', 0), null, 'a second leave is a no-op');
  assert.equal(t.seats[0].accountId, 'p0', 'seat kept until the hand is over');
  const now = settle(t);
  assert.deepEqual(t.results[0].payouts, { 0: 20000 });
  t.tick(now + 10000);
  assert.equal(t.seats[0], null);
  assert.deepEqual(events.filter(([type]) => type === 'left').map(([, d]) => [d.accountId, d.stack]), [['p0', 20000]]);
});

test('leaving while all-in during betting keeps the player in; the others play on', () => {
  const { t, events } = makeTable(3, [300, 10000, 10000], { minBuyInBB: 1, rakePct: 0 });
  t.startHand(0);
  act(t, 'raise', 300); // button is all-in
  assert.ok(t.hand.players.get(0).allIn);
  t.stand('p0', 0);
  assert.equal(t.hand.players.get(0).folded, false);
  assert.equal(t.seats[0].leaving, true);
  act(t, 'call'); act(t, 'call');
  assert.equal(t.hand.street, 1, 'the other two carry on betting');
  while (t.hand.phase === 'betting') act(t, 'check');
  const now = settle(t);
  const won = t.results[0].payouts[0] || 0;
  assert.equal(t.results[0].players.find(p => p.seat === 0).folded, false);
  t.tick(now + 10000);
  assert.deepEqual(events.filter(([type]) => type === 'left').map(([, d]) => d.stack), [won]);
});

test('a seat in the current hand is never freed mid-hand', () => {
  const { t, events } = makeTable(3);
  t.startHand(0);
  act(t, 'fold'); // the button folds
  assert.equal(t.stand('p0', 0), null);
  assert.equal(t.stand('p0', 0), null);
  assert.equal(t.seats[0].accountId, 'p0');
  assert.ok(!t.emptySeats().includes(0));
  assert.throws(() => t.sit('x', 'X', 5000, 0), /Seat taken/);
  assert.equal(events.filter(([type]) => type === 'left').length, 0);
  const now = settle(t);
  t.tick(now + 10000);
  assert.equal(t.seats[0], null);
  assert.equal(events.filter(([type]) => type === 'left').length, 1);
});

test('stand() runs on the injected clock', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  t.stand(t.seats[t.hand.toAct].accountId, 2000); // in turn: the next player's clock starts at 2000
  assert.equal(t.hand.turnStartedAt, 2000);
  assert.equal(t.hand.deadline, 2000 + t.actionTimeMs);
  const other = [...t.hand.players.keys()].find(s => s !== t.hand.toAct && !t.hand.players.get(s).folded);
  t.stand(t.seats[other].accountId, 3000); // out of turn: ends the hand
  assert.equal(t.hand.phase, 'done');
  assert.equal(t.nextHandAt, 3000 + 3500);
});

test('a short all-in big blind does not lower the price to call', () => {
  const { t } = makeTable(4, [10000, 10000, 40, 10000], { minBuyInBB: 0 });
  t.startHand(0);
  assert.equal(t.hand.bbSeat, 2);
  assert.equal(t.hand.currentBet, 100);
  const L = t.legal(t.hand.toAct);
  assert.equal(L.toCall, 100);
  assert.equal(L.minTo, 200);
  act(t, 'call'); act(t, 'call');
  assert.equal(t.legal(t.hand.toAct).toCall, 50, 'the small blind completes to a full big blind');
});

test('nobody gets a turn with nothing to decide', () => {
  // Heads-up, the button/SB is all-in for 30: the BB has nothing to call and nobody to raise.
  const { t } = makeTable(2, [30, 10000], { minBuyInBB: 0 });
  t.startHand(0);
  assert.equal(t.hand.phase, 'rit');
  const now = settle(t);
  assert.equal(t.seats[1].sittingOut, false, 'no timeout');
  assert.ok(t.log.includes('Uncalled 0.7 returned to P1'));
  t.tick(now + 10000);
  // 3-handed, BB all-in for 40: once the button folds, the SB's 50 already covers it.
  const b = makeTable(3, [10000, 10000, 40], { minBuyInBB: 0 }).t;
  b.startHand(0);
  act(b, 'fold');
  assert.equal(b.hand.phase, 'rit');
});

test('the odd chip of a split pot goes to the first seat left of the button', () => {
  const { t } = makeTable(3, 10000, { rakePct: 0 });
  t.startHand(0);
  rig(t, { 0: 'As Ks 3d 4d', 1: 'Ah Kh 3c 4h', 2: '6s 6h 7c 8c' }, 'Qs Jd Tc 5h 2c');
  act(t, 'call'); act(t, 'call'); act(t, 'check');
  act(t, 'bet', 101); act(t, 'call'); act(t, 'call'); // 603
  while (t.hand.phase === 'betting') act(t, 'check');
  assert.equal(t.button, 0);
  assert.deepEqual(t.results[0].payouts, { 0: 301, 1: 302 });
});

test('a top-up can never take the next stack past the max buy-in', () => {
  const { t, events } = makeTable(2, [5000, 10000], { rakePct: 0 });
  t.startHand(0);
  rig(t, { 0: 'As Ah Ks Kh', 1: '7c 2d 8s 3h' }, 'Ad Ac Kd 4c 9s');
  act(t, 'raise', 300); act(t, 'call');
  // 4700 behind + 300 in the pot: room for 5000, not more.
  assert.throws(() => t.topUp('p0', 5001), /Max top-up right now is 50\b/);
  t.topUp('p0', 5000);
  while (t.hand.phase === 'betting') act(t, 'check');
  assert.equal(t.seats[0].stack, 5300);
  t.tick(100000); // next hand: 5300 + 5000 is capped at 10000
  assert.equal(t.seats[0].stack + t.hand.players.get(0).total, 10000);
  assert.deepEqual(events.filter(([type]) => type === 'topUpRefund').map(([, d]) => [d.accountId, d.amount]), [['p0', 300]]);
});

test('an all-in player with no chips behind cannot top up past the max mid-hand', () => {
  const { t } = makeTable(2, 10000, { rakePct: 0 });
  t.startHand(0);
  while (t.hand.phase === 'betting') {
    const L = t.legal(t.hand.toAct);
    act(t, L.canRaise ? 'raise' : 'call', L.maxTo);
  }
  assert.throws(() => t.topUp('p0', 1), /Max top-up right now is 0/);
});

test('short all-ins that add up to a full raise reopen the betting', () => {
  const flop = () => {
    const { t } = makeTable(4, [20000, 20000, 2500, 3100], { maxBuyInBB: 200, rakePct: 0 });
    t.startHand(0);
    act(t, 'raise', 350); act(t, 'raise', 1000); act(t, 'call'); act(t, 'call'); act(t, 'call');
    assert.equal(t.hand.street, 1);
    assert.equal(t.hand.toAct, 1);
    act(t, 'bet', 1000);
    act(t, 'raise', 99999); // seat 2 all-in to 1500: +500, not a full raise
    return t;
  };
  const t = flop();
  act(t, 'raise', 99999); // seat 3 all-in to 2100: +600 more
  act(t, 'call');
  assert.equal(t.hand.toAct, 1);
  assert.equal(t.legal(1).toCall, 1100);
  assert.equal(t.legal(1).canRaise, true, '+1100 since seat 1 bet is more than a full raise');

  const u = flop();
  act(u, 'fold'); act(u, 'call');
  assert.equal(u.hand.toAct, 1);
  assert.equal(u.legal(1).canRaise, false, '+500 alone does not reopen');
});

test('sit() rejects seat numbers that are not on the table', () => {
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100 });
  for (const bad of [8, 99, -1, 1.5, '3', NaN]) assert.throws(() => t.sit('x', 'X', 5000, bad), /Invalid seat/);
  assert.equal(t.seats.length, 8);
  assert.equal(t.sit('x', 'X', 5000, 7), 7);
  assert.equal(t.sit('y', 'Y', 5000, null), 0);
  assert.equal(t.sit('z', 'Z', 5000), 1);
});

test("a leaver's bet still gets answered: the player with chips behind acts, the all-in can't win it", () => {
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, rakePct: 0 });
  ['a', 'b', 'c'].forEach(id => t.sit(id, id.toUpperCase(), 10000));
  t.startHand(0);
  const short = t.hand.toAct;               // first to act preflop goes all-in for 400
  t.seats[short].stack = 400;
  t.act(t.seats[short].accountId, { type: 'call' });
  t.act(t.seats[t.hand.toAct].accountId, { type: 'raise', amount: 400 });
  while (t.hand.street === 0) t.act(t.seats[t.hand.toAct].accountId, { type: 'call' });
  assert.equal(t.hand.players.get(short).allIn, true);
  const bettor = t.hand.toAct, bettorId = t.seats[bettor].accountId;
  t.act(bettorId, { type: 'raise', amount: 1000 });
  const other = t.hand.toAct;
  t.stand(bettorId, Date.now());            // leaves out of turn with 1000 in front
  assert.equal(t.hand.phase, 'betting', 'the remaining player still has a decision');
  assert.equal(t.hand.toAct, other);
  t.act(t.seats[other].accountId, { type: 'call' });
  for (let k = 1; t.hand.phase !== 'done' && k < 100; k++) t.tick(Date.now() + k * 10000);
  assert.ok((t.results[0].payouts[short] || 0) <= 1200, 'an all-in for 400 can win at most 3 × 400');
});

test('top-up room ignores chips already folded into the pot', () => {
  const { t } = makeTable(3);
  t.startHand(0);
  const x = t.hand.toAct, xId = t.seats[x].accountId;
  t.act(xId, { type: 'raise', amount: 350 });
  const y = t.hand.toAct;
  t.act(t.seats[y].accountId, { type: 'raise', amount: t.legal(y).maxTo });
  t.act(t.seats[t.hand.toAct].accountId, { type: 'call' });
  t.act(xId, { type: 'fold' });
  assert.equal(t.hand.phase, 'betting', 'hand still running');
  assert.equal(t.topUpRoom(x), 350);
  t.topUp(xId, 350);
  assert.equal(t.seats[x].topUp, 350);
});
