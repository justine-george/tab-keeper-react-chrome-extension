import { describe, expect, it } from 'vitest';

import { daysLeft, deletedWhen } from '../../../utils/functions/sessionDate';
import { TOMBSTONE_TTL_MS } from '../../../utils/functions/mergeTabData';

// KAN-595. Recently deleted rows say which day, never the time, and count
// down only in their last week.

// Local wall clock, as the row reads it.
const TODAY = new Date(2026, 9, 13, 20, 31, 0);
const local = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m, d, h, 0, 0).getTime();
const DAY = 86_400_000;

describe('deletedWhen', () => {
  it('today and yesterday are words, with no time', () => {
    expect(deletedWhen(local(2026, 9, 13, 1), 'en', TODAY)).toBe('today');
    expect(deletedWhen(local(2026, 9, 12, 23), 'en', TODAY)).toBe('yesterday');
  });

  it('this year: month and day', () => {
    expect(deletedWhen(local(2026, 8, 16), 'en', TODAY)).toBe('Sep 16');
  });

  it('another year keeps its year', () => {
    expect(deletedWhen(local(2025, 8, 16), 'en', TODAY)).toBe('Sep 16, 2025');
  });

  it('follows the locale', () => {
    expect(deletedWhen(local(2026, 9, 13), 'ja', TODAY)).toBe('今日');
    expect(deletedWhen(local(2026, 8, 16), 'de', TODAY)).toBe('16. Sept.');
  });

  it('an unreadable instant is empty, not a throw', () => {
    expect(deletedWhen(Number.NaN, 'en', TODAY)).toBe('');
  });

  it('a malformed locale falls back rather than throwing', () => {
    expect(deletedWhen(local(2026, 8, 16), 'not a locale!!', TODAY)).toBe(
      'Sep 16'
    );
  });
});

describe('daysLeft', () => {
  const NOW = TODAY.getTime();
  it('is null outside the last week', () => {
    expect(daysLeft(NOW, NOW)).toBeNull();
    expect(daysLeft(NOW - 22 * DAY, NOW)).toBeNull();
  });

  it('counts down the last seven days', () => {
    expect(daysLeft(NOW - 23 * DAY, NOW)).toBe(7);
    expect(daysLeft(NOW - 27 * DAY, NOW)).toBe(3);
    expect(daysLeft(NOW - 29.5 * DAY, NOW)).toBe(1);
  });

  it('is null once past 30 days', () => {
    expect(daysLeft(NOW - TOMBSTONE_TTL_MS - 1, NOW)).toBeNull();
  });
});
