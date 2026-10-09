import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  carryReceiverAt,
  currentCarry,
  endCarry,
  moveCarry,
  registerCarryReceiver,
  setCarryOwner,
  startCarry,
  subscribeCarry,
  type CarryCard,
  type CarryReceiver,
} from '../../redux/carry';
import type { CarriedRef } from '../../redux/slices/tabContainerDataStateSlice';
import {
  beginDragHold,
  endDragHold,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';
import {
  setDragging,
  setDragNewWindow,
} from '../../components/home/rightpane/rowDrag/dropRules';
import { foldBackSpringOpened } from '../../redux/springOpenWindows';

// Real unless a test makes it throw.
vi.mock('../../redux/springOpenWindows', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../redux/springOpenWindows')>();
  return { ...real, foldBackSpringOpened: vi.fn(real.foldBackSpringOpened) };
});

// KAN-350. The carry channel: module state that outlives every drag area. A
// .tsx file only so it runs under jsdom -- endCarry unpublishes the drag kind
// on the document element.

const CARRIED: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const CARD: CarryCard = { kind: 'tab', title: 't1', faviconUrl: '' };

afterEach(() => {
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-drag-new-window');
  document.documentElement.removeAttribute('data-carrying');
  document.documentElement.removeAttribute('data-drag-new-session');
});

describe('the carry channel', () => {
  test('startCarry carries, driven by the layer, and tells subscribers', () => {
    const heard = vi.fn();
    const unsubscribe = subscribeCarry(heard);

    startCarry(CARRIED, CARD, 40, 50);

    expect(currentCarry()).toEqual({
      carried: CARRIED,
      card: CARD,
      x: 40,
      y: 50,
      owner: 'layer',
    });
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('moveCarry moves the pointer and keeps what is carried, identity and all', () => {
    startCarry(CARRIED, CARD, 40, 50);
    const heard = vi.fn();
    const unsubscribe = subscribeCarry(heard);

    moveCarry(60, 70);

    expect(currentCarry()?.x).toBe(60);
    expect(currentCarry()?.y).toBe(70);
    expect(currentCarry()?.carried).toBe(CARRIED);
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('with nothing carried, moveCarry and setCarryOwner start nothing', () => {
    const heard = vi.fn();
    const unsubscribe = subscribeCarry(heard);

    moveCarry(60, 70);
    setCarryOwner('area');

    expect(currentCarry()).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('setCarryOwner hands the carry to an area and back', () => {
    startCarry(CARRIED, CARD, 40, 50);

    setCarryOwner('area');
    expect(currentCarry()?.owner).toBe('area');
    setCarryOwner('layer');
    expect(currentCarry()?.owner).toBe('layer');
  });

  test('endCarry unpublishes the drag kind, applies the held change, then tells subscribers', () => {
    // As the engine leaves it at the hand-off: held, kind published.
    setDragging(true, 'tab');
    beginDragHold();
    startCarry(CARRIED, CARD, 40, 50);
    const order: string[] = [];
    whenDragReleases(() => order.push('held change'));
    const unsubscribe = subscribeCarry(() =>
      order.push(
        `told: carry ${currentCarry() === null ? 'off' : 'on'}, kind ${
          document.documentElement.getAttribute('data-dragging') ?? 'none'
        }`
      )
    );
    // The premise: nothing has run yet.
    expect(order).toEqual([]);

    endCarry('cancelled');

    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
    expect(order).toEqual(['held change', 'told: carry off, kind none']);
    unsubscribe();
  });

  // The worst path: endCarry is called by several parties (a release, Esc, a
  // removed item), and the hold and kind are document-wide. With nothing
  // carried it must not end a drag an area is running.
  test('endCarry with nothing carried leaves an area’s drag alone', () => {
    setDragging(true, 'window');
    beginDragHold();
    const held = vi.fn();
    whenDragReleases(held);
    const heard = vi.fn();
    const unsubscribe = subscribeCarry(heard);

    endCarry('cancelled');

    expect(isDragHeld()).toBe(true);
    expect(held).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute('data-dragging')).toBe(
      'window'
    );
    expect(heard).not.toHaveBeenCalled();
    unsubscribe();
  });
});

// KAN-361 (N1 B). The carry's own New window marker: on for a carried tab or
// group from the carry's start to its end, never for a window, whatever the
// drag that started the carry had published.
describe('the New window marker', () => {
  const marked = () =>
    document.documentElement.hasAttribute('data-drag-new-window');
  const GROUP: CarriedRef = {
    kind: 'group',
    tabGroupId: 'S1',
    windowId: 'w1',
    groupId: 'g1',
  };
  const GROUP_CARD: CarryCard = {
    kind: 'group',
    title: 'g1',
    color: 'blue',
    tabCount: 2,
  };
  const WINDOW: CarriedRef = {
    kind: 'window',
    tabGroupId: 'S1',
    windowId: 'w1',
  };
  const WINDOW_CARD: CarryCard = {
    kind: 'window',
    title: 'w1',
    number: 1,
    tabCount: 2,
  };

  test.each([
    ['tab', CARRIED, CARD],
    ['group', GROUP, GROUP_CARD],
  ] as const)(
    'a carried %s publishes it from the start, and its end clears it',
    (_kind, carried, card) => {
      // PREMISE: nothing had published it.
      expect(marked()).toBe(false);

      startCarry(carried, card, 40, 50);
      expect(marked()).toBe(true);
      setCarryOwner('area');
      setCarryOwner('layer');
      expect(marked()).toBe(true);

      endCarry('committed');
      expect(marked()).toBe(false);
    }
  );

  test('a carried window never publishes it', () => {
    startCarry(WINDOW, WINDOW_CARD, 40, 50);
    expect(marked()).toBe(false);
  });

  // The worst path: a window carry replacing a tab carry still on, the
  // marker that carry published with it.
  test('a window carry replacing a tab carry clears it', () => {
    startCarry(CARRIED, CARD, 40, 50);
    // PREMISE: the tab carry published it.
    expect(marked()).toBe(true);

    startCarry(WINDOW, WINDOW_CARD, 40, 50);
    expect(marked()).toBe(false);
  });

  // KAN-366 Q4: a carry started from a drag with room, and a drag adopting it, keep the room, or the list loses a row under the pointer at the hand-off.
  test('a carry started from a drag with room keeps the room; its end clears it', () => {
    const value = () =>
      document.documentElement.getAttribute('data-drag-new-window');
    setDragNewWindow(true, true);
    // PREMISE: the drag published it with room.
    expect(value()).toBe('room');

    startCarry(CARRIED, CARD, 40, 50);
    expect(value()).toBe('room');
    // An adoption writes it again, asking for no room.
    setDragNewWindow(true);
    expect(value()).toBe('room');

    endCarry('cancelled');
    expect(value()).toBeNull();
    // CONTROL: from a list that fits, a carry has none.
    startCarry(CARRIED, CARD, 40, 50);
    expect(value()).toBe('');
  });

  // As for the kind: with nothing carried, an area's drag keeps its marker.
  test('endCarry with nothing carried leaves an area’s marker alone', () => {
    setDragNewWindow(true);

    endCarry('cancelled');

    expect(marked()).toBe(true);
  });
});

// KAN-394 (D18). A carry of any kind marks the document, so the save row's
// New session target is drawn in the frame the carry starts.
describe('the carrying marker', () => {
  const carrying = () => document.documentElement.hasAttribute('data-carrying');
  const offersNewSession = () =>
    document.documentElement.hasAttribute('data-drag-new-session');
  const WINDOW: CarriedRef = {
    kind: 'window',
    tabGroupId: 'S1',
    windowId: 'w1',
  };

  test.each([
    ['tab', CARRIED, CARD],
    ['window', WINDOW, { kind: 'window', title: 'w1', number: 1, tabCount: 2 }],
  ] as const)(
    'a carried %s marks it from the start, through a hand-back, until its end',
    (_kind, carried, card) => {
      // PREMISE: nothing had marked it.
      expect(carrying()).toBe(false);

      startCarry(carried, card, 40, 50);
      expect(carrying()).toBe(true);
      expect(offersNewSession()).toBe(true);
      setCarryOwner('area');
      setCarryOwner('layer');
      expect(carrying()).toBe(true);
      expect(offersNewSession()).toBe(true);

      endCarry('committed');
      expect(carrying()).toBe(false);
      expect(offersNewSession()).toBe(false);
    }
  );

  // The worst path: something endCarry runs throws. The save row must not
  // stay hidden for the page's life.
  test('an end that throws still clears it', () => {
    startCarry(CARRIED, CARD, 40, 50);
    vi.mocked(foldBackSpringOpened).mockImplementationOnce(() => {
      throw new Error('fold back failed');
    });

    expect(() => endCarry('cancelled')).toThrow('fold back failed');

    expect(currentCarry()).toBeNull();
    expect(carrying()).toBe(false);
    expect(offersNewSession()).toBe(false);
  });
});

describe('carry receivers (Ruling 2)', () => {
  const receiver = (hits: boolean): CarryReceiver => ({
    hit: () => hits,
    hover: () => {},
    leave: () => {},
    take: () => false,
  });

  test('the first receiver hit, in registration order, owns the point', () => {
    const missed = receiver(false);
    const first = receiver(true);
    const second = receiver(true);
    const offs = [missed, first, second].map(registerCarryReceiver);

    expect(carryReceiverAt(0, 0)).toBe(first);

    offs.forEach((off) => off());
  });

  test('none hit is none', () => {
    const off = registerCarryReceiver(receiver(false));
    expect(carryReceiverAt(0, 0)).toBeNull();
    off();
  });

  test('an unregistered receiver is never asked again', () => {
    const r = receiver(true);
    const off = registerCarryReceiver(r);
    off();
    expect(carryReceiverAt(0, 0)).toBeNull();
  });
});
