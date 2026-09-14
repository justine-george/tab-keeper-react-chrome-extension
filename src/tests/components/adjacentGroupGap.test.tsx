import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type {
  chromeTabGroupData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-179. The place BETWEEN two adjacent groups.
//
// A band means "release here and join this group" over its whole height
// (KAN-164), so the only ungrouped landing between two groups sitting next to
// each other is the gap between their two bands -- and that gap was 2px,
// because each band carries the same `margin: 2px 0` and adjacent margins
// collapse to the larger rather than adding up.
//
// The gap is widened on the FOLLOWING band's top margin, and only when what it
// follows is another group. Which bands those are is the decision this file
// pins; how wide the gap comes out in a real layout is measured in
// e2e/adjacent-group-gap.spec.ts, since jsdom does not do margin collapsing.
//
// Top rather than bottom, and that is load-bearing: footprintOf reads a row's
// own margin-BOTTOM and hands it to the preview as the distance every displaced
// row travels (KAN-167). A wider bottom margin would move every preview in the
// pane; a wider top margin moves nothing but the band itself.

const tab = (id: string, groupId?: string): tabData => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(groupId ? { chromeGroupId: groupId } : {}),
});

const group = (groupId: string): chromeTabGroupData => ({
  groupId,
  title: groupId,
  color: 'blue',
});

async function renderWindow(
  tabs: tabData[],
  chromeTabGroups: chromeTabGroupData[]
) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={tabs}
      chromeTabGroups={chromeTabGroups}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
}

const bandOf = (groupId: string) =>
  document.querySelector<HTMLElement>(`[data-band-id="${groupId}"]`)!;

const marginTopOf = (groupId: string) =>
  getComputedStyle(bandOf(groupId)).marginTop;

describe('the gap between two adjacent groups', () => {
  test('a group that follows another group opens the wider gap', async () => {
    await renderWindow(
      [tab('t1'), tab('a1', 'A'), tab('b1', 'B'), tab('t2')],
      [group('A'), group('B')]
    );

    expect(marginTopOf('B')).toBe('8px');
  });

  // CONTROL: the same band, in the same window, when what precedes it is an
  // ordinary tab. Without this a rule that widened EVERY band would pass the
  // test above while changing the spacing of the whole pane.
  test('a group that follows a loose tab keeps the original gap', async () => {
    await renderWindow(
      [tab('t1'), tab('a1', 'A'), tab('b1', 'B'), tab('t2')],
      [group('A'), group('B')]
    );

    expect(marginTopOf('A')).toBe('2px');
  });

  // The first row in the window has nothing before it at all -- the lookback
  // has to read that as "not a group" rather than reaching off the start.
  test('a group first in the window keeps the original gap', async () => {
    await renderWindow([tab('a1', 'A'), tab('t1')], [group('A')]);

    expect(marginTopOf('A')).toBe('2px');
  });

  // Three in a row: every boundary between two groups gets the gap, not just
  // the first one.
  test('a run of groups opens the gap at every boundary', async () => {
    await renderWindow(
      [tab('a1', 'A'), tab('b1', 'B'), tab('c1', 'C')],
      [group('A'), group('B'), group('C')]
    );

    expect(marginTopOf('A')).toBe('2px');
    expect(marginTopOf('B')).toBe('8px');
    expect(marginTopOf('C')).toBe('8px');
  });

  // The band is only rendered when the permission is granted; ungranted, the
  // tabs render loose and there is no boundary to widen. A smoke check that
  // the lookback does not depend on groups existing.
  test('the window still renders when there are no groups at all', async () => {
    await renderWindow([tab('t1'), tab('t2')], []);

    expect(screen.getByText('Tab t1')).toBeInTheDocument();
    expect(document.querySelector('[data-band-id]')).toBeNull();
  });
});
