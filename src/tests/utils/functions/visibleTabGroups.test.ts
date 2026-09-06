import { describe, expect, test } from 'vitest';

import { selectVisibleTabGroups } from '../../../utils/functions/local';
import { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';

const session = (
  title: string,
  isSelected: boolean,
  tabTitle = 'Kagi Search'
): tabContainerData => ({
  tabGroupId: `id-${title}`,
  title,
  createdTime: '2026-08-31 09:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected,
  windows: [
    {
      windowId: `win-${title}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'A window',
      tabs: [
        {
          tabId: `tab-${title}`,
          favicon: '',
          title: tabTitle,
          url: 'https://example.com/',
        },
      ],
    },
  ],
});

// This is the predicate the whole right pane agrees on: RightPane derives its
// mount guard from the length of this list, and both of its children read
// element [0] of it. The tests below are the contract those three share.
//
// The last argument is the live tabGroups permission. These sessions carry no
// Chrome groups, so it is passed as granted throughout: that is the setting
// under which group titles ARE searched, which makes these the proof that
// adding that level left the other three alone. Group matching has its own
// tests in searchGroupTitles.test.ts.
describe('selectVisibleTabGroups', () => {
  test('keeps only the selected sessions', () => {
    const visible = selectVisibleTabGroups(
      [session('Research', true), session('Errands', false)],
      false,
      '',
      true
    );

    expect(visible.map((group) => group.title)).toEqual(['Research']);
  });

  test('narrows the selected session by the search text', () => {
    const visible = selectVisibleTabGroups(
      [session('Research', true, 'Kagi Search')],
      true,
      'kagi',
      true
    );

    expect(visible.map((group) => group.title)).toEqual(['Research']);
  });

  test('ignores the search text while the search panel is closed', () => {
    const visible = selectVisibleTabGroups(
      [session('Research', true, 'Kagi Search')],
      false,
      'nothing matches this',
      true
    );

    expect(visible.map((group) => group.title)).toEqual(['Research']);
  });

  // The state that makes [0] undefined for every caller. RightPane must read
  // an empty list here too, or it would mount children that cannot render.
  test('returns an empty list when the search matches no selected session', () => {
    const visible = selectVisibleTabGroups(
      [session('Research', true, 'Kagi Search')],
      true,
      'nothing matches this',
      true
    );

    expect(visible).toEqual([]);
  });

  test('returns an empty list when nothing is selected at all', () => {
    expect(
      selectVisibleTabGroups([session('Research', false)], false, '', true)
    ).toEqual([]);
  });

  test('does not mutate the list it is given', () => {
    const groups = [session('Research', true), session('Errands', false)];

    selectVisibleTabGroups(groups, true, 'kagi', true);

    expect(groups.map((group) => group.title)).toEqual(['Research', 'Errands']);
  });
});
