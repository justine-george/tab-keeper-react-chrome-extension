import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { toOpenWindows } from '../../utils/functions/openNow';

// KAN-720. Open now's window and group rows say how many tabs they draw.

const tab = (title: string, groupId?: number) => ({
  title,
  url: `https://${title.toLowerCase()}.test/`,
  pinned: false,
  audible: false,
  ...(groupId === undefined ? {} : { groupId }),
});

// One window: a loose tab, then two tabs in the "Research" group.
const groupedWindow = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [tab('Loose'), tab('G1', 50), tab('G2', 50)],
    },
  ],
  tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
});

const twoWindows = (): ChromeSeed => ({
  windows: [
    { id: 1, focused: true, tabs: [tab('A')] },
    { id: 2, focused: false, tabs: [tab('B'), tab('C')] },
  ],
});

async function renderPane(
  seed: ChromeSeed,
  { thisWindowId = 99, searchText = '' } = {}
) {
  const props = {
    titleActions: [],
    headingId: 'open-now-heading',
    onSearchTextChange: () => undefined,
    searchInputRef: createRef<HTMLInputElement>(),
  };
  const result = await renderWithProviders(
    <OpenNowPane windows={null} searchText="" {...props} />,
    { seed }
  );
  const windows = toOpenWindows(
    await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    await chrome.tabGroups.query({}),
    thisWindowId
  );
  result.rerender(
    <OpenNowPane windows={windows} searchText={searchText} {...props} />
  );
  return result;
}

const tagTexts = (root: ParentNode) =>
  [...root.querySelectorAll('[data-row-tag]')].map((el) => el.textContent);

const windowRowTags = (windowId: number) =>
  tagTexts(
    document.querySelector(
      `[data-open-window-id="${windowId}"] [data-open-window-drag-handle]`
    ) as HTMLElement
  );

const groupBand = (name: string) =>
  screen
    .getByRole('button', { name: `Rename group: ${name}` })
    .closest('[data-group-drag-handle]') as HTMLElement;

describe('Open now row counts (KAN-720)', () => {
  test('a window row tags its tab count, before "This window"', async () => {
    await renderPane(groupedWindow(), { thisWindowId: 1 });
    expect(windowRowTags(1)).toEqual(['3 Tabs', 'This window']);
  });

  test('a group row tags the tabs in its group', async () => {
    await renderPane(groupedWindow());
    expect(tagTexts(groupBand('Research'))).toEqual(['2 Tabs']);
  });

  test('other windows tag their count and have no "This window"', async () => {
    await renderPane(twoWindows());
    expect(windowRowTags(1)).toEqual(['1 Tab']);
    expect(windowRowTags(2)).toEqual(['2 Tabs']);
  });

  test('during a search each tag counts the matching tabs only', async () => {
    await renderPane(
      {
        windows: [
          {
            id: 1,
            tabs: [
              tab('Loose'),
              ...['G1', 'G2', 'G3', 'G4', 'G5'].map((t) => tab(t, 50)),
            ],
          },
        ],
        tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
      },
      { searchText: 'G3' }
    );
    expect(tagTexts(groupBand('Research'))).toEqual(['1 Tab']);
    expect(windowRowTags(1)).toEqual(['1 Tab']);
  });

  test("the window tags add up to the header's matched count", async () => {
    await renderPane(
      {
        windows: [
          { id: 1, tabs: [tab('Alpha one'), tab('Alpha two'), tab('Zed')] },
          { id: 2, tabs: [tab('Alpha three'), tab('Yak')] },
        ],
      },
      { searchText: 'Alpha' }
    );
    const header = document.querySelector('[data-open-now-header]');
    // "2 Windows · 3 of 5 Tabs": the matched number is the one before "of".
    const matched = Number(/(\d+) of \d+/.exec(header?.textContent ?? '')?.[1]);
    const sum = [1, 2]
      .map((id) => Number(/^\d+/.exec(windowRowTags(id)[0] ?? '')?.[0]))
      .reduce((a, b) => a + b, 0);
    expect(matched).toBe(3);
    expect(sum).toBe(matched);
  });

  test('a group row hides its tag while the group is being renamed', async () => {
    const user = userEvent.setup();
    await renderPane(groupedWindow());
    await user.click(
      screen.getByRole('button', { name: 'Rename group: Research' })
    );
    const input = await screen.findByRole('textbox', {
      name: 'Rename group: Research',
    });
    expect(
      input.closest('[data-group-drag-handle]')?.querySelector('[data-row-tag]')
    ).toBeNull();
  });
});
