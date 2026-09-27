import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';
import { OPEN_NOW_REFRESH_COALESCE_MS } from '../../hooks/useOpenWindows';

// KAN-280 O10b (supersedes O10a, KAN-315). The Open now speaker shows a
// tab's sound and changes nothing: Tab Keeper never mutes, because Chrome's
// own controls cannot undo an extension's mute (measured). The glyph is part
// of the tab's Switch button, so a click on it switches to the tab, where
// Chrome's own mute is. What it shows comes from Chrome's onUpdated through
// the live read (useOpenWindows). OpenNowColumn is rendered, not the pane, so
// every change comes back the way it does in Chrome. Real timers: a re-read
// is 50ms away, and waitFor waits for it.

// The tab view's own address, which the pane leaves out (the same trick as
// openNowClose.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;
const SOUND_WINDOW_ID = 2;
const RADIO = 21;
const PODCAST = 22;
const MEET = 23;
const DOCS = 24;

const url = (name: string) => `https://${name.toLowerCase()}.test/`;

// Window 1 is "This window" (the tab view and A). Window 2 holds one tab of
// each kind: playing, muted, playing and muted, and neither.
function soundWindows(): ChromeSeed {
  return {
    currentTabId: TAB_VIEW_ID,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: TAB_VIEW_ID, url: tabViewUrl(), title: 'Tab Keeper' },
          { id: 11, title: 'A', url: url('A') },
        ],
      },
      {
        id: SOUND_WINDOW_ID,
        tabs: [
          { id: RADIO, title: 'Radio', url: url('Radio'), audible: true },
          {
            id: PODCAST,
            title: 'Podcast',
            url: url('Podcast'),
            mutedInfo: { muted: true },
          },
          {
            id: MEET,
            title: 'Meet',
            url: url('Meet'),
            audible: true,
            mutedInfo: { muted: true },
          },
          { id: DOCS, title: 'Docs', url: url('Docs') },
        ],
      },
    ],
  };
}

async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    // Folded: the pane at any width, never the rail.
    <OpenNowColumn folded={true} />,
    { seed }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

const switchRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });
const closeTabButton = (title: string) =>
  screen.getByRole('button', { name: `Close tab: ${title}` });

function rowOf(tabId: number): HTMLElement {
  const row = document.querySelector(`[data-open-tab-id="${tabId}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${tabId}`);
  return row;
}

const queryGlyph = (tabId: number): HTMLElement | null =>
  rowOf(tabId).querySelector<HTMLElement>('[data-speaker]');

function glyph(tabId: number): HTMLElement {
  const found = queryGlyph(tabId);
  if (found === null) throw new Error(`no speaker glyph on ${tabId}`);
  return found;
}

// Long enough for a re-read that should NOT change anything to have landed.
const pastTheReRead = () =>
  new Promise((resolve) =>
    setTimeout(resolve, OPEN_NOW_REFRESH_COALESCE_MS * 2)
  );

async function isMutedInChrome(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  return tab.mutedInfo?.muted ?? false;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Open now speaker shows sound (KAN-280 O10b)', () => {
  test('volume_up on a playing tab, volume_off on a muted one playing or not, and nothing on a silent tab', async () => {
    await renderOpenNow(soundWindows());

    expect(glyph(RADIO)).toHaveTextContent(/^volume_up$/);
    expect(glyph(PODCAST)).toHaveTextContent(/^volume_off$/);
    // Muted while playing is still muted.
    expect(glyph(MEET)).toHaveTextContent(/^volume_off$/);
    // Neither playing nor muted: no glyph, and no empty slot for one.
    expect(queryGlyph(DOCS)).toBeNull();
  });

  test('is part of the Switch button and hidden from assistive tech, so the row has only Switch and ×', async () => {
    await renderOpenNow(soundWindows());

    for (const [id, title] of [
      [RADIO, 'Radio'],
      [PODCAST, 'Podcast'],
      [MEET, 'Meet'],
    ] as const) {
      expect(glyph(id).closest('button')).toBe(switchRow(title));
      // Its ligature text ("volume_up") must not leak into any name.
      const ligature = glyph(id).querySelector('.material-symbols-outlined');
      expect(ligature).not.toBeNull();
      expect(ligature?.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(within(rowOf(id)).getAllByRole('button')).toEqual([
        switchRow(title),
        closeTabButton(title),
      ]);
    }
    // The mute control is gone, under any name.
    expect(screen.queryByRole('button', { name: /mute/i })).toBeNull();
  });

  test('the tab order goes from Switch straight to ×', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();
    act(() => switchRow('Radio').focus());

    await user.tab();

    expect(document.activeElement).toBe(closeTabButton('Radio'));
  });

  test("the Switch button's description says the sound, and its name is unchanged", async () => {
    await renderOpenNow(soundWindows());

    expect(switchRow('Radio')).toHaveAccessibleDescription('Audio playing');
    expect(switchRow('Podcast')).toHaveAccessibleDescription('Audio muted');
    expect(switchRow('Meet')).toHaveAccessibleDescription('Audio muted');
    expect(switchRow('Docs')).not.toHaveAttribute('aria-describedby');
    expect(switchRow('Radio')).toHaveAccessibleName('Switch to tab: Radio');
  });

  test('a click on the glyph switches to the tab and never touches its mute', async () => {
    await renderOpenNow(soundWindows());
    const tabsUpdate = vi.spyOn(chrome.tabs, 'update');
    const windowsUpdate = vi.spyOn(chrome.windows, 'update');

    await userEvent.click(glyph(RADIO));
    await userEvent.click(glyph(MEET));

    await waitFor(() => expect(windowsUpdate).toHaveBeenCalledTimes(2));
    expect(tabsUpdate.mock.calls).toEqual([
      [RADIO, { active: true }],
      [MEET, { active: true }],
    ]);
    expect(windowsUpdate).toHaveBeenCalledWith(SOUND_WINDOW_ID, {
      focused: true,
    });
    expect(await isMutedInChrome(RADIO)).toBe(false);
    expect(await isMutedInChrome(MEET)).toBe(true);
  });

  test('a mute from elsewhere shows through the live read', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());
    // PREMISE: Docs starts with no glyph.
    expect(queryGlyph(DOCS)).toBeNull();

    act(() =>
      fake.browser.updateTab(DOCS, {
        mutedInfo: { muted: true, reason: 'user' },
      })
    );

    await waitFor(() => expect(glyph(DOCS)).toHaveTextContent(/^volume_off$/));
    expect(switchRow('Docs')).toHaveAccessibleDescription('Audio muted');
  });

  // O10a's rule 4A held a speaker up under the pointer so a click could not
  // lose its target. There is no control now, so nothing is held.
  test('an unmute or a stop from elsewhere takes the glyph away at once, even under the pointer', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(glyph(PODCAST));
    act(() =>
      fake.browser.updateTab(PODCAST, {
        mutedInfo: { muted: false, reason: 'user' },
      })
    );
    await waitFor(() => expect(queryGlyph(PODCAST)).toBeNull());
    expect(switchRow('Podcast')).not.toHaveAttribute('aria-describedby');

    await user.hover(glyph(RADIO));
    act(() => fake.browser.updateTab(RADIO, { audible: false }));
    await waitFor(() => expect(queryGlyph(RADIO)).toBeNull());
  });

  test('hovering or focusing a silent tab never grows it a glyph', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(switchRow('Docs'));
    act(() => switchRow('Docs').focus());
    await pastTheReRead();

    expect(queryGlyph(DOCS)).toBeNull();
  });
});
