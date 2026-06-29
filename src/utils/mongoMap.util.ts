// Mongoose Maps reject keys containing "." or starting with "$" — they're
// MongoDB path/operator characters. Telegram display names routinely contain
// them (e.g. "晨.曦 專-業代.發"), which crashes scrapeData/bookmark writes and
// silently halts the whole scrape→alert pipeline.
//
// Encode just those two characters to look-alike fullwidth glyphs: the keys
// become valid, render the same in the UI, and need no decoding on read.
// Lossy only for the rare name already using a fullwidth dot/dollar, and only
// in frequency charts — acceptable for this use.
const FULLWIDTH_DOT = '．'; // ．
const FULLWIDTH_DOLLAR = '＄'; // ＄

export function safeMapKey(key: string): string {
  return String(key).replace(/\./g, FULLWIDTH_DOT).replace(/\$/g, FULLWIDTH_DOLLAR);
}

// Build a Mongoose-safe Map from a Map or plain object, sanitizing keys.
// Numeric values that collide after sanitization are summed; others overwrite.
export function toSafeMap<V = unknown>(
  input?: Map<string, V> | Record<string, V> | null
): Map<string, V> {
  const out = new Map<string, V>();
  if (!input) return out;

  const entries: Iterable<[string, V]> =
    input instanceof Map ? input.entries() : Object.entries(input);

  for (const [rawKey, value] of entries) {
    const key = safeMapKey(rawKey);
    const prev = out.get(key);
    if (typeof value === 'number' && typeof prev === 'number') {
      out.set(key, (prev + value) as V); // ponytail: collisions astronomically rare; sum keeps counts honest
    } else {
      out.set(key, value);
    }
  }
  return out;
}
