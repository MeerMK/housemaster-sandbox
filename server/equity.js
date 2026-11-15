// Monte Carlo equity for PLO: hero vs N opponents, completing the board at random.
// `accept(hole4)` optionally narrows opponents to a range (rejection sampling):
// e.g. "someone who pot-raised the turn usually has two pair or better".
import { bestOmaha } from './evaluator.js';

const MAX_TRIES = 25;

export function equity(hole, board, opponents, iterations, { dead = [], accept = null } = {}) {
  if (opponents <= 0) return 1;
  const used = new Set([...hole, ...board, ...dead]);
  const stub = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) stub.push(c);
  const n = stub.length;
  const full = new Array(5);
  const opp = new Array(opponents);
  let share = 0;

  for (let it = 0; it < iterations; it++) {
    // Partial Fisher–Yates; opponents are drawn first so rejected hands can be redrawn from the tail.
    let top = 0;
    const draw = () => {
      const j = top + Math.floor(Math.random() * (n - top));
      const t = stub[top]; stub[top] = stub[j]; stub[j] = t;
      return stub[top++];
    };
    for (let o = 0; o < opponents; o++) {
      let h, tries = 0;
      const mark = top;
      do {
        top = mark;
        h = [draw(), draw(), draw(), draw()];
      } while (accept && !accept(h) && ++tries < MAX_TRIES);
      opp[o] = h;
    }
    for (let i = 0; i < board.length; i++) full[i] = board[i];
    for (let i = board.length; i < 5; i++) full[i] = draw();

    const mine = bestOmaha(hole, full);
    let ties = 1, lost = false;
    for (let o = 0; o < opponents && !lost; o++) {
      const s = bestOmaha(opp[o], full);
      if (s > mine) lost = true;
      else if (s === mine) ties++;
    }
    if (!lost) share += 1 / ties;
  }
  return share / iterations;
}
