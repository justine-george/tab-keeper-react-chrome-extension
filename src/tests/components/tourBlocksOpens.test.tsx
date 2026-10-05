import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { buildSession } from '../fixtures/sessionFixture';
import { classRulesFor } from '../setup/hoverRules';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  setHasTabGroupsPermission,
  runShownHere,
  runStoppedHere,
} from '../../redux/slices/globalStateSlice';
import { recordFirstRun } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';
import { useIsOpenBlockedByTour } from '../../hooks/useIsOpenBlockedByTour';

// KAN-413. The opens on the tour's sample wait for the tour; each CONTROL ends it and presses again.

const SAMPLE = 'sample:x';
const OPEN_BLOCKED = 'Open works after the tour';
const TABS = [
  { tabId: 'loose', favicon: '', title: 'Loose', url: 'https://a.co' },
  {
    tabId: 'g1',
    favicon: '',
    title: 'One',
    url: 'https://b.co',
    chromeGroupId: 'grp',
  },
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'grp', title: 'Research', color: 'blue' },
];
// tabs.create rejects a window no seed declares.
const SEED: ChromeSeed = {
  windows: [{ id: 1 }],
  tabs: [{ id: 1, active: true, url: 'https://added.test', title: 'Added' }],
};

const tourHere = (store: RenderWithProvidersResult['store']) => {
  store.dispatch(recordFirstRun({ ...newRun('popup', 6), sessionId: SAMPLE }));
  store.dispatch(runShownHere());
};

async function renderSampleWindow(onOpenWindow: () => void = () => undefined) {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Getting there"
      tabGroupId={SAMPLE}
      windowId="w"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      onOpenWindow={onOpenWindow}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: SEED,
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        tourHere(store);
      },
    }
  );
}
type Rendered = Awaited<ReturnType<typeof renderSampleWindow>>;
const endTour = ({ store }: Rendered) =>
  act(() => {
    store.dispatch(runStoppedHere());
  });
// The fake answers tabs.query on a later task; both halves wait the same.
const settle = () =>
  act(() => new Promise<void>((done) => setTimeout(done, 0)));

describe('opens on the tour’s sample', () => {
  test('the window’s Open and the group’s Open keep their names, are dimmed, say why and open nothing; after the tour they open', async () => {
    const onOpenWindow = vi.fn();
    const r = await renderSampleWindow(onOpenWindow);
    const blocked = [
      screen.getByRole('button', { name: 'Open in new window: Getting there' }),
      screen.getByRole('button', { name: 'Open group: Research' }),
    ];
    for (const button of blocked) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('title', OPEN_BLOCKED);
      expect(button).not.toHaveAttribute('aria-description');
      fireEvent.click(button);
    }
    await settle();
    expect(onOpenWindow).not.toHaveBeenCalled();
    expect(r.chrome.createdTabs).toEqual([]);

    endTour(r);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open in new window: Getting there' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open group: Research' })
    );
    await settle();
    expect(onOpenWindow).toHaveBeenCalledTimes(1);
    expect(r.chrome.createdTabs.map((t) => t.url)).toEqual(['https://b.co']);
  });

  test('a tab row keeps its name, says why, stays focusable and opens nothing; after the tour it opens', async () => {
    const r = await renderSampleWindow();
    const row = screen.getByRole('button', { name: 'Open in new tab: Loose' });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('title', OPEN_BLOCKED);
    // Not silenced: Chrome reads the unused title as the row's description.
    expect(row).not.toHaveAttribute('aria-description');
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.click(row);
    await settle();
    expect(r.chrome.createdTabs).toEqual([]);

    endTour(r);
    expect(row).not.toHaveAttribute('aria-disabled');
    expect(row).not.toHaveAttribute('title');
    fireEvent.click(row);
    await settle();
    expect(r.chrome.createdTabs.map((t) => t.url)).toEqual(['https://a.co']);
  });

  test('the saved list row’s Open and Switch keep their names, say why as the description, are dimmed and open nothing; after the tour they open', async () => {
    const onOpenAllClick = vi.fn();
    const onFocusClick = vi.fn();
    const r = await renderWithProviders(
      <TabGroupEntry
        tabGroupData={buildSession({ tabGroupId: SAMPLE, isSelected: true })}
        onTabGroupClick={() => undefined}
        onOpenAllClick={onOpenAllClick}
        onFocusClick={onFocusClick}
        onDeleteClick={() => undefined}
      />,
      { seedStore: tourHere }
    );
    const blocked = ['Open', 'Switch'].map((name) =>
      screen.getByRole('button', { name })
    );
    expect(screen.queryAllByRole('button', { name: OPEN_BLOCKED })).toEqual([]);
    for (const button of blocked) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(OPEN_BLOCKED);
      expect(button).toHaveAttribute('title', OPEN_BLOCKED);
      // A filter, not opacity: the row's own reveal sets these icons' opacity.
      expect(classRulesFor(button)).toMatch(/filter:\s*opacity\(0\.3\)/);
      fireEvent.click(button);
    }
    expect(onOpenAllClick).not.toHaveBeenCalled();
    expect(onFocusClick).not.toHaveBeenCalled();

    endTour(r);
    for (const name of ['Open', 'Switch']) {
      const button = screen.getByRole('button', { name });
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(button).not.toHaveAttribute('title', OPEN_BLOCKED);
      expect(classRulesFor(button)).not.toMatch(/filter:\s*opacity/);
      fireEvent.click(button);
    }
    expect(onOpenAllClick).toHaveBeenCalledTimes(1);
    expect(onFocusClick).toHaveBeenCalledTimes(1);
  });

  test('no tour and no session is not blocked', async () => {
    function Probe() {
      return <output>{String(useIsOpenBlockedByTour(undefined))}</output>;
    }
    await renderWithProviders(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('false');
  });
});
