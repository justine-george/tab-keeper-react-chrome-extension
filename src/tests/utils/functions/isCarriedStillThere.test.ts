import { describe, expect, test } from 'vitest';

import { isCarriedStillThere } from '../../../utils/functions/tabGroups';
import type { CarriedRef } from '../../../redux/slices/tabContainerDataStateSlice';
import { s1, s2, s3, tab, win } from '../../fixtures/sessionMoveFixture';

// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3].

const tabRef = (tabId: string, windowId = 'w1'): CarriedRef => ({
  kind: 'tab',
  tabGroupId: 'S1',
  windowId,
  tabId,
});
const groupRef = (groupId: string): CarriedRef => ({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId,
});
const windowRef = (windowId: string): CarriedRef => ({
  kind: 'window',
  tabGroupId: 'S1',
  windowId,
});

describe('isCarriedStillThere', () => {
  test.each([
    ['a tab', tabRef('t1')],
    ['a group', groupRef('g1')],
    ['a window', windowRef('w2')],
  ])('%s where the carry found it', (_what, carried) => {
    expect(isCarriedStillThere([s1(), s3()], carried)).toBe(true);
  });

  test.each([
    ['its session is gone', tabRef('t1'), [s2()]],
    ['its window is gone', windowRef('w9'), [s1()]],
    ['a tab now in another window', tabRef('t3', 'w1'), [s1()]],
    ['a tab deleted', tabRef('t9'), [s1()]],
    [
      'a group with no tab left',
      groupRef('g1'),
      [
        {
          ...s1(),
          windows: [
            win(
              'w1',
              [tab('t1')],
              [{ groupId: 'g1', title: 'G', color: 'blue' }]
            ),
          ],
        },
      ],
    ],
  ])('not when %s', (_what, carried, tabGroups) => {
    expect(isCarriedStillThere(tabGroups, carried)).toBe(false);
  });
});
