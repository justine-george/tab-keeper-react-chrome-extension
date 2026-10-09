import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useRef } from 'react';

import { useNewFirstWindowReceiver } from '../../components/home/rightpane/useNewFirstWindowReceiver';
import { carryReceiverAt, endCarry, startCarry } from '../../redux/carry';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2 } from '../fixtures/sessionMoveFixture';

// KAN-361: the header target, as a receiver, hit-tests the element its ref holds, not the document's first match. A decoy sits first here.

const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};

const box = (top: number) =>
  DOMRect.fromRect({ x: 0, y: top, width: 400, height: 32 });

function Header() {
  const ref = useRef<HTMLDivElement>(null);
  useNewFirstWindowReceiver(ref, 'S2');
  return (
    <>
      <div data-new-window-target="first" data-decoy="" />
      <div ref={ref} data-new-window-target="first" data-own="" />
    </>
  );
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      if (this instanceof HTMLElement && this.dataset.own !== undefined) {
        return box(100);
      }
      return box(0);
    }
  );
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  vi.restoreAllMocks();
});

describe('the header’s New window target as a carry receiver', () => {
  test('is hit on its own element, and lights that one', async () => {
    await renderWithProviders(<Header />, {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(s1()));
        store.dispatch(saveToTabContainerInternal(s2()));
        store.dispatch(selectTabContainer('S2'));
      },
    });
    act(() =>
      startCarry(T1, { kind: 'tab', title: 't1', faviconUrl: '' }, -40, 0)
    );

    const own = document.querySelector('[data-own]');
    const decoy = document.querySelector('[data-decoy]');
    // PREMISE: the decoy is the document's first match, and drawn apart.
    expect(document.querySelector('[data-new-window-target="first"]')).toBe(
      decoy
    );

    const onOwn = carryReceiverAt(10, 116);
    expect(onOwn).not.toBeNull();
    // Over the decoy, nothing this receiver lights is drawn.
    expect(carryReceiverAt(10, 16)).toBeNull();

    act(() => onOwn?.hover(10, 116));
    expect(own?.hasAttribute('data-landing')).toBe(true);
    expect(decoy?.hasAttribute('data-landing')).toBe(false);
  });
});
