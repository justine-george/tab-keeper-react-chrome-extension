import { describe, expect, test } from 'vitest';

import {
  isUnnamedWindow,
  windowLabel,
  windowNumbers,
} from '../../../utils/functions/windowLabel';

describe('isUnnamedWindow', () => {
  test('empty and whitespace-only titles are unnamed', () => {
    expect(isUnnamedWindow('')).toBe(true);
    expect(isUnnamedWindow('  ')).toBe(true);
    expect(isUnnamedWindow('Research')).toBe(false);
  });
});

describe('windowLabel', () => {
  test('a named window shows its title', () => {
    expect(windowLabel('Research', 3, 'Window')).toEqual({
      text: 'Research',
      named: true,
    });
  });

  test.each(['', '  '])('title %j shows "Window 3", unnamed', (title) => {
    expect(windowLabel(title, 3, 'Window')).toEqual({
      text: 'Window 3',
      named: false,
    });
  });

  test('uses the caller word', () => {
    expect(windowLabel('', 1, 'Fenster').text).toBe('Fenster 1');
  });
});

describe('windowNumbers', () => {
  const ids = (...windowIds: string[]) =>
    windowIds.map((windowId) => ({ windowId }));

  test('numbers by position from 1', () => {
    expect([...windowNumbers(ids('a', 'b', 'c'), new Set())]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  test('skips left-out ids and the next one continues', () => {
    const n = windowNumbers(ids('a', 'x', 'b', 'c'), new Set(['x']));
    expect(n.get('a')).toBe(1);
    expect(n.get('b')).toBe(2);
    expect(n.get('c')).toBe(3);
  });

  test('a left-out id first takes number 1 and the next real window is still 1', () => {
    const n = windowNumbers(ids('phantom', 'a', 'b'), new Set(['phantom']));
    expect(n.get('phantom')).toBe(1);
    expect(n.get('a')).toBe(1);
    expect(n.get('b')).toBe(2);
  });

  test('a trailing left-out id takes the number after the last counted one', () => {
    const n = windowNumbers(ids('a', 'b', 'tail'), new Set(['tail']));
    expect(n.get('b')).toBe(2);
    expect(n.get('tail')).toBe(3);
  });

  test('an empty list gives an empty map', () => {
    expect(windowNumbers([], new Set(['x'])).size).toBe(0);
  });
});
