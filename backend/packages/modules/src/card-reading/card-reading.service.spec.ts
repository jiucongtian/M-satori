import { describe, expect, it } from 'vitest';
import { CARD_DECK, drawUniqueCardCodes } from './card-reading.service.js';

describe('server card draw', () => {
  it('never repeats a card inside one spread', () => {
    for (let index = 0; index < 10_000; index += 1) {
      const cards = drawUniqueCardCodes(5);
      expect(new Set(cards).size).toBe(5);
    }
  });

  it('keeps first-position frequency within a statistical tolerance', () => {
    const rounds = 60_000;
    const counts = new Map(CARD_DECK.map((card) => [card.code, 0]));
    for (let index = 0; index < rounds; index += 1) {
      const card = drawUniqueCardCodes(1)[0]!;
      counts.set(card, counts.get(card)! + 1);
    }
    const expected = rounds / CARD_DECK.length;
    const maximumDeviation = expected * 0.2;
    for (const count of counts.values()) expect(Math.abs(count - expected)).toBeLessThan(maximumDeviation);
  });

  it('can be replayed deterministically in tests without changing production entropy', () => {
    expect(drawUniqueCardCodes(3, () => 0)).toEqual(drawUniqueCardCodes(3, () => 0));
  });
});
