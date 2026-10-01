import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { CarryLayer } from '../../components/home/CarryLayer';
import {
  currentCarry,
  endCarry,
  registerCarryReceiver,
  setCarryOwner,
  startCarry,
  type CarryCard,
  type CarryReceiver,
} from '../../redux/carry';
import {
  addCurrTabToWindowInternal,
  saveToTabContainerInternal,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import {
  beginDragHold,
  endDragHold,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2, tab } from '../fixtures/sessionMoveFixture';

// KAN-350. The CarryLayer drives a carry while the pointer is outside every
// area that can take it: it draws the D1 card at the pointer, asks the
// receivers, and ends the carry on Esc, pointercancel, or a release no
// receiver took -- so nothing moves.

const TAB: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};

afterEach(() => {
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
});

async function renderLayer() {
  return renderWithProviders(<CarryLayer />, {
    seedStore: (store) => {
      store.dispatch(saveToTabContainerInternal(s1()));
      store.dispatch(saveToTabContainerInternal(s2()));
    },
  });
}

// As the engine leaves things at the hand-off: held, kind published, carried.
function handOff(card: CarryCard, carried: CarriedRef = TAB, x = 300, y = 40) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() => startCarry(carried, card, x, y));
}

const card = () => document.querySelector<HTMLElement>('[data-carry-card]');
// The card's words, without an icon's ligature.
const cardName = () =>
  document.querySelector('[data-carry-card-name]')?.textContent;

describe('the card follows the pointer (D1 A)', () => {
  test('no carry, no card', async () => {
    await renderLayer();
    expect(card()).toBeNull();
  });

  test('a tab: its favicon and title, fixed at the pointer, never hit', async () => {
    await renderLayer();
    handOff({
      kind: 'tab',
      title: 'Nishiki Market guide',
      faviconUrl: 'https://f.test/i.png',
    });

    const el = card();
    expect(cardName()).toBe('Nishiki Market guide');
    expect(el?.querySelector('img')?.getAttribute('src')).toBe(
      'https://f.test/i.png'
    );
    // Portalled to the body, so no pane can clip it.
    expect(el?.parentElement).toBe(document.body);
    const style = el === null ? null : getComputedStyle(el);
    expect(style?.position).toBe('fixed');
    expect(style?.pointerEvents).toBe('none');
    expect(style?.width).toBe('230px');
  });

  test('a group: its colour and "Title · N Tabs"', async () => {
    await renderLayer();
    handOff({
      kind: 'group',
      title: 'Research',
      color: '#3B82F6',
      tabCount: 2,
    });

    expect(cardName()).toBe('Research · 2 Tabs');
    const dot = card()?.querySelector<HTMLElement>('[data-carry-card-dot]');
    expect(
      dot === null || dot === undefined
        ? null
        : getComputedStyle(dot).backgroundColor
    ).toBe('rgb(59, 130, 246)');
  });

  test('an unnamed group, with one tab', async () => {
    await renderLayer();
    handOff({ kind: 'group', title: '', color: '#3B82F6', tabCount: 1 });
    expect(cardName()).toBe('Unnamed group · 1 Tab');
  });

  // Named as its header names it (WindowEntryContainer): by its stored title.
  test('a titled window: "Title · N Tabs", the title as it is', async () => {
    await renderLayer();
    handOff({ kind: 'window', title: 'Kyoto <trip> & more', tabCount: 3 });
    expect(cardName()).toBe('Kyoto <trip> & more · 3 Tabs');
  });

  // An empty title draws an empty header, so the card has no name to show:
  // the count alone, with no separator left dangling in front of it.
  test('an untitled window: the count alone', async () => {
    await renderLayer();
    handOff({ kind: 'window', title: '', tabCount: 1 });
    expect(cardName()).toBe('1 Tab');
  });

  test('it moves with the pointer', async () => {
    await renderLayer();
    handOff({ kind: 'tab', title: 'T', faviconUrl: '' }, TAB, 300, 40);
    const before = card()?.style.transform;

    fireEvent.pointerMove(window, { clientX: 350, clientY: 90 });

    expect(currentCarry()?.x).toBe(350);
    expect(currentCarry()?.y).toBe(90);
    expect(card()?.style.transform).not.toBe(before);
    // Just below and right of the pointer, as the mock draws it (8px, 4px).
    expect(card()?.style.transform).toBe('translate(358px, 94px)');
  });
});

const TAB_CARD: CarryCard = { kind: 'tab', title: 't1', faviconUrl: '' };

describe('Esc, a release over nothing and pointercancel end the carry, and nothing moves', () => {
  test.each([
    ['Esc', () => fireEvent.keyDown(window, { key: 'Escape' })],
    [
      'a release over nothing',
      () => fireEvent.pointerUp(window, { clientX: 300, clientY: 40 }),
    ],
    ['pointercancel', () => fireEvent.pointerCancel(window)],
  ])('%s', async (_how, end) => {
    const { store } = await renderLayer();
    handOff(TAB_CARD);
    const held = vi.fn();
    whenDragReleases(held);
    const before = store.getState().tabContainerDataState;

    act(end);

    expect(currentCarry()).toBeNull();
    expect(card()).toBeNull();
    // endDragHold ran: the held change applied, the kind unpublished.
    expect(isDragHeld()).toBe(false);
    expect(held).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
    // Nothing moved.
    expect(store.getState().tabContainerDataState).toBe(before);
  });
});

describe('receivers (Ruling 2)', () => {
  // Hit on x < 100, the way a session list to the left would be.
  const fake = (take: boolean) => {
    const calls: string[] = [];
    const r: CarryReceiver = {
      hit: (x) => x < 100,
      hover: (x, y) => calls.push(`hover ${x},${y}`),
      leave: () => calls.push('leave'),
      take: () => {
        calls.push('take');
        return take;
      },
    };
    return { r, calls };
  };

  test('the receiver hit hears hovers, and leave when the pointer goes', async () => {
    await renderLayer();
    const { r, calls } = fake(true);
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);

    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 20 });

    expect(calls).toEqual(['hover 50,10', 'hover 60,20', 'leave']);
    off();
  });

  test('the first receiver hit, in registration order, owns the pointer', async () => {
    await renderLayer();
    const first = fake(true);
    const second = fake(true);
    const offs = [first.r, second.r].map(registerCarryReceiver);
    handOff(TAB_CARD);

    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });

    expect(first.calls).toEqual(['hover 50,10']);
    expect(second.calls).toEqual([]);
    offs.forEach((off) => off());
  });

  test('a release it takes: take, then leave, and the carry ends', async () => {
    await renderLayer();
    const { r, calls } = fake(true);
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);

    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 50, clientY: 10 });
    });

    expect(calls).toEqual(['hover 50,10', 'hover 50,10', 'take', 'leave']);
    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    off();
  });

  test('a release it refuses is cancelled', async () => {
    const { store } = await renderLayer();
    const { r, calls } = fake(false);
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);
    const before = store.getState().tabContainerDataState;

    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 50, clientY: 10 });
    });

    expect(calls).toContain('take');
    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    off();
  });

  test('a release over no receiver asks none to take it', async () => {
    await renderLayer();
    const { r, calls } = fake(true);
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);

    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 300, clientY: 10 });
    });

    expect(calls).not.toContain('take');
    expect(currentCarry()).toBeNull();
    off();
  });

  test('a receiver that throws in take still ends the carry', async () => {
    await renderLayer();
    const r: CarryReceiver = {
      hit: () => true,
      hover: () => {},
      leave: () => {},
      take: () => {
        throw new Error('receiver failed');
      },
    };
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);
    // jsdom reports a listener's throw as a window `error` event.
    const reported: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      reported.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      act(() => {
        fireEvent.pointerUp(window, { clientX: 50, clientY: 10 });
      });
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(reported).toHaveLength(1);
    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    off();
  });

  test('once an area owns the carry, the layer asks no receiver', async () => {
    await renderLayer();
    const { r, calls } = fake(true);
    const off = registerCarryReceiver(r);
    handOff(TAB_CARD);
    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });

    // As an adopting area will (Task 5).
    act(() => setCarryOwner('area'));
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10 });

    expect(calls).toEqual(['hover 50,10', 'leave']);
    // The area's release is the area's: the carry is still on here.
    expect(currentCarry()?.owner).toBe('area');
    off();
  });
});

describe('the click Chrome synthesizes after the release', () => {
  const Clickable = ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      Row under the pointer
    </button>
  );

  async function renderWithRow() {
    const clicked = vi.fn();
    const result = await renderWithProviders(
      <>
        <CarryLayer />
        <Clickable onClick={clicked} />
      </>,
      // The carried tab has to exist, or the layer ends the carry at once.
      { seedStore: (store) => store.dispatch(saveToTabContainerInternal(s1())) }
    );
    return { ...result, clicked };
  }

  test('is swallowed once, and the next real click is not', async () => {
    const { clicked } = await renderWithRow();
    const row = screen.getByRole('button', { name: 'Row under the pointer' });
    handOff(TAB_CARD);

    act(() => {
      fireEvent.pointerUp(row, { clientX: 300, clientY: 40 });
    });
    fireEvent.click(row);
    expect(clicked).not.toHaveBeenCalled();

    // The user's own click starts with a press of its own.
    fireEvent.pointerDown(row, { button: 0 });
    fireEvent.pointerUp(row, { button: 0 });
    fireEvent.click(row);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  // KAN-177's case. Chrome dispatches no click for a release whose row moved
  // inside the pointerup, so a suppression judged by the clock alone ate the
  // user's next click instead -- very often Undo. The next press disarms it.
  test('a release with no click of its own does not eat the next press’s click', async () => {
    const { clicked } = await renderWithRow();
    const row = screen.getByRole('button', { name: 'Row under the pointer' });
    handOff(TAB_CARD);

    act(() => {
      fireEvent.pointerUp(window, { clientX: 300, clientY: 40 });
    });
    // No synthesized click. The user's own, well inside 400ms:
    fireEvent.pointerDown(row, { button: 0 });
    fireEvent.pointerUp(row, { button: 0 });
    fireEvent.click(row);

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test('after Esc, the click that follows the later release is swallowed too', async () => {
    const { clicked } = await renderWithRow();
    const row = screen.getByRole('button', { name: 'Row under the pointer' });
    handOff(TAB_CARD);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(currentCarry()).toBeNull();
    // The press is still down; its release comes MUCH later (KAN-335: 800ms
    // measured), then its click. A 400ms window started at the Esc would be
    // long over.
    const later = performance.now() + 800;
    vi.spyOn(performance, 'now').mockReturnValue(later);
    fireEvent.pointerUp(row, { clientX: 300, clientY: 40 });
    fireEvent.click(row);

    expect(clicked).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // The same rule as Esc: a carry ended by its item vanishing (⌘Z, here)
  // ends with the press still down, and that press's click comes later.
  test('after the carried item is removed, the click that follows the later release is swallowed', async () => {
    const { clicked, store } = await renderWithRow();
    const row = screen.getByRole('button', { name: 'Row under the pointer' });
    act(() => {
      store.dispatch(
        addCurrTabToWindowInternal({
          tabGroupId: 'S1',
          windowId: 'w2',
          tabData: tab('t9'),
        })
      );
    });
    handOff(
      { kind: 'tab', title: 't9', faviconUrl: '' },
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't9' }
    );

    act(() => {
      store.dispatch(undo());
    });
    expect(currentCarry()).toBeNull();
    const later = performance.now() + 800;
    vi.spyOn(performance, 'now').mockReturnValue(later);
    fireEvent.pointerUp(row, { clientX: 300, clientY: 40 });
    fireEvent.click(row);

    expect(clicked).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test('CONTROL: with no carry, a click reaches the row', async () => {
    const { clicked } = await renderWithRow();
    const row = screen.getByRole('button', { name: 'Row under the pointer' });
    fireEvent.pointerDown(row, { button: 0 });
    fireEvent.pointerUp(row, { button: 0 });
    fireEvent.click(row);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});

describe('a change on this page that removes the carried item ends the carry', () => {
  test('⌘Z takes back the tab being carried', async () => {
    const { store } = await renderLayer();
    act(() => {
      store.dispatch(
        addCurrTabToWindowInternal({
          tabGroupId: 'S1',
          windowId: 'w2',
          tabData: tab('t9'),
        })
      );
    });
    const carried: CarriedRef = {
      kind: 'tab',
      tabGroupId: 'S1',
      windowId: 'w2',
      tabId: 't9',
    };
    handOff({ kind: 'tab', title: 't9', faviconUrl: '' }, carried);
    const held = vi.fn();
    whenDragReleases(held);

    act(() => {
      store.dispatch(undo());
    });

    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(held).toHaveBeenCalledTimes(1);
  });

  test('CONTROL: a change that leaves it there keeps the carry', async () => {
    const { store } = await renderLayer();
    handOff(TAB_CARD);

    act(() => {
      store.dispatch(
        addCurrTabToWindowInternal({
          tabGroupId: 'S1',
          windowId: 'w2',
          tabData: tab('t9'),
        })
      );
    });

    expect(currentCarry()?.carried).toEqual(TAB);
  });
});
