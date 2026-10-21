import { describe, expect, it } from 'vitest';
import { channels, rgb } from './hexColor';

describe('channels', () => {
  it('reads each pair as one 0-255 channel', () => {
    expect(channels('#C62828')).toEqual([198, 40, 40]);
    expect(channels('#000000')).toEqual([0, 0, 0]);
    expect(channels('#FFFFFF')).toEqual([255, 255, 255]);
  });

  it('ignores case', () => {
    expect(channels('#c62828')).toEqual([198, 40, 40]);
  });

  it.each(['#FFF', '#C6282880', 'C62828', 'rgba(0, 0, 0, 0.4)', '#GG0000', ''])(
    'throws on %j, which is not #RRGGBB',
    (value) => {
      expect(() => channels(value)).toThrow(/#RRGGBB/);
    }
  );
});

describe('rgb', () => {
  it('spells a token as getComputedStyle does', () => {
    expect(rgb('#C62828')).toBe('rgb(198, 40, 40)');
  });

  it('throws on a token that is not #RRGGBB', () => {
    expect(() => rgb('rgba(0, 0, 0, 0.4)')).toThrow(/#RRGGBB/);
  });
});
