import { describe, expect, it } from 'vitest';

import { daysLeft } from '../../../utils/functions/sessionDate';
import { TOMBSTONE_TTL_MS } from '../../../utils/functions/mergeTabData';

// KAN-595. Recently deleted rows count down only in their last week.

const TODAY = new Date(2026, 9, 13, 20, 31, 0);
const DAY = 86_400_000;

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
