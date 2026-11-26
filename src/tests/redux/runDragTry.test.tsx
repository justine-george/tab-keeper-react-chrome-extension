import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { installFakeLocks, type FakeLocks } from '../setup/fakeLocks';
import { setupChromeFake } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  noteRunDrag,
  selectIsDragStepHere,
  startRun,
} from '../../redux/firstRun';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { runStoppedHere } from '../../redux/slices/globalStateSlice';
import { asRunStep, newRun } from '../../utils/functions/firstRun';

// Round 2 (KAN-1023). The drag step is something to try: each way a drop
// lands while it shows ticks in the card.

const OWN = buildSession({ tabGroupId: 'own', title: 'Own', createdAt: 2000 });
const OTHER = buildSession({ tabGroupId: 'other', title: 'Other' });

let locks: FakeLocks;
beforeEach(() => {
  localStorage.clear();
  locks = installFakeLocks();
  setupChromeFake({ windows: [] });
  history.replaceState(null, '', '?view=tab');
});
afterEach(() => {
  locks.uninstall();
  localStorage.clear();
  history.replaceState(null, '', '?');
  vi.restoreAllMocks();
});

async function runAt(step: number) {
  const { store } = makeTestStore();
  store.dispatch(replaceState(buildContainer([OWN, OTHER])));
  const at = asRunStep('full', step);
  if (at === null) throw new Error(`no full-view step ${step}`);
  await store.dispatch(startRun({ ...newRun('full', at), sessionId: 'own' }));
  return store;
}
const tried = (store: Awaited<ReturnType<typeof runAt>>) =>
  store.getState().globalState.runDragsTried;

describe('the drag step’s ticks', () => {
  test('start unticked; a drop each way ticks its own', async () => {
    const store = await runAt(9);
    expect(selectIsDragStepHere(store.getState())).toBe(true);
    expect(tried(store)).toEqual({ opened: false, saved: false });
    store.dispatch(noteRunDrag({ way: 'opened' }));
    expect(tried(store)).toEqual({ opened: true, saved: false });
    store.dispatch(noteRunDrag({ way: 'saved', intoSessionId: 'own' }));
    expect(tried(store)).toEqual({ opened: true, saved: true });
  });

  test('a copy saved into another session is not this session’s', async () => {
    const store = await runAt(9);
    store.dispatch(noteRunDrag({ way: 'saved', intoSessionId: 'other' }));
    expect(tried(store)).toEqual({ opened: false, saved: false });
  });

  test('CONTROL: on another step nothing ticks', async () => {
    const store = await runAt(8);
    expect(selectIsDragStepHere(store.getState())).toBe(false);
    store.dispatch(noteRunDrag({ way: 'opened' }));
    store.dispatch(noteRunDrag({ way: 'saved', intoSessionId: 'own' }));
    expect(tried(store)).toEqual({ opened: false, saved: false });
  });

  test('the run stopping here clears them', async () => {
    const store = await runAt(9);
    store.dispatch(noteRunDrag({ way: 'opened' }));
    store.dispatch(runStoppedHere());
    expect(tried(store)).toEqual({ opened: false, saved: false });
  });
});
