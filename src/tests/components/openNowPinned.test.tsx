import { beforeEach, describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-280 O11c (Part E, Justine's pick P1). A pinned tab's row shows a pin
// mark, Material Symbols `keep`, in the icon slot left of ×: the O10b
// speaker's slot. A pinned tab that plays sound shows both, pin first. The
// mark is part of the Switch button and aria-hidden; "Pinned" reaches
// assistive tech as the Switch button's description, beside the sound's.
// OpenNowColumn is rendered, not the pane, so the rows come from the live
// read as they do in Chrome.

// The tab view's own address, which the pane leaves out (the same trick as
// openNowMute.test.tsx).
function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const TAB_VIEW_ID = 10;
const MAIL = 21;
const RADIO = 22;
const DOCS = 23;

const url = (name: string) => `https://${name.toLowerCase()}.test/`;

// Window 1 is "This window" (the tab view and A). Window 2 holds a pinned
// silent tab, a pinned playing tab, and an unpinned silent one. Pinned tabs
// come first in a real window, and the seed keeps that order.
function pinnedWindows(): ChromeSeed {
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
          { id: MAIL, title: 'Mail', url: url('Mail'), pinned: true },
          {
            id: RADIO,
            title: 'Radio',
            url: url('Radio'),
            pinned: true,
            audible: true,
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

const queryPin = (tabId: number): HTMLElement | null =>
  rowOf(tabId).querySelector<HTMLElement>('[data-pin]');

function pin(tabId: number): HTMLElement {
  const found = queryPin(tabId);
  if (found === null) throw new Error(`no pin mark on ${tabId}`);
  return found;
}

beforeEach(() => {
  localStorage.clear();
});

describe('the Open now pin mark (KAN-280 O11c)', () => {
  test('keep on a pinned tab, playing or not, and nothing on an unpinned one', async () => {
    await renderOpenNow(pinnedWindows());

    expect(pin(MAIL)).toHaveTextContent(/^keep$/);
    expect(pin(RADIO)).toHaveTextContent(/^keep$/);
    expect(queryPin(DOCS)).toBeNull();
    // CONTROL: the unpinned tab is a real row, only without the mark.
    expect(switchRow('Docs')).toBeInTheDocument();
  });

  test('is part of the Switch button and hidden from assistive tech, so the row has only Switch and ×', async () => {
    await renderOpenNow(pinnedWindows());

    for (const [id, title] of [
      [MAIL, 'Mail'],
      [RADIO, 'Radio'],
    ] as const) {
      expect(pin(id).closest('button')).toBe(switchRow(title));
      // Its ligature text ("keep") must not leak into any name.
      const ligature = pin(id).querySelector('.material-symbols-outlined');
      expect(ligature).not.toBeNull();
      expect(ligature?.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(within(rowOf(id)).getAllByRole('button')).toEqual([
        switchRow(title),
        closeTabButton(title),
      ]);
    }
  });

  test('a pinned tab that plays sound shows both marks, pin first', async () => {
    await renderOpenNow(pinnedWindows());

    const speaker = rowOf(RADIO).querySelector('[data-speaker]');
    expect(speaker).not.toBeNull();
    expect(speaker).toHaveTextContent(/^volume_up$/);
    // DOM order is the row's left-to-right order: the slot is a flex row.
    const marks = [
      ...rowOf(RADIO).querySelectorAll('[data-pin], [data-speaker]'),
    ];
    expect(marks.map((mark) => mark.textContent)).toEqual([
      'keep',
      'volume_up',
    ]);
    expect(pin(RADIO).closest('button')).toBe(speaker?.closest('button'));
  });

  test("the Switch button's description says Pinned, before the sound, and its name is unchanged", async () => {
    await renderOpenNow(pinnedWindows());

    expect(switchRow('Mail')).toHaveAccessibleDescription('Pinned');
    expect(switchRow('Radio')).toHaveAccessibleDescription(
      'Pinned Audio playing'
    );
    expect(switchRow('Docs')).not.toHaveAttribute('aria-describedby');
    expect(switchRow('Mail')).toHaveAccessibleName('Switch to tab: Mail');
    expect(switchRow('Radio')).toHaveAccessibleName('Switch to tab: Radio');
  });
});
