import { describe, it, expect, afterEach } from 'vitest';

import {
  beginDragHold,
  endDragHold,
  flushHeldChanges,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';

afterEach(() => endDragHold());

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
});
