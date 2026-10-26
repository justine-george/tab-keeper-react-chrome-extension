import { describe, expect, test } from 'vitest';

import {
  DRAWER_CARRY_START,
  DRAWER_SPRUNG,
  drawerAfterMove,
  drawerStaysAfterCarry,
  inRightColumn,
} from '../../components/home/opennow/drawerCarry';

// KAN-820. The Currently open drawer's carry state, as pure rules: a carry
// that springs it, and whether it stays when the carry ends.

const rect = (
  r: Pick<DOMRect, 'left' | 'top' | 'bottom'>
): Pick<DOMRect, 'left' | 'top' | 'bottom'> => r;

describe('drawerAfterMove (KAN-820 in then out)', () => {
  test('out first: stays', () =>
    expect(drawerAfterMove(DRAWER_CARRY_START, false).away).toBe(false));
  test('in then out: away', () => {
    const s = drawerAfterMove(drawerAfterMove(DRAWER_CARRY_START, true), false);
    expect(s).toEqual({ sprung: false, beenIn: true, away: true });
  });
  test('away stays away when back inside', () => {
    const away = { sprung: true, beenIn: true, away: true };
    expect(drawerAfterMove(away, true).away).toBe(true);
  });
  test('sprung is kept', () =>
    expect(drawerAfterMove(DRAWER_SPRUNG, true).sprung).toBe(true));
  // At the spring the pointer is on the rail, under the drawer: in.
  test('sprung, then out: away', () =>
    expect(drawerAfterMove(DRAWER_SPRUNG, false).away).toBe(true));
});

describe('drawerStaysAfterCarry', () => {
  test('user-opened: stays even after away and Esc', () =>
    expect(
      drawerStaysAfterCarry({ sprung: false, beenIn: true, away: true }, true)
    ).toBe(true));
  test('sprung, released inside: stays', () =>
    expect(
      drawerStaysAfterCarry({ sprung: true, beenIn: true, away: false }, false)
    ).toBe(true));
  test('sprung, released where it sprang (on the rail under it): stays', () =>
    expect(drawerStaysAfterCarry(DRAWER_SPRUNG, false)).toBe(true));
  test('sprung, away: closes', () =>
    expect(
      drawerStaysAfterCarry({ sprung: true, beenIn: true, away: true }, false)
    ).toBe(false));
  test('sprung, Esc: closes', () =>
    expect(
      drawerStaysAfterCarry({ sprung: true, beenIn: true, away: false }, true)
    ).toBe(false));
});

describe('inRightColumn', () => {
  const box = rect({ left: 980, top: 0, bottom: 700 });
  test('inside', () => expect(inRightColumn(box, 1000, 10)).toBe(true));
  test('past the right edge counts', () =>
    expect(inRightColumn(box, 5000, 10)).toBe(true));
  test('a pixel left of it does not', () =>
    expect(inRightColumn(box, 979, 10)).toBe(false));
  test('below it does not', () =>
    expect(inRightColumn(box, 1000, 700)).toBe(false));
});
