import { afterEach, describe, expect, test } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import { CarryLayer } from '../../components/home/CarryLayer';
import {
  currentCarry,
  endCarry,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import {
  currentDragCard,
  hideDragCard,
  moveDragCard,
  showDragCard,
} from '../../redux/dragCard';
import { endDragHold } from '../../redux/dragHold';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1 } from '../fixtures/sessionMoveFixture';

// KAN-354. An ordinary drag inside a saved session shows the same card at the
// pointer that a carry does. The drag engine publishes it through dragCard.ts;
// CarryLayer draws it, and drives nothing for it.

const OWNER = Symbol('area');
const OTHER = Symbol('another area');
const TAB_CARD: CarryCard = {
  kind: 'tab',
  title: 'Nishiki Market guide',
  faviconUrl: 'https://f.test/i.png',
};

afterEach(() => {
  act(() => {
    hideDragCard(OWNER);
    endCarry('cancelled');
  });
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
});

const dragCard = () => document.querySelector<HTMLElement>('[data-drag-card]');
const carryCard = () =>
  document.querySelector<HTMLElement>('[data-carry-card]');

describe('the drag card', () => {
  test('nothing shown, no card; showing one draws it at the pointer, as a drag card', async () => {
    await renderWithProviders(<CarryLayer />);
    expect(dragCard()).toBeNull();

    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));

    expect(dragCard()?.textContent).toContain('Nishiki Market guide');
    expect(dragCard()?.style.transform).toBe('translate(108px, 54px)');
    expect(dragCard()?.getAttribute('aria-hidden')).toBe('true');
    // "A carry is on" stays false: existing specs rely on that meaning.
    expect(carryCard()).toBeNull();
    expect(currentCarry()).toBeNull();
  });

  test('moving follows the pointer; hiding removes it', async () => {
    await renderWithProviders(<CarryLayer />);
    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));
    act(() => moveDragCard(OWNER, 200, 90));
    expect(dragCard()?.style.transform).toBe('translate(208px, 94px)');

    act(() => hideDragCard(OWNER));
    expect(dragCard()).toBeNull();
  });

  test('another owner can neither move nor hide it', async () => {
    await renderWithProviders(<CarryLayer />);
    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));

    act(() => moveDragCard(OTHER, 300, 300));
    act(() => hideDragCard(OTHER));

    expect(dragCard()?.style.transform).toBe('translate(108px, 54px)');
    expect(currentDragCard()).toEqual({ card: TAB_CARD, x: 100, y: 50 });
  });

  test('moving to where it already is changes nothing', async () => {
    await renderWithProviders(<CarryLayer />);
    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));
    const before = currentDragCard();
    act(() => moveDragCard(OWNER, 100, 50));
    expect(currentDragCard()).toBe(before);
  });

  test('a hand-off to a carry keeps the same element', async () => {
    // Seeded, so the layer finds the carried tab still there.
    await renderWithProviders(<CarryLayer />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(s1()));
      },
    });
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) removed.push(...Array.from(r.removedNodes));
    });
    observer.observe(document.body, { subtree: true, childList: true });

    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));
    const el = dragCard();
    expect(el).not.toBeNull();

    // The order the engine's hand-off uses: the carry starts, then the drag
    // card is hidden.
    act(() => {
      startCarry(
        { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        TAB_CARD,
        120,
        60
      );
      hideDragCard(OWNER);
    });

    expect(carryCard()).toBe(el);
    expect(el?.hasAttribute('data-drag-card')).toBe(false);
    expect(dragCard()).toBeNull();
    expect(el?.style.transform).toBe('translate(128px, 64px)');
    observer.disconnect();
    expect(removed).not.toContain(el);
  });

  test('CONTROL: a release or Esc does nothing to a drag card; only its owner hides it', async () => {
    await renderWithProviders(<CarryLayer />);
    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerCancel(window);
    fireEvent.keyDown(window, { key: 'Escape' });

    // The layer's listeners belong to a carry alone: nothing moved the card,
    // and nothing hid it.
    expect(dragCard()?.style.transform).toBe('translate(108px, 54px)');

    act(() => hideDragCard(OWNER));
    expect(dragCard()).toBeNull();
  });
});
