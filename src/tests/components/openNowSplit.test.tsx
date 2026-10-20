import { describe, expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeSeed } from '../setup/chrome.fake';

// KAN-564 (picks A and P). Both halves of a live Chrome split show a split
// mark beside the pin and speaker, naming the other half; and when the split
// is on screen, the active bar marks both halves, whichever one Chrome calls
// active; since KAN-567 that mark is the title's weight.

function tabViewUrl(): string {
  const scratch = setupChromeFake();
  const url = chrome.runtime.getURL('index.html') + '?view=tab';
  scratch.restore();
  return url;
}

const url = (name: string) => `https://${name.toLowerCase()}.test/`;

// Window 2: Docs, then Wiki and Guide as one split with Guide active, then
// News. Window 3: an off-screen split, Maps and Notes, with Mail active.
function splitWindows(): ChromeSeed {
  return {
    splitView: true,
    currentTabId: 10,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, url: tabViewUrl(), title: 'Tab Keeper' },
          { id: 11, title: 'A', url: url('A') },
        ],
      },
      {
        id: 2,
        tabs: [
          { id: 21, title: 'Docs', url: url('Docs') },
          { id: 22, title: 'Wiki', url: url('Wiki'), splitViewId: 70 },
          {
            id: 23,
            title: 'Guide',
            url: url('Guide'),
            splitViewId: 70,
            active: true,
          },
          { id: 24, title: 'News', url: url('News') },
        ],
      },
      {
        id: 3,
        tabs: [
          { id: 31, title: 'Mail', url: url('Mail'), active: true },
          { id: 32, title: 'Maps', url: url('Maps'), splitViewId: 80 },
          { id: 33, title: 'Notes', url: url('Notes'), splitViewId: 80 },
        ],
      },
    ],
  };
}

async function renderOpenNow() {
  await renderWithProviders(<OpenNowColumn folded={true} />, {
    seed: splitWindows(),
  });
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
}

const switchRow = (title: string) =>
  screen.getByRole('button', { name: `Switch to tab: ${title}` });

const rowOf = (title: string): HTMLElement => {
  const row = switchRow(title).closest<HTMLElement>('[data-open-tab-id]');
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
};

// KAN-567 B. The tab on screen is marked by its title's weight: the label
// box NormalLabel draws around the title text.
const titleWeight = (title: string): 'active' | 'plain' => {
  const text = within(switchRow(title)).getByText(title);
  const label = text.parentElement;
  if (label === null) throw new Error(`no label for ${title}`);
  return getComputedStyle(label).fontWeight === '600' ? 'active' : 'plain';
};

const splitMark = (title: string) =>
  rowOf(title).querySelector<HTMLElement>('[data-split]');

describe('Open now shows a split view (KAN-564)', () => {
  test('both halves wear the split mark, named for the other half; other tabs do not', async () => {
    await renderOpenNow();
    for (const [title, other] of [
      ['Wiki', 'Guide'],
      ['Guide', 'Wiki'],
      ['Maps', 'Notes'],
      ['Notes', 'Maps'],
    ]) {
      expect(switchRow(title)).toHaveAccessibleDescription(
        `In a split view with “${other}”`
      );
      expect(splitMark(title)?.querySelector('[data-tooltip]')).toHaveAttribute(
        'data-tooltip',
        `In a split view with “${other}”`
      );
    }
    for (const title of ['Docs', 'News', 'Mail']) {
      expect(splitMark(title)).toBeNull();
      expect(switchRow(title)).not.toHaveAccessibleDescription(
        /In a split view/
      );
    }
  });

  test('a split on screen wears the active title on both halves; aria-current stays on the half Chrome calls active', async () => {
    await renderOpenNow();
    // CONTROL: a lone active tab wears it, and a tab not on screen does not.
    expect(titleWeight('Mail')).toBe('active');
    expect(titleWeight('Docs')).toBe('plain');
    expect(titleWeight('Wiki')).toBe('active');
    expect(titleWeight('Guide')).toBe('active');
    expect(switchRow('Guide')).toHaveAttribute('aria-current', 'true');
    expect(switchRow('Wiki')).not.toHaveAttribute('aria-current', 'true');
  });

  test('a split that is not on screen wears no active title', async () => {
    await renderOpenNow();
    expect(titleWeight('Maps')).toBe('plain');
    expect(titleWeight('Notes')).toBe('plain');
  });
});
