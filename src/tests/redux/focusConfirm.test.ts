import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  requestFocusTabContainer,
  saveToTabContainer,
  addCurrWindowToTabGroup,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

const PARAMS = {
  tabGroupId: 'group-1',
  goToURLText: 'Go to URL',
  saveTitle: 'Auto-saved before switching',
};

describe('requestFocusTabContainer (KAN-42)', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  // The defect: `willSave` collapsed two different situations into one `false`.
  //
  //   const willSave = captured !== null && !isAlreadySaved(captured, groups);
  //
  // so `false` meant EITHER "already saved" OR "there was nothing to capture",
  // and both selected the FocusConfirmBodySaved* copy -- "Your open window is
  // already saved. It will be closed." In the second case nothing was saved and
  // nothing ever had been, so the dialog stated something untrue about the
  // user's data. The comment at the willSave site says the dialog must not
  // promise a save that will not happen; implying one already happened is the
  // same defect pointed the other way.
  it('does not open the confirmation when there is nothing to capture', async () => {
    // A normal window carrying no tabs: getAll (which does not populate) counts
    // it, so the "nothing is open" early return does not fire, while
    // captureOpenWindows drops every tab-less window and returns null.
    handle = setupChromeFake({ windows: [{ id: 1 }] });

    const { store, seen } = makeTestStore();
    await store.dispatch(requestFocusTabContainer(PARAMS));

    expect(seen).not.toContain('globalState/openFocusModal');
  });

  // The control for the test above: the same call DOES open the dialog when
  // there is genuinely something to save, so the assertion is not passing
  // because the modal never opens under this harness.
  it('opens the confirmation when there is something to capture', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://a.example/', title: 'A' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });

    const { store, seen } = makeTestStore();
    await store.dispatch(requestFocusTabContainer(PARAMS));

    expect(seen).toContain('globalState/openFocusModal');
  });
});

// KAN-24. Two thunks were registered with the same action type string. RTK has
// no registry and deduplicates nothing, so both ran correctly and no user was
// ever affected -- but DevTools showed two different operations under one name,
// and the first `builder.addCase(saveToTabContainer.fulfilled, ...)` anyone
// wrote would silently have matched "add current window" too.
describe('async thunk action types (KAN-24)', () => {
  it('gives each thunk its own action type', () => {
    expect(addCurrWindowToTabGroup.typePrefix).not.toBe(
      saveToTabContainer.typePrefix
    );
  });

  // Pinned rather than merely asserted distinct, so a future rename that
  // reintroduces a collision by renaming the wrong one still fails here.
  it('names them after what they do', () => {
    expect(saveToTabContainer.typePrefix).toBe('global/saveToTabContainer');
    expect(addCurrWindowToTabGroup.typePrefix).toBe(
      'global/addCurrWindowToTabGroup'
    );
  });
});
