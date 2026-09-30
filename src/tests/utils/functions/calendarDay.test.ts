import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  calendarDaysBefore,
  localDayNumber,
  localMidnight,
} from '../../../utils/functions/calendarDay';

// KAN-347. "Today" and "yesterday" are calendar days in the device's time
// zone, not 24-hour spans.
//
// The daylight-saving cases can only fail in a zone that has daylight saving,
// and CI runs in UTC, so this file runs in Los Angeles wherever it runs.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

// Built per test, after the zone is set.
const today = () => new Date(2026, 8, 29, 17, 7);

describe('calendarDaysBefore', () => {
  test('same day 0, the day before 1, a later day negative', () => {
    expect(
      calendarDaysBefore(new Date(2026, 8, 29, 0, 1).getTime(), today())
    ).toBe(0);
    expect(
      calendarDaysBefore(new Date(2026, 8, 28, 23, 59).getTime(), today())
    ).toBe(1);
    expect(
      calendarDaysBefore(new Date(2026, 8, 30, 0, 1).getTime(), today())
    ).toBe(-1);
  });

  // Two minutes apart, one calendar day: the count is by the calendar, not by
  // how much time passed.
  test('a minute before midnight is yesterday a minute after it', () => {
    expect(
      calendarDaysBefore(
        new Date(2026, 8, 28, 23, 59).getTime(),
        new Date(2026, 8, 29, 0, 1)
      )
    ).toBe(1);
  });

  test('across the new year', () => {
    expect(
      calendarDaysBefore(
        new Date(2026, 11, 31, 23, 0).getTime(),
        new Date(2027, 0, 1, 0, 5)
      )
    ).toBe(1);
  });

  // US spring-forward (Mar 8, 2026) is 23 hours long, fall-back (Nov 1) 25.
  test('a daylight-saving day is still one day', () => {
    expect(
      calendarDaysBefore(
        new Date(2026, 2, 8, 0, 30).getTime(),
        new Date(2026, 2, 9, 0, 10)
      )
    ).toBe(1);
    expect(
      calendarDaysBefore(
        new Date(2026, 10, 1, 0, 30).getTime(),
        new Date(2026, 10, 2, 23, 50)
      )
    ).toBe(1);
  });
});

describe('localMidnight', () => {
  test('inverts localDayNumber', () => {
    const m = localMidnight(localDayNumber(today()));
    expect([
      m.getFullYear(),
      m.getMonth(),
      m.getDate(),
      m.getHours(),
      m.getMinutes(),
    ]).toEqual([2026, 8, 29, 0, 0]);
  });

  test('on a daylight-saving day too', () => {
    const m = localMidnight(localDayNumber(new Date(2026, 2, 8, 12, 0)));
    expect([m.getMonth(), m.getDate(), m.getHours()]).toEqual([2, 8, 0]);
  });
});
