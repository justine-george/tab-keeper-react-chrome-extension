import { describe, expect, test } from 'vitest';
import { savedItem } from '../../../redux/carriedItem';

import {
  newSessionTitleOf,
  titleOfPick,
} from '../../../utils/functions/newSessionTitle';
import { live } from '../../fixtures/liveSnapshotFixture';
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
    expect(newSessionTitleOf(tabs, savedItem(tabRef('t1')))).toBe('Docs');
  });

  test('a blank tab title gives nothing', () => {
    const tabs = one(win('w1', [titled('   ', 't1')]));
    expect(newSessionTitleOf(tabs, savedItem(tabRef('t1')))).toBe('');
  });

  test('a group gives its name', () => {
    const tabs = one(
      win('w1', [titled('First', 'a', 'g')], [named('g', ' Research ')])
    );
    expect(newSessionTitleOf(tabs, savedItem(groupRef('g')))).toBe('Research');
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
    expect(newSessionTitleOf(tabs, savedItem(groupRef('g')))).toBe('First');
  });

  test('a window gives its name', () => {
    const w = { ...win('w1', [titled('First', 'a')]), title: ' Work ' };
    expect(newSessionTitleOf(one(w), savedItem(windowRef))).toBe('Work');
  });

  test('an unnamed window gives its first tab', () => {
    const w = {
      ...win('w1', [titled('First', 'a'), titled('B', 'b')]),
      title: '',
    };
    expect(newSessionTitleOf(one(w), savedItem(windowRef))).toBe('First');
  });

  test('an unnamed window whose first tab is blank gives nothing (N4 names the first tab only)', () => {
    const w = {
      ...win('w1', [titled(' ', 'a'), titled('Second', 'b')]),
      title: '',
    };
    expect(newSessionTitleOf(one(w), savedItem(windowRef))).toBe('');
  });

  test('blank everything gives nothing', () => {
    const w = { ...win('w1', [titled('', 'a')]), title: ' ' };
    expect(newSessionTitleOf(one(w), savedItem(windowRef))).toBe('');
  });

  test('an item that is not there gives nothing', () => {
    const tabs = one(win('w1', [titled('A', 'a')]));
    expect(newSessionTitleOf(tabs, savedItem(tabRef('gone')))).toBe('');
    expect(newSessionTitleOf([], savedItem(windowRef))).toBe('');
  });
});

// KAN-280 Part F (P12). The same rule for a pick inside a live snapshot.
test('titleOfPick names a pick inside a window, as newSessionTitleOf does', () => {
  const w = live();
  expect(
    titleOfPick(w, { kind: 'group', windowId: 'live-w', groupId: 'lg' })
  ).toBe('Live group');
  expect(titleOfPick(w, { kind: 'window', windowId: 'live-w' })).toBe(
    'Live lp'
  );
  expect(
    titleOfPick(w, { kind: 'tab', windowId: 'live-w', tabId: 'nope' })
  ).toBe('');
});
