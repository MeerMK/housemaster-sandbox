import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../server/cards.js';
import { eval5, bestOmaha, categoryOf, CATEGORY } from '../server/evaluator.js';
import { equity } from '../server/equity.js';

const e = s => eval5(...parseCards(s));
const cat = s => CATEGORY[categoryOf(e(s))];

test('categories', () => {
  assert.equal(cat('As Ks Qs Js Ts'), 'Straight Flush');
  assert.equal(cat('9c 9d 9h 9s 2c'), 'Quads');
  assert.equal(cat('9c 9d 9h 2s 2c'), 'Full House');
  assert.equal(cat('Ah 9h 7h 4h 2h'), 'Flush');
  assert.equal(cat('Ah 2c 3d 4s 5h'), 'Straight');
  assert.equal(cat('7c 7d 7h Ks 2c'), 'Trips');
  assert.equal(cat('7c 7d Kh Ks 2c'), 'Two Pair');
  assert.equal(cat('7c 7d Qh Ks 2c'), 'Pair');
  assert.equal(cat('7c 9d Qh Ks 2c'), 'High Card');
});

test('ordering and kickers', () => {
  assert.ok(e('Ah 2c 3d 4s 5h') < e('2h 3c 4d 5s 6h'), 'wheel is the lowest straight');
  assert.ok(e('Kh Kd 9c 9s 2c') > e('Kh Kd 9c 9s 2c') - 1);
  assert.ok(e('Kh Kd 9c 9s 3c') > e('Kh Kd 9c 9s 2c'), 'kicker counts');
  assert.ok(e('Ah Ad 2c 3s 4c') > e('Kh Kd Qc Js Tc'));
  assert.ok(e('2h 2d 2c 3s 3c') > e('Ah Kh Qh Jh 9h'), 'boat beats flush');
  assert.equal(e('Ah Kd 9c 5s 3c'), e('Ad Kc 9h 5d 3s'), 'suits do not matter');
});

test('Omaha uses exactly two hole cards', () => {
  // Four spades on board + one spade in hand is NOT a flush in Omaha.
  const board = parseCards('2s 5s 9s Ks 7d');
  const oneSpade = parseCards('As Kh Qd 3c');
  assert.notEqual(CATEGORY[categoryOf(bestOmaha(oneSpade, board))], 'Flush');
  const twoSpades = parseCards('As Qs 3h 4d');
  assert.equal(CATEGORY[categoryOf(bestOmaha(twoSpades, board))], 'Flush');
  // Board quads can't be used as quads — you must play 3 board cards, so this is only trips.
  const quadBoard = parseCards('8c 8d 8h 8s 2c');
  assert.equal(CATEGORY[categoryOf(bestOmaha(parseCards('Ah Kh Qd Jc'), quadBoard))], 'Trips');
});

test('equity is sane', () => {
  const aakk = equity(parseCards('As Ah Kd Kc'), [], 1, 3000);
  assert.ok(aakk > 0.6 && aakk < 0.75, `AAKK ds vs random ≈ 0.65, got ${aakk}`);
  const nuts = equity(parseCards('As Ks 2d 3c'), parseCards('Qs Js Ts 4h 5c'), 3, 300);
  assert.equal(nuts, 1, 'royal flush never loses');
});
