import { describe, it, expect } from 'vitest';
import { calculateScrapeInterval, formatInterval } from '../scrapeInterval.util';

const HOUR = 60 * 60 * 1000;

const MIN = 30 * 60 * 1000;

describe('calculateScrapeInterval', () => {
  it('< 30m span → 30 minute floor', () => {
    expect(calculateScrapeInterval(6 * 60 * 1000)).toBe(MIN);
  });
  it('exactly 30m span → 30 minutes', () => {
    expect(calculateScrapeInterval(MIN)).toBe(MIN);
  });
  it('30m–6h span → that span', () => {
    expect(calculateScrapeInterval(3 * HOUR)).toBe(3 * HOUR);
  });
  it('6–24h span → 6 hours', () => {
    expect(calculateScrapeInterval(10 * HOUR)).toBe(6 * HOUR);
  });
  it('> 24h span → 24 hours', () => {
    expect(calculateScrapeInterval(48 * HOUR)).toBe(24 * HOUR);
  });
});

describe('formatInterval', () => {
  it('formats hours + minutes', () => {
    expect(formatInterval(6 * HOUR)).toBe('6h 0m');
  });
  it('formats minutes only when under an hour', () => {
    expect(formatInterval(45 * 60 * 1000)).toBe('45m');
  });
});
