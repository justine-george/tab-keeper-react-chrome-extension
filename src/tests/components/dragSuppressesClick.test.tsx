import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { TabDragArea } from '../../components/home/rightpane/TabDragArea';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// A drag must not also open the tab it moved. Chrome dispatches a click after mouseup on the held row. Measured in the
// popup: it opens the tab ONLY when the drop moves nothing -- a committed move re-parents the node first -- so it looked
// intermittent. jsdom synthesizes no click, so it is dispatched here, as the browser does.

const TABS: tabData[] = [
  { tabId: 't1', favicon: '', title: 'One', url: 'https://one.test' },
  { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.test' },
  { tabId: 't3', favicon: '', title: 'Three', url: 'https://three.test' },
];

const render = () =>
  renderWithProviders(
    // A window renders no tab list of its own (KAN-132); this gives it TabGroupDetailsContainer's shape.
    <TabDragArea
      tabList={{
        tabGroupId: 'tg1',
        windows: [{ windowId: 'w1', tabs: TABS, chromeTabGroups: undefined }],
      }}
    >
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />
    </TabDragArea>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(false));
      },
    }
  );

// labelled element (ClickableRow) -> row div -> the draggable node
const draggableFor = (title: string): HTMLElement => {
  const el = screen.getByLabelText(`Open in new tab: ${title}`);
  const node = el.parentElement?.parentElement;
  if (!node) throw new Error(`no draggable node for ${title}`);
  return node;
};

describe('a drag does not also open the tab', () => {
  let seen: number;
  let spy: (e: Event) => void;

  beforeEach(() => {
    seen = 0;
    spy = () => {
      seen += 1;
    };
    // Bubble phase on document, where React delegates: a click this misses, no row handler runs on.
    document.addEventListener('click', spy);
  });

  afterEach(() => {
    document.removeEventListener('click', spy);
    vi.useRealTimers();
  });

  // CONTROL: a suppression that swallowed EVERY click would pass the test below.
  test('CONTROL: a plain click with no drag still reaches the row', async () => {
    await render();
    const node = draggableFor('Two');

    fireEvent.pointerDown(node, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.click(node, { clientX: 10, clientY: 20 });

    expect(seen).toBe(1);
  });

  // A press that wanders below the activation distance is still a click, and
  // must still open the tab.
  test('CONTROL: a press that never crosses the threshold still clicks', async () => {
    await render();
    const node = draggableFor('Two');

    fireEvent.pointerDown(node, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.pointerMove(document, { clientX: 11, clientY: 22, button: 0 });
    fireEvent.pointerUp(document, { clientX: 11, clientY: 22, button: 0 });
    fireEvent.click(node, { clientX: 11, clientY: 22 });

    expect(seen).toBe(1);
  });

  // Spent by its own drag: left armed, it would eat the NEXT ordinary click.
  test('only the one click is swallowed, not the next one', async () => {
    await render();
    const node = draggableFor('Two');

    fireEvent.pointerDown(node, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 100, button: 0 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 100, button: 0 });
    fireEvent.click(node, { clientX: 10, clientY: 100 });
    expect(seen).toBe(0);

    fireEvent.click(draggableFor('Three'), { clientX: 10, clientY: 140 });
    expect(seen).toBe(1);
  });
});
