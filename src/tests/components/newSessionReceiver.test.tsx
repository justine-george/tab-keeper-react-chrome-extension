import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from '@testing-library/react';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import {
  carryReceiverAt,
  endCarry,
  startCarry,
  type CarryReceiver,
} from '../../redux/carry';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setSearchInputText,
  tourStartedHere,
  tourStoppedHere,
} from '../../redux/slices/globalStateSlice';
import { recordSampleTour } from '../../redux/slices/settingsDataStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2, tabIds } from '../fixtures/sessionMoveFixture';

// KAN-394 P3. The save row as a carry receiver: hit on its own box, lit on
// hover, and a release there makes the carried item a new session.

const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const GONE: CarriedRef = { ...T1, tabId: 'nowhere' };

// The save row's box; every other element's is far away.
let rowBox = DOMRect.fromRect({ x: 0, y: 100, width: 340, height: 58 });

beforeEach(() => {
  rowBox = DOMRect.fromRect({ x: 0, y: 100, width: 340, height: 58 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return this instanceof HTMLElement && this.dataset.saveRow !== undefined
        ? rowBox
        : DOMRect.fromRect({ x: 0, y: 2000, width: 0, height: 0 });
    }
  );
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  vi.restoreAllMocks();
});

async function renderRow() {
  return renderWithProviders(<UserInputContainer />, {
    seedStore: (store) => {
      store.dispatch(saveToTabContainerInternal(s1()));
      store.dispatch(saveToTabContainerInternal(s2()));
      store.dispatch(selectTabContainer('S1'));
    },
  });
}

const target = () => document.querySelector('[data-new-session-target]');

function receiverOnRow(): CarryReceiver {
  const r = carryReceiverAt(10, 120);
  if (r === null) throw new Error('nothing takes a carry on the save row');
  return r;
}

function carry(carried: CarriedRef): void {
  act(() =>
    startCarry(carried, { kind: 'tab', title: 't1', faviconUrl: '' }, 10, 120)
  );
}

describe('the save row as a carry receiver', () => {
  test('is there at rest, with its target drawn over the row, hidden from screen readers', async () => {
    await renderRow();
    expect(carryReceiverAt(10, 120)).not.toBeNull();
    expect(target()?.getAttribute('aria-hidden')).toBe('true');
    expect(target()?.parentElement?.hasAttribute('data-save-row')).toBe(true);
    expect(target()?.textContent).toContain('New session');
  });

  test('is not there while searching, and draws no target', async () => {
    const { store } = await renderRow();
    // CONTROL: at rest it is.
    expect(carryReceiverAt(10, 120)).not.toBeNull();

    act(() => {
      store.dispatch(setSearchInputText('t1'));
    });

    expect(carryReceiverAt(10, 120)).toBeNull();
    expect(target()).toBeNull();
  });

  // F18. While this page shows the tour, the row stays the save row.
  test('is not there while this page runs the tour, and draws no target', async () => {
    const { store } = await renderRow();
    act(() => {
      store.dispatch(
        recordSampleTour({ sampleId: 'S1', step: 4, view: 'popup' })
      );
      store.dispatch(tourStartedHere('S1'));
    });

    expect(carryReceiverAt(10, 120)).toBeNull();
    expect(target()).toBeNull();

    // CONTROL: the tour stopped here, it is back.
    act(() => {
      store.dispatch(tourStoppedHere());
    });
    expect(carryReceiverAt(10, 120)).not.toBeNull();
    expect(target()).not.toBeNull();
  });

  test('is hit on the row’s box as it is now', async () => {
    await renderRow();
    const r = receiverOnRow();
    expect(r.hit(0, 100)).toBe(true);
    expect(r.hit(339, 157)).toBe(true);
    expect(r.hit(340, 120)).toBe(false);
    expect(r.hit(10, 158)).toBe(false);
    expect(r.hit(10, 99)).toBe(false);

    rowBox = DOMRect.fromRect({ x: 0, y: 300, width: 340, height: 58 });
    expect(r.hit(10, 120)).toBe(false);
    expect(r.hit(10, 320)).toBe(true);
    // measureHit keeps the box it read.
    const measured = r.measureHit?.();
    rowBox = DOMRect.fromRect({ x: 0, y: 100, width: 340, height: 58 });
    expect(measured?.(10, 320)).toBe(true);
  });

  test('hover lights the target and leave unlights it', async () => {
    await renderRow();
    const r = receiverOnRow();
    // PREMISE: unlit at rest.
    expect(target()?.hasAttribute('data-landing')).toBe(false);

    act(() => r.hover(10, 120));
    expect(target()?.hasAttribute('data-landing')).toBe(true);
    act(() => r.leave());
    expect(target()?.hasAttribute('data-landing')).toBe(false);
  });

  test('take with a carried tab makes it a new session on top, selected, and says it did', async () => {
    const { store } = await renderRow();
    const before = store.getState().tabContainerDataState.tabGroups.length;
    carry(T1);

    let taken = false;
    act(() => {
      taken = receiverOnRow().take();
    });

    expect(taken).toBe(true);
    const state = store.getState().tabContainerDataState;
    expect(state.tabGroups).toHaveLength(before + 1);
    const made = state.tabGroups[0];
    expect(made.title).toBe('t1');
    expect(made.windows.map(tabIds)).toEqual([['t1']]);
    expect(state.selectedTabGroupId).toBe(made.tabGroupId);
  });

  // The worst path: the carried item went away before the release.
  test('take with the item gone changes nothing and says so', async () => {
    const { store } = await renderRow();
    carry(GONE);
    const before = store.getState().tabContainerDataState;

    let taken = true;
    act(() => {
      taken = receiverOnRow().take();
    });

    expect(taken).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
  });
});
