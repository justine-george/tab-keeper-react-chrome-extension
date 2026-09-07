import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// A drag must not also open the tab it moved.
//
// Chrome synthesizes a `click` after `mouseup`, and the held row is translated
// to follow the pointer, so the row is still the target at release. Measured in
// the real popup: the click reaches the row's ClickableRow and opens the tab --
// but ONLY when the drop commits no reorder. A committed move makes React move
// the DOM node during the pointerup handler, before the click is dispatched,
// which is what swallowed it and made the bug look intermittent. The drags that
// move nothing are precisely the ones that open a tab.
//
// jsdom does not synthesize a click from a pointer sequence, so the click is
// dispatched explicitly here -- which is exactly what the browser does, and
// what the suppression has to intercept.

const TABS: tabData[] = [
  { tabId: 't1', favicon: '', title: 'One', url: 'https://one.test' },
  { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.test' },
  { tabId: 't3', favicon: '', title: 'Three', url: 'https://three.test' },
];

const render = () =>
  renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={TABS}
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

// labelled element (ClickableRow) -> row div -> the draggable node
const draggableFor = (title: string): HTMLElement => {
  const el = screen.getByLabelText(`Open in new tab: ${title}`);
  const node = el.parentElement?.parentElement;
  if (!node) throw new Error(`no draggable node for ${title}`);
  return node as HTMLElement;
};

describe('a drag does not also open the tab', () => {
  let seen: number;
  let spy: (e: Event) => void;

  beforeEach(() => {
    seen = 0;
    spy = () => {
      seen += 1;
    };
    // Bubble phase on document is where React's root delegation sits, so a
    // click this listener never sees is a click no row handler runs on.
    document.addEventListener('click', spy);
  });

  afterEach(() => {
    document.removeEventListener('click', spy);
    vi.useRealTimers();
  });

  // THE CONTROL. Without it, a suppression that swallowed EVERY click would
  // pass the test below while breaking the pane's primary action.
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

  test('the click that follows a real drag is swallowed', async () => {
    await render();
    const node = draggableFor('Two');

    fireEvent.pointerDown(node, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 60, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 100, button: 0 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 100, button: 0 });
    fireEvent.click(node, { clientX: 10, clientY: 100 });

    expect(seen).toBe(0);
  });

  // The suppression must be spent by the drag it belongs to. Left armed, the
  // NEXT ordinary click on any row would be eaten instead.
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
