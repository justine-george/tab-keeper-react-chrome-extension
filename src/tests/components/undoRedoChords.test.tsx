import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-54. Two defects in the same handler, and which one bites depends on the
// key value the keyboard actually sends.
//
// 1. CASE. Every branch compared `event.key` against a lowercase literal, but
//    `key` carries the SHIFTED character -- a real Cmd+Shift+Z arrives as 'Z'
//    and matched nothing at all, so macOS keyboard redo did nothing.
// 2. EXCLUSIVITY. The four branches were independent `if`s and the undo ones
//    never excluded Shift, so a chord arriving as lowercase 'z' WITH shift
//    (CapsLock inverts Shift for letters) satisfied both the undo and the redo
//    branch and dispatched undo THEN redo -- exact inverses, netting nothing.
//
// The assertion is the EXACT action sequence, not `toContain`. "Contains redo"
// passes against the cancelling double-dispatch, and a state check cannot tell
// "redo worked" from "undo and redo cancelled" -- they end in the same place.

const UNDO = 'undoRedo/undo';
const REDO = 'undoRedo/redo';

type Chord = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};

// Fired on document.body rather than typed: the listener is on `window`, and
// a body target keeps it clear of the KAN-52 text-field guard.
async function chord(c: Chord) {
  const { seen } = await renderWithProviders(<MainContainer />);
  const before = seen.length;
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...c,
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return {
    actions: seen.slice(before).filter((a) => a.startsWith('undoRedo/')),
    prevented: event.defaultPrevented,
  };
}

describe('undo/redo keyboard chords dispatch exactly one action (KAN-54)', () => {
  describe('undo', () => {
    test('cmd+z', async () => {
      const r = await chord({ key: 'z', metaKey: true });
      expect(r.actions).toEqual([UNDO]);
      expect(r.prevented).toBe(true);
    });

    test('ctrl+z', async () => {
      const r = await chord({ key: 'z', ctrlKey: true });
      expect(r.actions).toEqual([UNDO]);
      expect(r.prevented).toBe(true);
    });
  });

  describe('redo as a real keyboard sends it', () => {
    // RED (case). A physical Shift+Z produces key 'Z'. The old handler
    // compared against 'z' and matched nothing, so this dispatched no action
    // and did not even preventDefault -- macOS redo was simply inert.
    test('cmd+shift+Z', async () => {
      const r = await chord({ key: 'Z', metaKey: true, shiftKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });

    test('ctrl+shift+Z', async () => {
      const r = await chord({ key: 'Z', ctrlKey: true, shiftKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });

    test('ctrl+y', async () => {
      const r = await chord({ key: 'y', ctrlKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });

    test('cmd+y', async () => {
      const r = await chord({ key: 'y', metaKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });
  });

  describe('redo when CapsLock inverts Shift and the key arrives lowercase', () => {
    // RED (exclusivity). Here the old handler matched BOTH the undo branch
    // (metaKey && key === 'z', no Shift exclusion) and the redo branch, so it
    // dispatched [UNDO, REDO] -- which cancel exactly, and stamp lastModified
    // twice on the way.
    test('cmd+shift+z', async () => {
      const r = await chord({ key: 'z', metaKey: true, shiftKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });

    test('ctrl+shift+z', async () => {
      const r = await chord({ key: 'z', ctrlKey: true, shiftKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });

    test('cmd+Y', async () => {
      const r = await chord({ key: 'Y', metaKey: true });
      expect(r.actions).toEqual([REDO]);
      expect(r.prevented).toBe(true);
    });
  });

  // CONTROLS. The handler has to stay narrow: a fix that dispatches undo for
  // anything, or claims every keystroke, passes every test above.
  describe('chords the app must ignore', () => {
    test('z with no modifier is ordinary typing', async () => {
      const r = await chord({ key: 'z' });
      expect(r.actions).toEqual([]);
      expect(r.prevented).toBe(false);
    });

    test('shift+Z with no modifier is ordinary typing', async () => {
      const r = await chord({ key: 'Z', shiftKey: true });
      expect(r.actions).toEqual([]);
      expect(r.prevented).toBe(false);
    });

    test('cmd+a is select-all and belongs to the browser', async () => {
      const r = await chord({ key: 'a', metaKey: true });
      expect(r.actions).toEqual([]);
      expect(r.prevented).toBe(false);
    });

    test('cmd+shift+a is not a redo chord', async () => {
      const r = await chord({ key: 'A', metaKey: true, shiftKey: true });
      expect(r.actions).toEqual([]);
      expect(r.prevented).toBe(false);
    });
  });
});
