import { describe, expect, test } from 'vitest';

import { othersCameOrWent } from '../../utils/functions/othersCameOrWent';

// KAN-992. When the selected session only changed index because others came
// or went around it, the list must not be scrolled back to it.

describe('othersCameOrWent', () => {
  test('a session arriving above it', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['n', 'a', 's', 'b'], 's')).toBe(
      true
    );
  });

  test('several arriving, above and below it', () => {
    expect(
      othersCameOrWent(['a', 's', 'b'], ['n', 'm', 'a', 's', 'o', 'b'], 's')
    ).toBe(true);
  });

  test('a session deleted elsewhere above it', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['s', 'b'], 's')).toBe(true);
  });

  test('one arriving while another goes', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['n', 's', 'b'], 's')).toBe(true);
  });

  test('nothing came or went: a search, a re-render, a rename in place', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['a', 's', 'b'], 's')).toBe(false);
  });

  test('it moved past one that stayed: an edit sends it to the top (KAN-143)', () => {
    expect(othersCameOrWent(['a', 'b', 's'], ['s', 'a', 'b'], 's')).toBe(false);
  });

  test('it moved and one arrived in the same change', () => {
    expect(othersCameOrWent(['a', 'b', 's'], ['n', 's', 'a', 'b'], 's')).toBe(
      false
    );
  });

  test('another moved past it', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['b', 'a', 's'], 's')).toBe(false);
  });

  test('a reorder of the same sessions, same length', () => {
    expect(othersCameOrWent(['a', 'b', 's'], ['b', 'a', 's'], 's')).toBe(false);
  });

  test('it is new: a session just saved here and selected', () => {
    expect(othersCameOrWent(['a', 'b'], ['s', 'a', 'b'], 's')).toBe(false);
  });

  test('it is gone', () => {
    expect(othersCameOrWent(['a', 's', 'b'], ['a', 'b'], 's')).toBe(false);
  });
});
