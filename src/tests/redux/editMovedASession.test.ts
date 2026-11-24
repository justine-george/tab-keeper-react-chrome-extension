import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { editMovedASession } from '../../redux/middleware/reorderGlideMiddleware';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-994. Only an edit that moved its session asks the list to glide; a
// drag, a sort, an arrival and a delete each draw their own motion.

const s = (id: string, contentModified?: number) =>
  buildSession({ tabGroupId: id, title: id, contentModified });

describe('editMovedASession', () => {
  const before = [s('a', 3), s('b', 2), s('c', 1)];

  test('an edit that moves its session up: yes', () => {
    expect(editMovedASession(before, [s('c', 9), s('a', 3), s('b', 2)])).toBe(
      true
    );
  });

  test('an undo that moves it back down: yes (its content stamp changes back)', () => {
    const edited = [s('c', 9), s('a', 3), s('b', 2)];
    expect(editMovedASession(edited, before)).toBe(true);
  });

  test('a drag or a sort (order changes, no content does): no', () => {
    expect(editMovedASession(before, [s('b', 2), s('a', 3), s('c', 1)])).toBe(
      false
    );
  });

  test('an edit that keeps its place (after an explicit sort): no', () => {
    expect(editMovedASession(before, [s('a', 9), s('b', 2), s('c', 1)])).toBe(
      false
    );
  });

  test('an arrival or a delete (the sessions differ): no', () => {
    expect(
      editMovedASession(before, [s('d', 9), s('a', 3), s('b', 2), s('c', 1)])
    ).toBe(false);
    expect(editMovedASession(before, [s('a', 3), s('b', 2)])).toBe(false);
    expect(editMovedASession(before, [s('d', 9), s('a', 3), s('b', 2)])).toBe(
      false
    );
    // One gone and one new, with an edited session moving too: still not an edit's reorder.
    expect(editMovedASession(before, [s('d', 9), s('a', 3), s('b', 5)])).toBe(
      false
    );
  });

  test('the same list: no', () => {
    expect(editMovedASession(before, before)).toBe(false);
  });
});
