import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  setHasTabGroupsPermission,
  tourStartedHere,
  tourStoppedHere,
} from '../../redux/slices/globalStateSlice';
import {
  clearSampleTour,
  recordSampleTour,
} from '../../redux/slices/settingsDataStateSlice';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';
import { useIsOpenBlockedByTour } from '../../hooks/useIsOpenBlockedByTour';

// KAN-413. A window's opens on the tour's sample wait for the tour; each CONTROL ends it and presses again.

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
        store.dispatch(
          recordSampleTour({ sampleId: SAMPLE, step: 4, view: 'popup' })
        );
        store.dispatch(tourStartedHere(SAMPLE));
      },
    }
  );
}
type Rendered = Awaited<ReturnType<typeof renderSampleWindow>>;
const endTour = ({ store }: Rendered) =>
  act(() => {
    store.dispatch(clearSampleTour());
    store.dispatch(tourStoppedHere());
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

  test('no tour and no session is not blocked', async () => {
    function Probe() {
      return <output>{String(useIsOpenBlockedByTour(undefined))}</output>;
    }
    await renderWithProviders(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('false');
  });
});
