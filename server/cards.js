// Cards are ints 0..51: rank = c >> 2 (0 = deuce … 12 = ace), suit = c & 3.
import { randomInt } from 'node:crypto';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export const rankOf = c => c >> 2;
export const suitOf = c => c & 3;
export const cardStr = c => RANKS[c >> 2] + SUITS[c & 3];
export const parseCard = s => (RANKS.indexOf(s[0]) << 2) | SUITS.indexOf(s[1]);
export const parseCards = s => s.trim().split(/\s+/).map(parseCard);

export function freshDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

// Fisher–Yates with a CSPRNG, so the shuffle itself is fair.
export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
