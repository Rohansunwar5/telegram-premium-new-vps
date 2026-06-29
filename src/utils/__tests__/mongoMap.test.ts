import { describe, it, expect } from 'vitest';
import { safeMapKey, toSafeMap } from '../mongoMap.util';

// Mongoose's own rule (lib/types/map.js checkValidKey): a key may not contain
// "." and may not start with "$".
const isValidMongoMapKey = (k: string) => !k.includes('.') && !k.startsWith('$');

describe('safeMapKey', () => {
  it('makes the exact key from the crash log valid', () => {
    const bad = '晨*曦 全-行.業.代/發'; // dotted name that crashed createScrapeData
    expect(isValidMongoMapKey(bad)).toBe(false);
    expect(isValidMongoMapKey(safeMapKey(bad))).toBe(true);
  });

  it('handles leading "$" and is visually faithful', () => {
    expect(isValidMongoMapKey(safeMapKey('$money.maker'))).toBe(true);
  });

  it('leaves clean keys untouched', () => {
    expect(safeMapKey('Gowtham Reddy')).toBe('Gowtham Reddy');
  });
});

describe('toSafeMap', () => {
  it('sanitizes every key so the whole Map is Mongo-safe', () => {
    const m = toSafeMap({ '晨.曦 專-業代.發': 9, '晨*曦 全-行.業.代/發': 8, Clair: 1 });
    for (const k of m.keys()) expect(isValidMongoMapKey(k)).toBe(true);
    expect(m.size).toBe(3);
  });

  it('accepts a Map input and sums numeric collisions', () => {
    // "a.b" and "a．b" both sanitize to the same key → counts must add, not drop.
    const m = toSafeMap(new Map([['a.b', 2], ['a．b', 3]]));
    expect(m.get('a．b')).toBe(5);
  });

  it('returns an empty Map for null/undefined', () => {
    expect(toSafeMap(null).size).toBe(0);
    expect(toSafeMap(undefined).size).toBe(0);
  });
});
