import { describe, it, expect } from 'vitest';

import { reaimIndex } from '../../../utils/functions/reaimIndex';

describe('reaimIndex', () => {
  it.each([
    // [label, before, after, row, toIndex, want]
    ['nothing changed', ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 'd', 1, 1],
    [
      'a row inserted above the target',
      ['a', 'b', 'c', 'd'],
      ['n', 'a', 'b', 'c', 'd'],
      'd',
      1,
      2,
    ],
    [
      'the aimed-after neighbour deleted: falls back to the one below',
      ['a', 'b', 'c', 'd'],
      ['b', 'c', 'd'],
      'd',
      1,
      0,
    ],
    [
      'dropped first: keeps first',
      ['a', 'b', 'c'],
      ['n', 'a', 'b', 'c'],
      'c',
      0,
      0,
    ],
    [
      'dropped last: keeps last',
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'z'],
      'a',
      2,
      3,
    ],
    [
      'inserted between the aimed neighbours: stays right after the one above',
      ['a', 'b', 'c', 'd'],
      ['a', 'n', 'b', 'c', 'd'],
      'd',
      1,
      1,
    ],
    [
      'cross-list (row not in the target list)',
      ['x', 'y'],
      ['n', 'x', 'y'],
      'r',
      1,
      2,
    ],
    ['both neighbours gone: clamps', ['a', 'b', 'c'], ['q'], 'c', 1, 1],
  ])('%s', (_l, before, after, row, toIndex, want) => {
    expect(reaimIndex(before, after, row, toIndex)).toBe(want);
  });
});
