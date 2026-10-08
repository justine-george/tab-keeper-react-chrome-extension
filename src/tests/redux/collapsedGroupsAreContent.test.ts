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
  group,
  session,
  sessionIn,
  tab,
  win,
} from '../fixtures/sessionMoveFixture';

// KAN-460. A backup or undo whose only change is a group's collapsed state must outrank the live copy, or the next merge reverts it.
const withWindow = (w: windowGroupData): TabMasterContainer =>
  container([session('S', 'Saved', T0, [w])]);
const plain = (): windowGroupData =>
  win('w', [tab('a', 'g'), tab('b')], [group('g')]);
const live = () => reducer(undefined, replaceState(withWindow(plain())));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 + 5_000);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoreContainer reads a group's collapsed state as content (KAN-460)", () => {
  it('a payload whose only change is a collapsed group is stamped past the live copy', () => {
    const next = reducer(
      live(),
      restoreContainer(
        withWindow({
          ...plain(),
          chromeTabGroups: [{ ...group('g'), collapsed: true }],
        })
      )
    );
    expect(sessionIn(next, 'S').lastModified).toBe(T0 + 5_000);
  });

  it('CONTROL: an identical payload keeps its timestamp', () => {
    const next = reducer(live(), restoreContainer(withWindow(plain())));
    expect(sessionIn(next, 'S').lastModified).toBe(T0);
  });
});
