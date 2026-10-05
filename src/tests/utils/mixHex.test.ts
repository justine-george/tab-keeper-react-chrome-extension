import { describe, expect, test } from 'vitest';

import { mixHex } from '../../styles/mixHex';

// Paper's TEXT_COLOR over its PRIMARY_COLOR, channel by channel, rounded.
const TEXT = '#3B3D40';
const PRIMARY = '#F5F7FA';

describe('mixHex', () => {
  test('88% of Paper’s text over its page', () => {
    // 59*.88+245*.12=81.32, 61*.88+247*.12=83.32, 64*.88+250*.12=86.32
    expect(mixHex(TEXT, PRIMARY, 0.88)).toBe('#515356');
  });

  test('76% rounds each channel up when it is past a half', () => {
    // 103.64, 105.64, 108.64
    expect(mixHex(TEXT, PRIMARY, 0.76)).toBe('#686A6D');
  });

  test('weight 1 is the top colour, weight 0 the bottom', () => {
    expect(mixHex(TEXT, PRIMARY, 1)).toBe('#3B3D40');
    expect(mixHex(TEXT, PRIMARY, 0)).toBe('#F5F7FA');
  });

  test('lower-case input comes back upper-case, two digits a channel', () => {
    expect(mixHex('#000000', '#0a0a0a', 0.5)).toBe('#050505');
  });
});
