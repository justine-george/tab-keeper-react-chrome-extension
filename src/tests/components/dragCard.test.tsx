import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import { CarryLayer } from '../../components/home/CarryLayer';
import {
  currentCarry,
  endCarry,
  registerCarryReceiver,
  type CarryCard,
} from '../../redux/carry';
import {
  currentDragCard,
  hideDragCard,
  moveDragCard,
  showDragCard,
} from '../../redux/dragCard';
import { beginDragHold, endDragHold, isDragHeld } from '../../redux/dragHold';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { renderWithProviders } from '../setup/renderWithProviders';

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

  test('CONTROL: a release, Esc or cancel drives nothing for a drag card; only its owner hides it', async () => {
    await renderWithProviders(<CarryLayer />);
    // The hold and kind a layer driving this drag would release.
    setDragging(true, 'tab');
    beginDragHold();
    const receiver = {
      hit: vi.fn(() => true),
      hover: vi.fn(),
      leave: vi.fn(),
      take: vi.fn(() => true),
    };
    const unregister = registerCarryReceiver(receiver);
    act(() => showDragCard(OWNER, TAB_CARD, 100, 50));

    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerCancel(window);
    fireEvent.keyDown(window, { key: 'Escape' });
    unregister();

    expect(receiver.hit).not.toHaveBeenCalled();
    expect(receiver.hover).not.toHaveBeenCalled();
    expect(receiver.take).not.toHaveBeenCalled();
    // Nothing released the hold or unpublished the kind (endCarry is a no-op with no carry).
    expect(isDragHeld()).toBe(true);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(true);
    // Nothing moved the card, and nothing hid it.
    expect(dragCard()?.style.transform).toBe('translate(108px, 54px)');

    act(() => hideDragCard(OWNER));
    expect(dragCard()).toBeNull();
  });
});
