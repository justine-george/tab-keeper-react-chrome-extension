import { describe, expect, test } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-127. The row's hover reveal was keyed by POSITION
// (`hoveredChildIndex === index`), so anything that reordered the tab list left
// the wrong row's delete icon showing. Reachable today through a sync adopting
// the other device's window under a stationary pointer, and routine once
// drag-to-reorder ships.
//
// Probed on the action block's own `background-color`, which is a direct
// property on that element, rather than on the `& > *` opacity rule beside it:
// jsdom does not resolve child combinators for computed style, which is how
// three earlier versions of a sibling test passed against the bug it was
// written for.

const TABS: tabData[] = [
  { tabId: 't1', favicon: '', title: 'One', url: 'https://one.test' },
  { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.test' },
  { tabId: 't3', favicon: '', title: 'Three', url: 'https://three.test' },
];

const render = (tabs: tabData[]) =>
  renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={tabs}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(false));
      },
    }
  );

// The row is the nearest ancestor of the tab's link that also contains an
// absolutely positioned action block.
const rowFor = (title: string): HTMLElement => {
  let node: HTMLElement | null = screen.getByLabelText(
    `Open in new tab: ${title}`
  );
  while (node && getComputedStyle(node).position !== 'relative') {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no row found for ${title}`);
  return node;
};

const actionBlockFor = (title: string): HTMLElement => {
  const row = rowFor(title);
  const block = [...row.children].find(
    (child) => getComputedStyle(child as HTMLElement).position === 'absolute'
  );
  if (!block) throw new Error(`no action block found for ${title}`);
  return block as HTMLElement;
};

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const isRevealed = (title: string) =>
  getComputedStyle(actionBlockFor(title)).backgroundColor !== TRANSPARENT;

describe('a tab row keeps its hover state when the list reorders', () => {
  test('CONTROL: hovering a row reveals that row and no other', async () => {
    await render(TABS);

    expect(isRevealed('Two')).toBe(false);

    fireEvent.mouseEnter(rowFor('Two'));

    expect(isRevealed('Two')).toBe(true);
    expect(isRevealed('One')).toBe(false);
    expect(isRevealed('Three')).toBe(false);
  });

  test('the reveal follows the tab, not the position it used to sit at', async () => {
    const { rerender } = await render(TABS);

    fireEvent.mouseEnter(rowFor('Two'));
    expect(isRevealed('Two')).toBe(true);

    // Two moves to the front. Nothing about the pointer changed, so no
    // mouseleave fires -- which is exactly the sync case.
    const reordered = [TABS[1], TABS[0], TABS[2]];
    rerender(
      <WindowEntryContainer
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={reordered}
        onWindowTitleClick={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />
    );

    expect(isRevealed('Two')).toBe(true);
    expect(isRevealed('One')).toBe(false);
  });
});
