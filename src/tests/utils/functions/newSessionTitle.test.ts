import { describe, expect, test } from 'vitest';

import { newSessionTitleOf } from '../../../utils/functions/newSessionTitle';
import type {
  CarriedRef,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  group,
  session,
  tab,
  win,
  T0,
} from '../../fixtures/sessionMoveFixture';

// KAN-394 N4. What a session made by a carry is called.

const tabRef = (tabId: string): CarriedRef => ({
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId,
});
const groupRef = (groupId: string): CarriedRef => ({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId,
});
const windowRef: CarriedRef = {
  kind: 'window',
  tabGroupId: 'S1',
  windowId: 'w1',
};

const titled = (t: string, id: string, groupId?: string) => ({
  ...tab(id, groupId),
  title: t,
});
const named = (id: string, title: string) => ({ ...group(id), title });

const one = (w: ReturnType<typeof win>): readonly tabContainerData[] => [
  session('S1', 'Source', T0, [w]),
];

describe('newSessionTitleOf', () => {
  test('a tab gives its title, trimmed', () => {
    const tabs = one(win('w1', [titled('  Docs  ', 't1')]));
    expect(newSessionTitleOf(tabs, tabRef('t1'))).toBe('Docs');
  });

  test('a blank tab title gives nothing', () => {
    const tabs = one(win('w1', [titled('   ', 't1')]));
    expect(newSessionTitleOf(tabs, tabRef('t1'))).toBe('');
  });

  test('a group gives its name', () => {
    const tabs = one(
      win('w1', [titled('First', 'a', 'g')], [named('g', ' Research ')])
    );
    expect(newSessionTitleOf(tabs, groupRef('g'))).toBe('Research');
  });

  test('an unnamed group gives its first tab', () => {
    const tabs = one(
      win(
        'w1',
        [
          titled('Other', 'x'),
          titled('  First  ', 'a', 'g'),
          titled('B', 'b', 'g'),
        ],
        [named('g', '  ')]
      )
    );
    expect(newSessionTitleOf(tabs, groupRef('g'))).toBe('First');
  });

  test('a window gives its name', () => {
    const w = { ...win('w1', [titled('First', 'a')]), title: ' Work ' };
    expect(newSessionTitleOf(one(w), windowRef)).toBe('Work');
  });

  test('an unnamed window gives its first tab', () => {
    const w = {
      ...win('w1', [titled('First', 'a'), titled('B', 'b')]),
      title: '',
    };
    expect(newSessionTitleOf(one(w), windowRef)).toBe('First');
  });

  test('an unnamed window whose first tab is blank gives nothing (N4 names the first tab only)', () => {
    const w = {
      ...win('w1', [titled(' ', 'a'), titled('Second', 'b')]),
      title: '',
    };
    expect(newSessionTitleOf(one(w), windowRef)).toBe('');
  });

  test('blank everything gives nothing', () => {
    const w = { ...win('w1', [titled('', 'a')]), title: ' ' };
    expect(newSessionTitleOf(one(w), windowRef)).toBe('');
  });

  test('an item that is not there gives nothing', () => {
    const tabs = one(win('w1', [titled('A', 'a')]));
    expect(newSessionTitleOf(tabs, tabRef('gone'))).toBe('');
    expect(newSessionTitleOf([], windowRef)).toBe('');
  });
});
