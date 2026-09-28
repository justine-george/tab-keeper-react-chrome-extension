import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';

afterEach(() => cleanup());

const url = (name: string) =>
  `https://${name.toLowerCase().replace(/\s+/g, '-')}.test/`;
const tab = (
  id: number,
  title: string,
  extra: Partial<{ pinned: boolean; groupId: number; active: boolean }> = {}
) => ({
  id,
  title,
  url: url(title),
  pinned: false,
  audible: false,
  ...extra,
});

// W1: Kyoto maps*, Osaka flights, Rail pass. W2: Temple list*, Kyoto stay.
// W3: Laws of UX*. (* = the window's front tab.) Kyoto stay sits BEHIND its
// window's front tab, so a switch to it is a visible change (O6).
const threeWindows = (): ChromeSeed => ({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        tab(11, 'Kyoto maps', { active: true }),
        tab(12, 'Osaka flights'),
        tab(13, 'Rail pass'),
      ],
    },
    {
      id: 2,
      tabs: [tab(21, 'Temple list', { active: true }), tab(22, 'Kyoto stay')],
    },
    { id: 3, tabs: [tab(31, 'Laws of UX', { active: true })] },
  ],
});

// Folded: the pane at any width, never the rail (as openNowClose.test.tsx).
async function renderOpenNow(seed: ChromeSeed) {
  const result = await renderWithProviders(
    <>
      <OpenNowColumn folded={true} />
      <Toast />
    </>,
    { seed }
  );
  await screen.findAllByRole('button', { name: /^Switch to tab: / });
  return result;
}

const field = () => screen.getByRole('textbox', { name: 'Search open tabs' });

describe('the search row in Open now (KAN-330 O14)', () => {
  test('sits at the top of the list box, outside the scroller, and the header is unchanged', async () => {
    await renderOpenNow(threeWindows());
    const row = document.querySelector('[data-open-now-search]');
    const header = document.querySelector('[data-open-now-header]');
    expect(row).not.toBeNull();
    expect(header?.contains(row)).toBe(false);
    // The list box is the header's next sibling; the row is its first child,
    // and the rows scroll in the box's second child, not in the box.
    const box = header?.nextElementSibling;
    expect(box?.firstElementChild).toBe(row);
    expect(
      box?.children[1]?.querySelector('[data-open-window-id]')
    ).not.toBeNull();
  });

  test('↓ in the field moves to the first tab drawn', async () => {
    await renderOpenNow(threeWindows());
    act(() => field().focus());
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Switch to tab: Kyoto maps' })
    );
  });

  test('Enter in an empty field switches nothing', async () => {
    await renderOpenNow(threeWindows());
    const update = vi.spyOn(chrome.tabs, 'update');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(update).not.toHaveBeenCalled();
  });
});
