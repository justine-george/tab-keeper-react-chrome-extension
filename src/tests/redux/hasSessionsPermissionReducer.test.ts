import { describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load. Keep
// in step with src/tests/setup/domStub.ts (see tabContainerReducers.test.ts,
// which needs the same stub for the same reason).
//
// Reflect.get/set rather than a cast to `{ window?: unknown }`: globalThis has
// no `window` property in this (non-DOM) vitest project, so setting one
// through a plain assignment would need a cast to widen its type first.
// Reflect's generic signatures accept any target/key/value without that
// widening, and the `typeof ... === 'object'` check below narrows the existing
// value instead of asserting it.
vi.hoisted(() => {
  const existingWindow: unknown = Reflect.get(globalThis, 'window');
  const windowTarget: object =
    typeof existingWindow === 'object' && existingWindow !== null
      ? existingWindow
      : globalThis;
  Reflect.set(globalThis, 'window', windowTarget);
  Reflect.set(windowTarget, 'screen', { height: 1080, width: 1920 });
});

// Not optional, and not about this test's subject. Importing globalStateSlice
// reaches utils/functions/external -> config/firebase, which calls getAuth()
// at module load and throws `auth/invalid-api-key` when no Firebase config is
// present. A developer machine has a .env and never sees it; CI has none, so
// without this the suite passes locally and fails only on the runner. Every
// other slice-importing test stubs the same module for the same reason
// (see tabContainerReducers.test.ts).
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  initialState,
  setHasSessionsPermission,
} from '../../redux/slices/globalStateSlice';

// setHasTabGroupsPermission has no dedicated reducer test of its own -- every
// existing use is a seedStore call in a component test -- so this is a fresh,
// minimal test rather than a mirrored one, covering the sessions flag the same
// way a tabGroups one would.
describe('setHasSessionsPermission', () => {
  test('defaults to false', () => {
    expect(initialState.hasSessionsPermission).toBe(false);
  });

  test('sets the flag to true', () => {
    const next = reducer(initialState, setHasSessionsPermission(true));
    expect(next.hasSessionsPermission).toBe(true);
  });

  test('sets the flag back to false', () => {
    const granted = reducer(initialState, setHasSessionsPermission(true));
    const revoked = reducer(granted, setHasSessionsPermission(false));
    expect(revoked.hasSessionsPermission).toBe(false);
  });
});
