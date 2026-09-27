import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';
import { OPEN_NOW_REFRESH_COALESCE_MS } from '../../hooks/useOpenWindows';

// KAN-280 O10a. The Open now speaker: shown on a tab that plays sound or is
// muted, named for its tab, and a click mutes or unmutes the real tab. What
// it shows comes from Chrome's own onUpdated through the live read
// (useOpenWindows), never from the click. OpenNowColumn is rendered, not the
// pane, so every change comes back the way it does in Chrome. Real timers: a
// re-read is 50ms away, and waitFor waits for it.

// As openNowClose.test.tsx declares it: jsdom runs inside Node, but
// tsconfig omits @types/node.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

// The tab view's own address, which the pane leaves out (the same trick as
// openNowClose.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;
const RADIO = 21;
const PODCAST = 22;
const MEET = 23;
const DOCS = 24;

// The same rule as openNowClose.test.tsx's: an element's own emotion rules.
function rulesFor(element: HTMLElement): string[] {
  const classes = [...element.classList].map((name) => `.${name}`);
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.startsWith(name)));
}

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
        id: 2,
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

const speaker = (title: string) =>
  screen.getByRole('button', { name: `Mute tab: ${title}` });
const querySpeaker = (title: string) =>
  screen.queryByRole('button', { name: `Mute tab: ${title}` });
const switchRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });
const querySwitchRow = (title: string) =>
  screen.queryByRole('button', { name: `Switch to tab: ${title}` });
const closeTabButton = (title: string) =>
  screen.getByRole('button', { name: `Close tab: ${title}` });

function rowOf(tabId: number): HTMLElement {
  const row = document.querySelector(`[data-open-tab-id="${tabId}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${tabId}`);
  return row;
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

// Holds Chrome's answer to the next tabs.update until the test releases it:
// the mute, and its onUpdated, happen only then.
// Not bound: bind keeps only the last overload, the callback one, and the
// fake's update is an arrow function that needs no `this`.
function holdNextUpdate(): () => void {
  const realUpdate = chrome.tabs.update;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(chrome.tabs, 'update').mockImplementationOnce(
    async (tabId: number | undefined, props: chrome.tabs.UpdateProperties) => {
      await released;
      return realUpdate(tabId, props);
    }
  );
  return release;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Open now speaker (KAN-280 O10a)', () => {
  test('is shown on a playing or muted tab, named for it and pressed when muted', async () => {
    await renderOpenNow(soundWindows());

    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');
    expect(speaker('Podcast')).toHaveAttribute('aria-pressed', 'true');
    expect(speaker('Meet')).toHaveAttribute('aria-pressed', 'true');
    for (const title of ['Radio', 'Podcast', 'Meet']) {
      expect(speaker(title)).toHaveAttribute('title', 'Mute tab');
    }
    // In the row it names.
    expect(
      speaker('Podcast')
        .closest('[data-open-tab-id]')
        ?.getAttribute('data-open-tab-id')
    ).toBe(String(PODCAST));

    // Neither playing nor muted: no speaker, and no empty slot for one.
    expect(querySpeaker('Docs')).toBeNull();
    expect(rowOf(DOCS).querySelector('[data-speaker]')).toBeNull();
    expect(within(rowOf(DOCS)).getAllByRole('button')).toEqual([
      switchRow('Docs'),
      closeTabButton('Docs'),
    ]);
  });

  test('shows volume_off on a muted tab and volume_up otherwise', async () => {
    await renderOpenNow(soundWindows());

    expect(speaker('Radio')).toHaveAttribute('data-second-face-shown', 'false');
    expect(speaker('Podcast')).toHaveAttribute(
      'data-second-face-shown',
      'true'
    );
    // Muted while playing is still muted.
    expect(speaker('Meet')).toHaveAttribute('data-second-face-shown', 'true');

    // The two faces are the two glyphs, resting face first.
    const secondFace = speaker('Radio').querySelector('[data-second-face]');
    expect(secondFace).toHaveTextContent(/^volume_off$/);
    expect(secondFace?.previousElementSibling).toHaveTextContent(/^volume_up$/);
  });

  test('sits between Switch and × in the tab order', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();
    act(() => switchRow('Radio').focus());

    await user.tab();
    expect(document.activeElement).toBe(speaker('Radio'));
    await user.tab();
    expect(document.activeElement).toBe(closeTabButton('Radio'));
  });

  test('a click mutes the tab, and the glyph waits for Chrome', async () => {
    await renderOpenNow(soundWindows());
    const release = holdNextUpdate();

    await userEvent.click(speaker('Radio'));

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(RADIO, { muted: true });
    // Chrome has not answered: nothing on screen has changed.
    await pastTheReRead();
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');
    expect(speaker('Radio')).toHaveAttribute('data-second-face-shown', 'false');

    release();

    await waitFor(() =>
      expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'true')
    );
    expect(speaker('Radio')).toHaveAttribute('data-second-face-shown', 'true');
    expect(await isMutedInChrome(RADIO)).toBe(true);
  });

  test('a click on a muted tab unmutes it', async () => {
    await renderOpenNow(soundWindows());
    const update = vi.spyOn(chrome.tabs, 'update');

    await userEvent.click(speaker('Meet'));

    expect(update).toHaveBeenCalledWith(MEET, { muted: false });
    await waitFor(() =>
      expect(speaker('Meet')).toHaveAttribute('aria-pressed', 'false')
    );
    expect(await isMutedInChrome(MEET)).toBe(false);
  });

  test('a click never switches to the tab', async () => {
    await renderOpenNow(soundWindows());
    const tabsUpdate = vi.spyOn(chrome.tabs, 'update');
    const windowsUpdate = vi.spyOn(chrome.windows, 'update');

    await userEvent.click(speaker('Radio'));
    await waitFor(() =>
      expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'true')
    );

    // PREMISE: the click reached Chrome.
    expect(tabsUpdate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true })
    );
    expect(windowsUpdate).not.toHaveBeenCalled();
  });

  // KAN-280 O7c: a double-click is one toggle, not mute-then-unmute.
  test('a double-click toggles once', async () => {
    await renderOpenNow(soundWindows());
    const update = vi.spyOn(chrome.tabs, 'update');

    await userEvent.dblClick(speaker('Radio'));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(RADIO, { muted: true });
    await waitFor(() =>
      expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  // Both clicks read the same snapshot, so both send the same value, and
  // the tab ends muted. An optimistic toggle would send mute, then unmute.
  test('two quick clicks before the re-read both mute', async () => {
    await renderOpenNow(soundWindows());
    const update = vi.spyOn(chrome.tabs, 'update');

    // Two separate single clicks, not a double-click, both before React
    // re-renders or the re-read runs.
    act(() => {
      fireEvent.click(speaker('Radio'), { detail: 1 });
      fireEvent.click(speaker('Radio'), { detail: 1 });
    });

    expect(update.mock.calls).toEqual([
      [RADIO, { muted: true }],
      [RADIO, { muted: true }],
    ]);
    await waitFor(() =>
      expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'true')
    );
    await pastTheReRead();
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'true');
    expect(await isMutedInChrome(RADIO)).toBe(true);
  });

  test('a click on a tab that has just closed does nothing, and its row goes', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const { chrome: fake } = await renderOpenNow(soundWindows());
      const tabsUpdate = vi.spyOn(chrome.tabs, 'update');
      const windowsUpdate = vi.spyOn(chrome.windows, 'update');
      const button = speaker('Radio');

      // Closed in Chrome, and clicked before the re-read drops the row.
      act(() => {
        fake.browser.closeTab(RADIO);
        fireEvent.click(button, { detail: 1 });
      });

      // PREMISE: the click reached Chrome, which refused it.
      expect(tabsUpdate).toHaveBeenCalledWith(RADIO, { muted: true });
      await expect(tabsUpdate.mock.results[0]?.value).rejects.toThrow(
        'No tab with id'
      );
      await waitFor(() => expect(querySwitchRow('Radio')).toBeNull());
      // Long enough for an unhandled rejection to be reported.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(rejections).toEqual([]);
      expect(tabsUpdate).toHaveBeenCalledTimes(1);
      expect(windowsUpdate).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  test('a mute from elsewhere shows through the live read', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());
    // PREMISE: Docs starts with no speaker.
    expect(querySpeaker('Docs')).toBeNull();

    act(() =>
      fake.browser.updateTab(DOCS, {
        mutedInfo: { muted: true, reason: 'user' },
      })
    );

    await waitFor(() =>
      expect(speaker('Docs')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  // The speaker is always shown, so it is not part of the × strip's reveal
  // (O7d): the strip reveals on :has(:focus-visible), which only a control
  // inside it can match.
  test('focus on the speaker does not reveal ×', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();
    act(() => switchRow('Radio').focus());

    await user.tab();

    expect(document.activeElement).toBe(speaker('Radio'));
    const strip = closeTabButton('Radio').closest('[data-close-tab]');
    if (!(strip instanceof HTMLElement)) throw new Error('no × strip');
    // PREMISE: the strip's reveal is the one keyed on focus inside it.
    expect(rulesFor(strip)).toContainEqual(
      expect.stringMatching(/:has\(:focus-visible\)>\* \{ opacity: 1; \}/)
    );
    expect(speaker('Radio').closest('[data-close-tab]')).toBeNull();
    expect(strip.contains(document.activeElement)).toBe(false);
  });
});

describe('a speaker held by the pointer or focus (KAN-280 O10a rule 4A)', () => {
  // Review Focus 1: the reason goes away as Chrome answers the click. The
  // speaker must not flash out and back while the pointer is still on it.
  test('unmuting a silent tab under the pointer keeps the speaker up until it leaves', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(speaker('Podcast'));
    // fireEvent, not userEvent.click: a real click also focuses the button,
    // which would hold the speaker up on its own and hide what the pointer
    // alone is doing here.
    fireEvent.click(speaker('Podcast'), { detail: 1 });
    await waitFor(() =>
      expect(speaker('Podcast')).toHaveAttribute('aria-pressed', 'false')
    );
    // The re-read that follows must not pull it out from under the pointer.
    await pastTheReRead();
    expect(speaker('Podcast')).toHaveAttribute('aria-pressed', 'false');
    expect(speaker('Podcast')).toHaveAttribute(
      'data-second-face-shown',
      'false'
    );

    await user.unhover(speaker('Podcast'));
    expect(querySpeaker('Podcast')).toBeNull();
  });

  // Review Focus 2: sound stops between tracks while the pointer is still on
  // the speaker. Same hold, same exit.
  test('a tab that stops playing under the pointer keeps its speaker up until it leaves', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(speaker('Radio'));
    act(() => fake.browser.updateTab(RADIO, { audible: false }));
    await pastTheReRead();
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');

    await user.unhover(speaker('Radio'));
    expect(querySpeaker('Radio')).toBeNull();
  });

  test('focus holds a speaker up the same way, and moving on releases it', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();
    act(() => switchRow('Podcast').focus());

    await user.tab();
    expect(document.activeElement).toBe(speaker('Podcast'));

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(speaker('Podcast')).toHaveAttribute('aria-pressed', 'false')
    );
    expect(document.activeElement).toBe(speaker('Podcast'));

    await user.tab();
    expect(document.activeElement).toBe(closeTabButton('Podcast'));
    expect(querySpeaker('Podcast')).toBeNull();
  });

  // CONTROL: proves the hold above, rather than a stale read, is what keeps
  // the speaker up. Must stay green throughout.
  test('CONTROL: without the pointer or focus, a speaker goes as soon as its reason does', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());

    act(() => fake.browser.updateTab(RADIO, { audible: false }));

    await waitFor(() => expect(querySpeaker('Radio')).toBeNull());
  });

  // KAN-127: the hold is keyed by tab id, not "a pointer is somewhere on the
  // pane". A stale leave from a tab that was never held must not release a
  // different tab's hold -- ordered so that mattering is exactly what a
  // clear-unconditionally bug would get wrong.
  test('a hold on one tab is not released by a leave from another', async () => {
    const { chrome: fake } = await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(speaker('Radio'));
    act(() => fake.browser.updateTab(RADIO, { audible: false }));
    await pastTheReRead();
    // PREMISE: Radio's speaker is up only because the pointer holds it.
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');

    // Meet's speaker was never hovered, so its leave carries Meet's id, not
    // Radio's -- it must not clear Radio's hold.
    fireEvent.mouseLeave(speaker('Meet'));
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');

    act(() => fake.browser.updateTab(MEET, { audible: false }));
    await act(async () => {
      await chrome.tabs.update(MEET, { muted: false });
    });

    await waitFor(() => expect(querySpeaker('Meet')).toBeNull());
    expect(speaker('Radio')).toHaveAttribute('aria-pressed', 'false');
  });

  // Only a speaker that is already shown can be held: hovering a silent,
  // unmuted tab's row (where a speaker would sit) never grows one.
  test('hovering a silent tab never grows it a speaker', async () => {
    await renderOpenNow(soundWindows());
    const user = userEvent.setup();

    await user.hover(rowOf(DOCS));

    expect(querySpeaker('Docs')).toBeNull();
  });
});
