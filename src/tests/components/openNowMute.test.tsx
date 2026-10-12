import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
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

  test("the Switch button's description says the sound, and its name is unchanged", async () => {
    await renderOpenNow(soundWindows());

    expect(switchRow('Radio')).toHaveAccessibleDescription('Audio playing');
    expect(switchRow('Podcast')).toHaveAccessibleDescription('Audio muted');
    expect(switchRow('Meet')).toHaveAccessibleDescription('Audio muted');
    expect(switchRow('Docs')).not.toHaveAttribute('aria-describedby');
    expect(switchRow('Radio')).toHaveAccessibleName('Switch to tab: Radio');
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
