import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  beginDragHold,
  endDragHold,
  flushHeldChanges,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';

afterEach(() => {
  endDragHold();
  vi.restoreAllMocks();
});

describe('dragHold', () => {
  it('applies at once when no drag is held', () => {
    const ran: string[] = [];
    whenDragReleases(() => ran.push('x'));
    expect(ran).toEqual(['x']);
  });
  it('holds while a drag is held, then runs in arrival order at the end', () => {
    const ran: string[] = [];
    beginDragHold();
    whenDragReleases(() => ran.push('cloud'));
    whenDragReleases(() => ran.push('page'));
    expect(ran).toEqual([]);
    endDragHold();
    expect(ran).toEqual(['cloud', 'page']);
    expect(isDragHeld()).toBe(false);
  });
  it('flushHeldChanges runs the queue once, keeps the flag, and reports whether anything ran', () => {
    const ran: string[] = [];
    beginDragHold();
    expect(flushHeldChanges()).toBe(false);
    whenDragReleases(() => ran.push('x'));
    expect(flushHeldChanges()).toBe(true);
    expect(isDragHeld()).toBe(true);
    endDragHold();
    expect(ran).toEqual(['x']);
  });

  // KAN-279 D9 adds a second kind of queued apply (another page's write). A
  // throw in one must not silently drop the ones queued after it. Reported
  // with console.error rather than rethrown, so dropOnTop still applies the
  // move on top of whatever did apply.
  const throwingQueue = (ran: string[]) => {
    whenDragReleases(() => ran.push('first'));
    whenDragReleases(() => {
      ran.push('second');
      throw new Error('boom');
    });
    whenDragReleases(() => ran.push('third'));
  };

  it('a throwing held apply does not drop the rest, at endDragHold', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const ran: string[] = [];
    beginDragHold();
    throwingQueue(ran);

    endDragHold();

    expect(ran).toEqual(['first', 'second', 'third']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(isDragHeld()).toBe(false);
  });

  it('a throwing held apply does not drop the rest, at a drop (flag kept)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ran: string[] = [];
    beginDragHold();
    throwingQueue(ran);

    expect(flushHeldChanges()).toBe(true);

    expect(ran).toEqual(['first', 'second', 'third']);
    expect(isDragHeld()).toBe(true);
    // The queue is empty afterwards: nothing runs twice.
    expect(flushHeldChanges()).toBe(false);
    expect(ran).toEqual(['first', 'second', 'third']);
  });
});
