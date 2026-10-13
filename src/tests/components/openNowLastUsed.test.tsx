import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-475. This window's active tab is the tab view itself, which Open now
// does not list. The tab picked by Save's rule (pickActiveTabIndex: the
// worker's record, else the newest lastAccessed) wears the active tab's mark
// instead, and screen readers hear "Last used tab"; aria-current stays on
// real active tabs.

afterEach(() => cleanup());

const TAB_VIEW = 'chrome-extension://faketestid/index.html?view=tab';
const url = (name: string) => `https://${name.toLowerCase()}.test/`;
const tab = (
  id: number,
  title: string,
  extra: Partial<{ active: boolean; lastAccessed: number }> = {}
) => ({
  id,
  title,
  url: url(title),
  pinned: false,
  audible: false,
  active: false,
  ...extra,
});

// Window 1 [Alpha*], Window 2 = This window [tab view*, Bravo, Charlie].
// Charlie was accessed last, so lastAccessed alone would pick it.
const seed = (extra: Partial<ChromeSeed> = {}): ChromeSeed => ({
  windows: [
    { id: 1, tabs: [tab(11, 'Alpha', { active: true, lastAccessed: 50 })] },
    {
      id: 2,
      tabs: [
        {
          id: 20,
          title: 'Tab Keeper',
          url: TAB_VIEW,
          active: true,
          pinned: false,
        },
        tab(21, 'Bravo', { lastAccessed: 100 }),
        tab(22, 'Charlie', { lastAccessed: 200 }),
      ],
    },
  ],
  currentTabId: 20,
  ...extra,
});

async function renderOpenNow(chromeSeed: ChromeSeed) {
  const result = await renderWithProviders(<OpenNowColumn folded={true} />, {
    seed: chromeSeed,
  });
  await screen.findByText('This window');
  return result;
}

const switchRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });

// KAN-567 B. The tab on screen is marked by its title's weight: the label
// box NormalLabel draws around the title text.
const titleWeight = (title: string): 'active' | 'plain' => {
  const text = within(switchRow(title)).getByText(title);
  const label = text.parentElement;
  if (label === null) throw new Error(`no label for ${title}`);
  return getComputedStyle(label).fontWeight === '600' ? 'active' : 'plain';
};

describe('Open now marks the tab you came from in This window (KAN-475)', () => {
  test("the recorded tab wears the active tab's mark and reads Last used tab", async () => {
    await renderOpenNow(seed({ sessionArea: { 'recentTabs.2': [20, 21] } }));
    await waitFor(() =>
      expect(switchRow('Bravo')).toHaveAccessibleDescription('Last used tab')
    );
    expect(titleWeight('Bravo')).toBe('active');
    expect(titleWeight('Alpha')).toBe('active');
    expect(switchRow('Bravo')).not.toHaveAttribute('aria-current');
    expect(titleWeight('Charlie')).toBe('plain');
    expect(switchRow('Charlie')).not.toHaveAccessibleDescription(
      'Last used tab'
    );
  });

  test('with no record, the newest lastAccessed tab wears it, as Save picks', async () => {
    await renderOpenNow(seed());
    await waitFor(() =>
      expect(switchRow('Charlie')).toHaveAccessibleDescription('Last used tab')
    );
    expect(titleWeight('Charlie')).toBe('active');
    expect(titleWeight('Bravo')).toBe('plain');
  });

  test('the mark follows the record as the worker writes it', async () => {
    await renderOpenNow(seed({ sessionArea: { 'recentTabs.2': [20, 21] } }));
    await waitFor(() =>
      expect(switchRow('Bravo')).toHaveAccessibleDescription('Last used tab')
    );
    await act(() =>
      chrome.storage.session.set({ 'recentTabs.2': [20, 22, 21] })
    );
    await waitFor(() =>
      expect(switchRow('Charlie')).toHaveAccessibleDescription('Last used tab')
    );
    expect(switchRow('Bravo')).not.toHaveAccessibleDescription('Last used tab');
  });

  test('other windows keep only their real active tab', async () => {
    await renderOpenNow(
      seed({ sessionArea: { 'recentTabs.2': [20, 21], 'recentTabs.1': [11] } })
    );
    await waitFor(() =>
      expect(switchRow('Bravo')).toHaveAccessibleDescription('Last used tab')
    );
    expect(switchRow('Alpha')).toHaveAttribute('aria-current', 'true');
    expect(switchRow('Alpha')).not.toHaveAccessibleDescription('Last used tab');
    expect(screen.getAllByText('Last used tab')).toHaveLength(1);
  });

  test("when This window's active tab is listed, it alone is marked, as current", async () => {
    // The tab view sits in the background behind Bravo.
    const behind = seed({ sessionArea: { 'recentTabs.2': [21, 20] } });
    const [, thisWindow] = behind.windows ?? [];
    if (!thisWindow?.tabs) throw new Error('no This window in the seed');
    thisWindow.tabs = thisWindow.tabs.map((t) => ({
      ...t,
      active: t.id === 21,
    }));
    await renderOpenNow(behind);
    expect(switchRow('Bravo')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('Last used tab')).toBeNull();
    expect(titleWeight('Bravo')).toBe('active');
    expect(titleWeight('Charlie')).toBe('plain');
  });
});
