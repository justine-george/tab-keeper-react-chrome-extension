import type { Store } from '@reduxjs/toolkit';

import type { RootState } from '../../../redux/store';

// The wait the latest save is on, per store: a later save waits on it too, so saves go on in order.
const latest = new WeakMap<Store<RootState>, Promise<void>>();

// The pop starts as the save renders, so this looks after the render has run (a task later);
// no pop by then means none is coming.
function whenPopEnds(store: Store<RootState>): Promise<void> {
  const isPopping = () => store.getState().globalState.isFirstSavePopping;
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!isPopping()) {
        resolve();
        return;
      }
      const unsubscribe = store.subscribe(() => {
        if (isPopping()) return;
        unsubscribe();
        resolve();
      });
    }, 0);
  });
}

// KAN-875. Called after a save: resolves once the pop that save started, or one already
// playing, has ended, and never before an earlier save's wait.
export function afterFirstSavePop(
  store: Store<RootState>,
  popsBefore: number
): Promise<void> {
  const g = store.getState().globalState;
  if (g.firstSavePops !== popsBefore || g.isFirstSavePopping) {
    latest.set(store, whenPopEnds(store));
  }
  return latest.get(store) ?? Promise.resolve();
}
