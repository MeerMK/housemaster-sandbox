import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../server/cards.js';
import { preflopScore, decide, SKILLS, STYLES } from '../server/brain.js';
import { Table } from '../server/table.js';

const ps = s => preflopScore(parseCards(s));

// Deterministic Math.random (mulberry32) so the statistical checks below never flake.
function seeded(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = orig; }
}

const BB = 100;
const unopened = hole => ({ hole: parseCards(hole), board: [], street: 0, opponents: 5, bb: BB,
  legal: { toCall: BB, canCheck: false, canRaise: true, minTo: 2 * BB, maxTo: 3.5 * BB, committed: 0, stack: 100 * BB, pot: 1.5 * BB, currentBet: BB, isBet: false } });
const facingOpen = hole => ({ hole: parseCards(hole), board: [], street: 0, opponents: 5, bb: BB, position: 0.5,
  legal: { toCall: 3.5 * BB, canCheck: false, canRaise: true, minTo: 6 * BB, maxTo: 12 * BB, committed: 0, stack: 100 * BB, pot: 5 * BB, currentBet: 3.5 * BB, isBet: false } });
const checkedTo = (hole, board) => ({ hole: parseCards(hole), board: parseCards(board), street: 1, opponents: 1, bb: BB, position: 1,
  legal: { toCall: 0, canCheck: true, canRaise: true, minTo: BB, maxTo: 10 * BB, committed: 0, stack: 90 * BB, pot: 10 * BB, currentBet: 0, isBet: true } });
const count = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f()) k++; return k; };

test('preflop score ranks hands sensibly', () => {
  assert.ok(ps('As Ah Ks Kh') > 0.9, 'AAKK double suited is top');
  assert.ok(ps('As Ah Ks Kh') > ps('Js Th 9s 8h'));
  assert.ok(ps('Js Th 9s 8h') > ps('9s 6h 3d 2c'), 'rundown beats trash');
  assert.ok(ps('9s 6h 3d 2c') < 0.2);
  assert.ok(ps('Ks Kh Kd 2c') < ps('Ks Kh Qd Jc'), 'trips are bad in PLO');
});

test('danglers do not sink pocket aces below a Nit\'s opening line', () => {
  assert.ok(ps('As Ah 7d 2c') > ps('6s 5h 4s 3h'));
  assert.ok(ps('As Ah 7d 2c') >= STYLES.nit.play + 0.06, 'clears the Nit line even from the worst position');
  for (const [skill, position, max] of [['pro', 0, 0], ['pro', 0.4, 0], ['medium', 0.4, 20]]) {
    const folds = seeded(7, () => count(400, () => {
      const d = decide({ skill, style: 'nit' }, { ...unopened('As Ah 7d 2c'), position });
      return d.action.type === 'fold' && d.why !== 'Mistake';
    }));
    assert.ok(folds <= max, `${skill}/nit folded AA72 ${folds}/400 at position ${position}`);
  }
});

test('raise-war depth: facing a single pot-sized open, strong hands 3-bet', () => {
  // AAKQ (0.63) sits between the documented 3-bet line (SMC raise + 0.10) and the old off-by-one one (+0.22).
  const raises = seeded(3, () => count(300, () => decide({ skill: 'pro', style: 'smc' }, facingOpen('As Ah Kd Qc')).action.type === 'raise'));
  assert.ok(raises > 120, `3-bet ${raises}/300`);
});

test('position: 1 = button steals, first-to-act does not; out-of-range values are clamped', () => {
  const cfg = { skill: 'pro', style: 'aggro' };
  const steals = position => seeded(11, () => count(600, () => /steal/.test(decide(cfg, { ...unopened('9s 6h 3d 2c'), position }).why)));
  assert.equal(steals(0), 0);
  assert.equal(steals(0.2), 0);
  assert.ok(steals(1) > 20, 'button steals');
  const same = (a, b) => assert.deepEqual(seeded(5, () => decide(cfg, { ...unopened('Ks Qh 9d 8c'), position: a })), seeded(5, () => decide(cfg, { ...unopened('Ks Qh 9d 8c'), position: b })));
  same(3.5, 1);
  same(-2, 0);
  same(NaN, 0.5);
});

test('bluff slider moves Fish and Station bots too', () => {
  const bets = (cfg, n) => seeded(21, () => count(n, () => decide(cfg, checkedTo('9s 6h 3d 2c', 'Kc Qd 7h')).action.type === 'raise'));
  for (const [cfg, n, gap] of [[{ skill: 'fish', style: 'smc' }, 800, 0.08], [{ skill: 'fish', style: 'station' }, 800, 0.03], [{ skill: 'pro', style: 'station' }, 150, 0.04]]) {
    const lo = bets({ ...cfg, bluff: 0 }, n) / n, hi = bets({ ...cfg, bluff: 100 }, n) / n;
    assert.ok(hi > lo + gap, `${cfg.skill}/${cfg.style}: bet rate ${lo} at 0 vs ${hi} at 100`);
  }
  const raises = bluff => seeded(9, () => count(600, () => decide({ skill: 'fish', style: 'smc', bluff }, { ...unopened('8s 5h 3d 2c'), position: 0.2 }).why === 'Random raise'));
  assert.equal(raises(0), 0);
  assert.ok(raises(100) > 20, 'fish raise junk preflop when the slider is up');
});

test('pot odds for a short all-in call ignore the part of the bet that comes back', () => {
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, rakePct: 0, minBuyInBB: 1 });
  t.sit('a', 'A', 10000, 0); t.sit('b', 'B', 400, 1);
  t.startHand(0);
  const h = t.hand, act = a => t.act(t.seats[h.toAct].accountId, a, 0);
  act({ type: 'raise', amount: 300 }); act({ type: 'call' }); // B has 100 behind
  act({ type: 'check' }); act({ type: 'raise', amount: 600 }); // A bets pot; 500 of it is uncallable
  const L = t.legal(h.toAct);
  assert.deepEqual([L.toCall, L.currentBet, L.pot], [100, 600, 1200]);
  const needed = new Set();
  for (let i = 0; i < 30; i++) {
    const { why } = decide({ skill: 'pro', style: 'smc' }, { hole: h.players.get(h.toAct).hole, board: h.board, legal: L, street: 1, opponents: 1, position: 0, bb: 100 });
    const m = /vs (\d+)% needed/.exec(why);
    if (m) needed.add(m[1]);
  }
  assert.deepEqual([...needed], ['13'], '100 to win 700 + our 100 = 12.5%');
});

// Play many hands with a table full of bots of each skill and see who wins.
function playMatch(configs, hands) {
  const t = new Table({ id: 't', name: 'T', sb: 50, bb: 100, rakePct: 0, minBuyInBB: 20, maxBuyInBB: 100 });
  configs.forEach((c, i) => t.sit(`p${i}`, `P${i}`, 10000));
  const net = configs.map(() => 0);
  // Reset every stack to 100bb after each hand (and bank the difference) — the usual way to cut variance in bot matches.
  const settle = h => { if (h.settled) return; h.settled = true; t.seats.forEach((s, i) => { if (s) { net[i] += s.stack - 10000; s.stack = 10000; s.sittingOut = false; } }); };
  let now = 0;
  let guard = 0;
  while (t.handNo < hands && guard++ < 200000) {
    now += 1000;
    const h = t.hand;
    if (h?.phase === 'betting') {
      const seat = h.toAct;
      const opp = t.livePlayers().length - 1;
      // Postflop acting order among the dealt-in seats: 0 = first to act (SB) … 1 = button.
      const acting = [...h.players.keys()].sort((x, y) => ((x - t.button - 1 + 8) % 8) - ((y - t.button - 1 + 8) % 8));
      const pos = acting.indexOf(seat) / Math.max(1, acting.length - 1);
      const { action } = decide(configs[seat], { hole: h.players.get(seat).hole, board: h.board, legal: t.legal(seat), street: h.street, opponents: opp, position: pos, bb: 100 });
      t.act(t.seats[seat].accountId, action, now);
    } else if (h?.phase === 'rit') {
      for (const p of t.livePlayers()) t.answerRit(p.accountId, 'once');
      t.tick(now);
    } else {
      if (h?.phase === 'done') settle(h);
      t.tick(now + 5000);
      now += 5000;
    }
  }
  return net;
}

test('professional beats fish over a sample', { timeout: 120000 }, () => {
  const configs = [
    { skill: 'pro', style: 'smc' }, { skill: 'fish', style: 'station' },
    { skill: 'pro', style: 'smc' }, { skill: 'fish', style: 'aggro' },
  ];
  const net = playMatch(configs, 600);
  const pros = net[0] + net[2], fish = net[1] + net[3];
  console.log('net (cents): pro, fish-station, pro, fish-aggro =', net);
  assert.ok(pros > fish, `pros ${pros} should beat fish ${fish}`);
});

test('every skill and style has a label and description', () => {
  for (const s of Object.values(SKILLS)) assert.ok(s.label && s.desc);
  for (const s of Object.values(STYLES)) assert.ok(s.label && s.desc);
});
