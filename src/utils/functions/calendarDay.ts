/**
 * Calendar-day arithmetic in the device's local time (KAN-347).
 *
 * Counted on the calendar, not in 24-hour spans: a daylight-saving day is 23
 * or 25 hours long and is still one day.
 */
const DAY_MS = 86_400_000;

/** A number that goes up by exactly 1 per local calendar day. */
export function localDayNumber(at: Date): number {
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY_MS;
}

/**
 * How many calendar days `instant` falls before `today`'s: 0 the same day, 1
 * the day before, negative after.
 */
export function calendarDaysBefore(instant: number, today: Date): number {
  return localDayNumber(today) - localDayNumber(new Date(instant));
}

/** Local midnight of the day `localDayNumber` numbered. */
export function localMidnight(dayNumber: number): Date {
  const utc = new Date(dayNumber * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}
