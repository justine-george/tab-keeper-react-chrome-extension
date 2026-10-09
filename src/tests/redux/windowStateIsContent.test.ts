import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  replaceState,
  restoreContainer,
  type TabMasterContainer,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  T0,
  container,
  session,
  sessionIn,
  tab,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-460. A backup or undo whose only change is a window's state must outrank the live copy, or the next merge reverts it.
const withWindow = (w: windowGroupData): TabMasterContainer =>
  container([session('S', 'Saved', T0, [w])]);
const plain = (): windowGroupData => win('w', [tab('a'), tab('b')]);
const live = () => reducer(undefined, replaceState(withWindow(plain())));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 + 5_000);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoreContainer reads a window's state as content (KAN-460)", () => {
  it('a payload whose only change is a maximized window is stamped past the live copy', () => {
    const next = reducer(
      live(),
      restoreContainer(withWindow({ ...plain(), state: 'maximized' }))
    );
    expect(sessionIn(next, 'S').lastModified).toBe(T0 + 5_000);
  });
});
