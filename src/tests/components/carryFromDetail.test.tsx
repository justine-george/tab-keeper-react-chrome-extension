import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { CarryLayer } from '../../components/home/CarryLayer';
import { currentCarry, endCarry } from '../../redux/carry';
import { endDragHold, isDragHeld } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { TAB_GROUP_COLOR_HEX } from '../../utils/functions/tabGroups';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2, s3 } from '../fixtures/sessionMoveFixture';
import { snapshot, layOut, tabRow } from '../setup/openNowDragHarness';
import { standInSessionList } from '../setup/standInSessionList';

// KAN-350: the three detail lists hand a drag reaching the session list (only there, KAN-352) to the carry, and the source is drawn without the item.
// The session list and Open now do not. S1 (shown): w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. Overflow inline and a pane box; zero row boxes suffice to start a drag.

const PANE_W = 400;
const box = (top: number, height: number, width = PANE_W): DOMRect =>
  DOMRect.fromRect({ x: 0, y: top, width, height });

// The session list, stood in left of the pane (x < 0), where the app draws
// it. Below it (y >= 500) is nothing.
let unregisterList = () => {};
beforeEach(() => {
  unregisterList = standInSessionList({
    left: -400,
    right: 0,
    top: 0,
    bottom: 500,
  }).unregister;
});

afterEach(() => {
  unregisterList();
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

async function renderDetail() {
  const result = await renderWithProviders(
    <>
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(s3()));
        store.dispatch(saveToTabContainerInternal(s2()));
        store.dispatch(saveToTabContainerInternal(s1()));
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  const pane = result.container.firstElementChild;
  if (!(pane instanceof HTMLElement)) throw new Error('no detail pane');
  pane.style.overflowY = 'auto';
  pane.getBoundingClientRect = () => box(0, 500);
  return result;
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}

// Pressed, carried past the activation distance, then out to the left of
// the pane and onto the session list.
function dragOutLeft(from: HTMLElement) {
  fireEvent.pointerDown(from, { clientX: 20, clientY: 10, button: 0 });
  fireEvent.pointerMove(document, { clientX: 20, clientY: 30 });
  act(() => {
    fireEvent.pointerMove(document, { clientX: -40, clientY: 30 });
  });
}

const rowIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-drag-row-id]')].map(
    (el) => el.dataset.dragRowId
  );

describe('each saved detail list hands a drag that reaches the session list to the carry', () => {
  test('a tab: carried by id, its card, and gone from the source', async () => {
    await renderDetail();
    // The premise.
    expect(rowIds()).toContain('t2');

    dragOutLeft(find('[data-drag-row-id="t2"]'));

    expect(currentCarry()).toEqual({
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      card: { kind: 'tab', title: 't2', faviconUrl: expect.any(String) },
      x: -40,
      y: 30,
      owner: 'layer',
    });
    expect(rowIds()).not.toContain('t2');
    expect(document.documentElement.getAttribute('data-dragging')).toBe('tab');
    // The card is up.
    expect(find('[data-carry-card-name]').textContent).toBe('t2');
  });

  test('a group: carried by id with its colour and count, and gone with its tabs', async () => {
    await renderDetail();
    const handle = find('[data-drag-row-id="group:g1"]').querySelector(
      '[data-group-drag-handle]'
    );
    if (!(handle instanceof HTMLElement)) throw new Error('no group handle');

    dragOutLeft(handle);

    expect(currentCarry()?.carried).toEqual({
      kind: 'group',
      tabGroupId: 'S1',
      windowId: 'w1',
      groupId: 'g1',
    });
    expect(currentCarry()?.card).toEqual({
      kind: 'group',
      title: 'Group g1',
      color: TAB_GROUP_COLOR_HEX.blue,
      tabCount: 2,
    });
    expect(rowIds()).not.toContain('group:g1');
    expect(rowIds()).not.toContain('g1a');
    expect(rowIds()).not.toContain('g1b');
    expect(rowIds()).toContain('t1');
    expect(document.documentElement.getAttribute('data-dragging')).toBe(
      'group'
    );
  });

  test('a window: carried by id, named by its title, and gone from the session', async () => {
    await renderDetail();
    const handle = find('[data-drag-row-id="w2"]').querySelector(
      '[data-window-drag-handle]'
    );
    if (!(handle instanceof HTMLElement)) throw new Error('no window handle');

    dragOutLeft(handle);

    expect(currentCarry()?.carried).toEqual({
      kind: 'window',
      tabGroupId: 'S1',
      windowId: 'w2',
    });
    expect(currentCarry()?.card).toEqual({
      kind: 'window',
      // The fixture's stored title for w2, which its header shows.
      title: 'Window w2',
      // KAN-394: its place in the session, for when it is unnamed.
      number: 2,
      tabCount: 1,
    });
    expect(rowIds()).not.toContain('w2');
    expect(rowIds()).not.toContain('t3');
    expect(document.documentElement.getAttribute('data-dragging')).toBe(
      'window'
    );
  });

  test('a window emptied by hiding its only tab keeps its header', async () => {
    await renderDetail();

    dragOutLeft(find('[data-drag-row-id="t3"]'));

    expect(currentCarry()?.carried).toMatchObject({ tabId: 't3' });
    expect(rowIds()).not.toContain('t3');
    expect(
      document.querySelector(
        '[data-drop-window-id="w2"] [data-window-drag-handle]'
      )
    ).not.toBeNull();
  });

  test('a release over nothing puts it back, and the store never changed', async () => {
    const { store } = await renderDetail();
    const before = store.getState().tabContainerDataState;
    dragOutLeft(find('[data-drag-row-id="t2"]'));
    expect(rowIds()).not.toContain('t2');

    // Off the list, below it: over nothing.
    act(() => {
      fireEvent.pointerMove(document, { clientX: -40, clientY: 600 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: -40, clientY: 600 });
    });

    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(rowIds()).toContain('t2');
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});

// The controls: the lists that must not hand off, dragged the same way --
// onto the stood-in list, where a saved detail list would hand off.
describe('the session list and Open now keep today’s drag on a carry receiver', () => {
  test('the session list', async () => {
    const { container } = await renderWithProviders(
      <TabGroupEntryContainer />,
      {
        seedStore: (store) => {
          store.dispatch(saveToTabContainerInternal(s3()));
          store.dispatch(saveToTabContainerInternal(s2()));
          store.dispatch(saveToTabContainerInternal(s1()));
        },
      }
    );
    const pane = container.firstElementChild;
    if (!(pane instanceof HTMLElement)) throw new Error('no session list');
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () => box(0, 500, 300);
    const row = find('[data-drag-row-id="S1"]');

    fireEvent.pointerDown(row, { clientX: 20, clientY: 10, button: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: -40, clientY: 30 });

    expect(currentCarry()).toBeNull();
    expect(document.querySelector('[data-drag-held]')).not.toBeNull();
    fireEvent.pointerUp(document, { clientX: -40, clientY: 30 });
  });

  test('Open now', async () => {
    const seed = {
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/', title: 'A', active: true },
            { id: 12, url: 'https://b.test/', title: 'B' },
          ],
        },
      ],
    };
    const props = {
      actions: [],
      headingId: 'open-now-heading',
      searchText: '',
      onSearchTextChange: () => undefined,
      searchInputRef: createRef<HTMLInputElement>(),
      onMoved: () => undefined,
    };
    const result = await renderWithProviders(
      <OpenNowPane windows={null} {...props} />,
      { seed }
    );
    const windows = await snapshot(false);
    result.rerender(<OpenNowPane windows={windows} {...props} />);
    await screen.findAllByRole('button', { name: /^Switch to tab: / });
    const top = layOut(windows);
    const pane = result.container.firstElementChild;
    if (!(pane instanceof HTMLElement)) throw new Error('no Open now pane');
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () => box(0, 500, 300);
    const from = (top.get('12') ?? 0) + 16;

    fireEvent.pointerDown(tabRow(12), {
      clientX: 10,
      clientY: from,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: from + 8 });
    fireEvent.pointerMove(document, { clientX: -400, clientY: from + 8 });

    expect(currentCarry()).toBeNull();
    expect(document.querySelector('[data-drag-held]')).not.toBeNull();
    fireEvent.pointerUp(document, { clientX: -400, clientY: from + 8 });
  });
});
