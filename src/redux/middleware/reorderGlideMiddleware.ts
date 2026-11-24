import type { Middleware, StateFromReducersMapObject } from '@reduxjs/toolkit';

import { rootReducer } from '../storeConfig';
import {
  hydrateFromOtherPage,
  replaceState,
  type tabContainerData,
} from '../slices/tabContainerDataStateSlice';
import { isApplyingHeldChanges, isDragHeld } from '../dragHold';
import { redo, undo } from '../slices/undoRedoSlice';
import { panes, prepareLayoutGlide } from '../../components/common/layoutGlide';

type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-994 (his picks, round 2: 1-B, 2-B). An edit moves its session up the
// list (KAN-141, ordered by last edit); an undo moves it back. Measured here,
// before React draws the new order, so the rows glide to their places instead
// of jumping. The list's follow (KAN-143) scrolls before the glide measures
// the landed rows, so a list scrolled down scrolls up with the row. Prepared
// alongside any glide the edit drew in the other pane.

/**
 * Whether `after` is `before` reordered because a session's content changed:
 * the same sessions, in a new order, and one that moved was edited. A drag, a
 * sort, an arrival or a delete is not one: each draws its own motion.
 */
export function editMovedASession(
  before: readonly tabContainerData[],
  after: readonly tabContainerData[]
): boolean {
  if (before === after || before.length !== after.length) return false;
  const was = new Map(before.map((g, i) => [g.tabGroupId, { g, i }]));
  let reordered = false;
  let editedAndMoved = false;
  for (const [i, g] of after.entries()) {
    const old = was.get(g.tabGroupId);
    if (old === undefined) return false;
    if (old.i === i) continue;
    reordered = true;
    if (old.g.contentModified !== g.contentModified) editedAndMoved = true;
  }
  return reordered && editedAndMoved;
}

export const reorderGlideMiddleware: Middleware<object, State> =
  (api) => (next) => (action) => {
    const before = api.getState().tabContainerDataState.tabGroups;
    const result = next(action);
    const after = api.getState().tabContainerDataState.tabGroups;
    if (!editMovedASession(before, after)) return result;
    // A sync or another page's write, as an arrival from elsewhere is
    // (KAN-991): never while a row is held or as a change that waited for its
    // release lands, and not made instant by a key last pressed here. A drop
    // here is committed while its own row is still held, so the hold stops
    // only changes from elsewhere.
    const fromElsewhere =
      hydrateFromOtherPage.match(action) || replaceState.match(action);
    if (!fromElsewhere || (!isDragHeld() && !isApplyingHeldChanges())) {
      prepareLayoutGlide(
        panes('sessions'),
        'reorder',
        fromElsewhere
          ? 'elsewhere'
          : undo.match(action) || redo.match(action)
            ? 'undo or redo'
            : 'this page',
        { alongside: true }
      );
    }
    return result;
  };
