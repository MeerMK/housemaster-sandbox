// 5-card hand evaluator + Omaha "exactly two from hand, three from board" rule.
// Scores are comparable integers: higher is better.

export const CATEGORY = ['High Card', 'Pair', 'Two Pair', 'Trips', 'Straight', 'Flush', 'Full House', 'Quads', 'Straight Flush'];

const counts = new Int8Array(13);

export function eval5(a, b, c, d, e) {
  const cards = [a, b, c, d, e];
  counts.fill(0);
  let flush = true;
  const s0 = a & 3;
  for (const x of cards) {
    counts[x >> 2]++;
    if ((x & 3) !== s0) flush = false;
  }

  // Ranks grouped by count desc, then rank desc — this is also the kicker order.
  const groups = [];
  for (let r = 12; r >= 0; r--) if (counts[r]) groups.push([counts[r], r]);
  groups.sort((x, y) => y[0] - x[0] || y[1] - x[1]);

  let straightHigh = -1;
  if (groups.length === 5) {
    const hi = groups[0][1], lo = groups[4][1];
    if (hi - lo === 4) straightHigh = hi;
    else if (hi === 12 && groups[1][1] === 3) straightHigh = 3; // wheel A-2-3-4-5
  }

  let cat;
  if (straightHigh >= 0 && flush) cat = 8;
  else if (groups[0][0] === 4) cat = 7;
  else if (groups[0][0] === 3 && groups[1][0] === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh >= 0) cat = 4;
  else if (groups[0][0] === 3) cat = 3;
  else if (groups[0][0] === 2 && groups[1][0] === 2) cat = 2;
  else if (groups[0][0] === 2) cat = 1;
  else cat = 0;

  let score = cat;
  if (cat === 8 || cat === 4) {
    score = (score << 4) | straightHigh;
    return score << 16;
  }
  for (const [, r] of groups) score = (score << 4) | r;
  return score << (4 * (5 - groups.length));
}

export const categoryOf = score => score >>> 20;

const HOLE_PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const BOARD_TRIPLES = [];
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) BOARD_TRIPLES.push([i, j, k]);

// Best Omaha hand: exactly 2 hole cards + exactly 3 board cards. Board must have 5 cards.
export function bestOmaha(hole, board) {
  let best = -1;
  for (const [h1, h2] of HOLE_PAIRS) {
    const x = hole[h1], y = hole[h2];
    for (const [b1, b2, b3] of BOARD_TRIPLES) {
      const s = eval5(x, y, board[b1], board[b2], board[b3]);
      if (s > best) best = s;
    }
  }
  return best;
}

// Same rule for a partial board (3 or 4 cards) — used by the brain to read "made hand" strength.
export function bestOmahaPartial(hole, board) {
  if (board.length === 5) return bestOmaha(hole, board);
  let best = -1;
  const n = board.length;
  for (const [h1, h2] of HOLE_PAIRS)
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      const s = eval5(hole[h1], hole[h2], board[i], board[j], board[k]);
      if (s > best) best = s;
    }
  return best;
}
