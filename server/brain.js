// Decision-making for bots and simulated players.
// Two independent dials:
//   SKILL — how well the player reads the situation (equity accuracy, pot odds, position, sizing, mistakes).
//   STYLE — what ranges and aggression they like (nit / standard / aggro / calling station / fold).
import { rankOf, suitOf } from './cards.js';
import { equity } from './equity.js';
import { bestOmahaPartial, categoryOf } from './evaluator.js';

export const SKILLS = {
  pro:    { label: 'Professional', ranges: 'full',  adapts: true,  iters: 350, noise: 0.02, mistake: 0.005, potOdds: true,  position: true,  implied: true,  semiBluff: true,  sizing: 'balanced', tiltable: false,
            desc: 'Reads ranges from betting and adapts to each opponent (bluffs folders, value-bets stations). Pot odds, position, stack depth, balanced sizing, never tilts.' },
  medium: { label: 'Medium',       ranges: 'basic', iters: 160, noise: 0.06, mistake: 0.03,  potOdds: true,  position: true,  implied: false, semiBluff: true,  sizing: 'standard', tiltable: true,
            desc: 'Solid but readable: fair equity reads, some position awareness, predictable bet sizes, can tilt.' },
  fish:   { label: 'Fish',         ranges: 'none',  iters: 40,  noise: 0.14, mistake: 0.10,  potOdds: false, position: false, implied: false, semiBluff: false, sizing: 'random',   tiltable: true,
            desc: 'Plays by feel: overvalues any pair or draw, ignores pot odds, random sizes, chases, tilts easily.' },
};

export const STYLES = {
  nit:     { label: 'Nit',     play: 0.46, raise: 0.62, aggression: 0.30, bluff: 0.02, sticky: 0.08, desc: 'Very tight — premium hands only, folds to pressure.' },
  smc:     { label: 'SMC',     play: 0.30, raise: 0.46, aggression: 0.55, bluff: 0.08, sticky: 0.22, desc: 'Balanced play with standard ranges.' },
  aggro:   { label: 'Aggro',   play: 0.20, raise: 0.32, aggression: 0.80, bluff: 0.18, sticky: 0.30, desc: 'Wide ranges, aggressive opening, lots of pressure.' },
  station: { label: 'Station', play: 0.14, raise: 0.80, aggression: 0.12, bluff: 0.00, sticky: 0.85, desc: 'Calls almost everything, rarely raises.' },
  fold:    { label: 'Fold',    play: 2,    raise: 2,    aggression: 0,    bluff: 0,    sticky: 0,    desc: 'Folds every hand (checks when free).' },
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// PLO starting-hand heuristic in [0, 1]: pairs, suitedness (nut flush potential), connectedness, high cards, danglers.
export function preflopScore(hole) {
  const ranks = hole.map(rankOf).sort((a, b) => b - a);
  const suits = hole.map(suitOf);
  let score = 0;

  const rc = {};
  for (const r of ranks) rc[r] = (rc[r] || 0) + 1;
  for (const [r, n] of Object.entries(rc)) {
    if (n === 2) score += [2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 13, 15, 18][r];
    if (n >= 3) score -= 6; // trips in PLO is bad
  }

  const bySuit = {};
  hole.forEach((c, i) => (bySuit[suits[i]] ||= []).push(rankOf(c)));
  let suitedGroups = 0;
  for (const rs of Object.values(bySuit)) {
    if (rs.length < 2) continue;
    const hi = Math.max(...rs);
    let v = hi === 12 ? 8 : hi === 11 ? 6 : hi === 10 ? 5 : hi >= 8 ? 4 : 3;
    if (rs.length === 3) v -= 2;
    if (rs.length === 4) v = 0;
    score += v;
    suitedGroups++;
  }
  if (suitedGroups === 2) score += 3; // double-suited bonus

  const uniq = [...new Set(ranks)];
  const connected = new Set();
  for (let i = 0; i < uniq.length - 1; i++) {
    const gap = uniq[i] - uniq[i + 1] - 1;
    const bonus = gap === 0 ? 4 : gap === 1 ? 3 : gap === 2 ? 1.5 : 0;
    if (bonus) { connected.add(uniq[i]); connected.add(uniq[i + 1]); }
    score += bonus + (gap <= 1 && uniq[i + 1] >= 8 ? 1 : 0);
  }
  if (uniq.length === 4 && uniq[0] - uniq[3] <= 4) score += 5; // rundown

  for (const r of ranks) if (r >= 8) score += (r - 7) / 2;
  // Danglers: a card unpaired, unconnected, unsuited with anything else.
  hole.forEach((c, i) => {
    const r = rankOf(c);
    if (rc[r] > 1 || connected.has(r) || bySuit[suits[i]].length > 1) return;
    score -= 3;
  });
  // Any AAxx is a premium start: danglers alone must not push aces below a Nit's opening line, from any seat.
  if (rc[12] === 2) score = Math.max(score, 0.6 * 58);

  return clamp(score / 58, 0, 1);
}

// Board texture: 0 (dry) … 1 (very wet). Used for sizing and caution.
function wetness(board) {
  if (board.length < 3) return 0;
  const suits = {}, ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b);
  for (const c of board) suits[suitOf(c)] = (suits[suitOf(c)] || 0) + 1;
  const flushy = Math.max(...Object.values(suits)) >= 3 ? 0.5 : Math.max(...Object.values(suits)) === 2 ? 0.2 : 0;
  let conn = 0;
  for (let i = 0; i < ranks.length - 1; i++) if (ranks[i + 1] - ranks[i] <= 2) conn += 0.15;
  const paired = board.length !== new Set(board.map(rankOf)).size ? 0.1 : 0;
  return clamp(flushy + conn + paired, 0, 1);
}

// ctx: { hole, board, legal, street, opponents, position (0 = first to act postflop … 1 = button), bb, tilt,
//        opp: { foldToBet, samples } — what we've observed about the live opponents (optional) }
export function decide(config, ctx) {
  const skill = SKILLS[config.skill] || SKILLS.medium;
  const style = { ...(STYLES[config.style] || STYLES.smc) };
  const L = ctx.legal;
  const pot = L.pot;
  const toCall = L.toCall;
  const pos = Number.isFinite(ctx.position) ? clamp(ctx.position, 0, 1) : 0.5;
  // Slider 0..100, 50 = style default; above 50 also adds a floor so zero-bluff styles (Station) respond.
  const bluffBias = (config.bluff ?? 50) / 50;
  style.bluff = style.bluff * bluffBias + Math.max(0, bluffBias - 1) * 0.06;
  if (ctx.tilt && skill.tiltable) { style.aggression = clamp(style.aggression + 0.25, 0, 1); style.play -= 0.08; style.sticky += 0.2; }

  const check = { type: 'check' }, fold = L.canCheck ? check : { type: 'fold' };
  const call = L.toCall ? { type: 'call' } : check;
  const raise = to => (L.canRaise ? { type: 'raise', amount: Math.round(clamp(to, L.minTo, L.maxTo)) } : call);

  if (config.style === 'fold') return { action: fold, why: 'Fold style' };

  // Random mistakes (misclicks, spite calls, random shoves).
  if (Math.random() < skill.mistake) {
    const opts = [fold, call, raise(L.minTo + Math.random() * (L.maxTo - L.minTo))];
    return { action: opts[Math.floor(Math.random() * opts.length)], why: 'Mistake' };
  }

  // Sizing: raise-to = current bet + fraction of the pot after calling (1.0 = pot-size raise).
  const raiseFrac = frac => {
    if (skill.sizing === 'random') frac = [0.1, 0.25, 0.5, 1, 1][Math.floor(Math.random() * 5)];
    return raise(L.currentBet + Math.max(L.minTo - L.currentBet, (pot + toCall) * frac));
  };

  /* ----- preflop ----- */
  if (ctx.street === 0) {
    let s = preflopScore(ctx.hole) + gauss() * skill.noise;
    if (skill.position) s += (pos - 0.5) * 0.12;
    const raisedPot = L.currentBet > ctx.bb;
    // How deep into a raise war we are: open ≈ 0, 3-bet ≈ 1, 4-bet ≈ 2 … (pot raises grow ~3.4× per level)
    const war = raisedPot ? Math.max(0, Math.log(L.currentBet / (ctx.bb * 3.5)) / Math.log(3.4)) : 0;
    let needPlay = style.play + (raisedPot ? 0.03 + 0.06 * war : 0);
    // Good players tighten up when calling would commit a big part of their stack; fish don't.
    if (skill.potOdds && toCall > L.stack * 0.3) needPlay += 0.1;
    const needRaise = style.raise + (raisedPot ? 0.1 + 0.12 * war : 0);

    if (s >= needRaise && Math.random() < 0.35 + style.aggression * 0.65)
      return { action: raiseFrac(1), why: `Strong start (${s.toFixed(2)})` };
    if (s >= needPlay) return { action: call, why: `Playable (${s.toFixed(2)})` };
    // Position-aware players steal late; fish just raise junk now and then.
    if (!raisedPot && Math.random() < style.bluff * (skill.position ? (pos > 0.75 ? 1.5 : 0) : 0.5))
      return { action: raiseFrac(1), why: skill.position ? 'Late-position steal' : 'Random raise' };
    if (L.canCheck) return { action: check, why: 'Free look' };
    if (Math.random() < style.sticky * 0.3 && toCall <= ctx.bb * 3) return { action: call, why: 'Loose call' };
    return { action: fold, why: `Too weak (${s.toFixed(2)})` };
  }

  /* ----- postflop ----- */
  const opps = clamp(ctx.opponents, 1, 4);
  // Range reading: who we think the opponents are, given the action so far.
  const board = ctx.board;
  // The cheap random roll goes first so most accepted hands skip the evaluation.
  const range = (minCat, loose) => h => Math.random() < loose || categoryOf(bestOmahaPartial(h, board)) >= minCat;
  // toCall is capped at our stack, but pot holds the whole bet; the part we can't match comes back to the bettor.
  const rawCall = Math.max(toCall, L.currentBet - L.committed);
  const excess = rawCall - toCall;
  const betFrac = rawCall / Math.max(1, pot - rawCall);
  let accept = null;
  if (toCall > 0) {
    if (skill.ranges === 'full') accept = betFrac >= 0.75 ? range(2, 0.3) : range(1, 0.4);
    else if (skill.ranges === 'basic') accept = range(1, 0.55);
  } else if (skill.ranges === 'full') {
    accept = range(1, 0.6); // equity vs the hands that would actually call a bet
  }
  let eq = equity(ctx.hole, board, opps, skill.iters, { accept }) + gauss() * skill.noise;
  eq = clamp(eq, 0, 1);
  const wet = wetness(ctx.board);
  const potOdds = toCall / Math.max(1, pot - excess + toCall);
  let valueLine = 0.5 + 0.07 * (opps - 1) - style.aggression * 0.08 + (skill.sizing === 'balanced' ? wet * 0.04 : 0);
  const drawy = ctx.street < 3 && eq > 0.3 && eq < 0.5;
  const spr = L.stack / Math.max(1, pot);

  // Opponent modelling (Professional only): exploit what we've seen.
  let bluffMul = 1, thinValue = 0, read = '';
  if (skill.adapts && ctx.opp && ctx.opp.samples >= 15) {
    const f = ctx.opp.foldToBet;
    if (f > 0.45) { bluffMul = 2.2; read = ' · opp folds too much'; }
    else if (f < 0.25) { bluffMul = 0.1; thinValue = 0.07; read = ' · opp never folds'; }
  }
  valueLine -= thinValue;

  // Fish evaluate hands by "does it look good", not by numbers.
  if (!skill.potOdds) {
    if (eq > 0.7 && Math.random() < 0.3 + style.aggression * 0.5) return { action: raiseFrac(0.5), why: `Feels strong (${eq.toFixed(2)})` };
    if (L.canCheck) {
      if (eq > 0.45 && Math.random() < style.aggression * 0.6) return { action: raiseFrac(0.33), why: 'Bets for fun' };
      if (Math.random() < style.bluff * 0.8) return { action: raiseFrac(0.5), why: 'Random bluff' };
      return { action: check, why: 'Checks' };
    }
    if (eq > 0.22 || Math.random() < style.sticky) return { action: call, why: `Calls to see (${eq.toFixed(2)})` };
    return { action: fold, why: `Gives up (${eq.toFixed(2)})` };
  }

  if (L.canCheck) {
    if (eq > valueLine && Math.random() < 0.4 + style.aggression * 0.6) {
      const frac = skill.sizing === 'balanced' ? 0.55 + wet * 0.4 : 0.66;
      if (skill.sizing === 'balanced' && spr < 1.5 && eq > 0.6) return { action: raise(L.maxTo), why: `Low SPR, jam for value (${eq.toFixed(2)})` };
      return { action: raiseFrac(frac), why: `Value bet (${eq.toFixed(2)})${read}` };
    }
    if (skill.semiBluff && drawy && Math.random() < (style.aggression * 0.5 + style.bluff) * Math.min(1.5, bluffMul))
      return { action: raiseFrac(0.6), why: `Semi-bluff (${eq.toFixed(2)})${read}` };
    if (Math.random() < style.bluff * bluffMul * (skill.position ? 0.5 + pos : 1) * (opps === 1 ? 1 : 0.4))
      return { action: raiseFrac(0.66), why: `Bluff${read}` };
    return { action: check, why: `Check (${eq.toFixed(2)})` };
  }

  // Facing a bet.
  const raiseLine = valueLine + 0.12;
  if (eq > raiseLine && Math.random() < 0.3 + style.aggression * 0.7) {
    if (skill.sizing === 'balanced' && spr < 2) return { action: raise(L.maxTo), why: `Raise all-in for value (${eq.toFixed(2)})` };
    return { action: raiseFrac(1), why: `Value raise (${eq.toFixed(2)})` };
  }
  let need = potOdds + 0.02 * (opps - 1) - style.sticky * 0.08;
  if (skill.implied && drawy) need -= 0.06;
  if (eq >= need) return { action: call, why: `Priced in: ${(eq * 100).toFixed(0)}% vs ${(potOdds * 100).toFixed(0)}% needed` };
  if (skill.semiBluff && drawy && ctx.street === 1 && Math.random() < style.bluff)
    return { action: raiseFrac(1), why: 'Semi-bluff raise' };
  return { action: fold, why: `Not priced in: ${(eq * 100).toFixed(0)}% vs ${(potOdds * 100).toFixed(0)}% needed` };
}

// Run-it-twice choice when a bot's preference is "Optional".
export function decideRit(config, eqGuess) {
  if (config.rit === 'twice') return 'twice';
  if (config.rit === 'once') return 'once';
  if (config.skill === 'pro') return eqGuess < 0.5 ? 'twice' : 'once';
  return Math.random() < 0.5 ? 'twice' : 'once';
}
