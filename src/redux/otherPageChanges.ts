import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { isDragHeld, whenDragReleases } from './dragHold';
import {
  hydrateFromOtherPage,
  type TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import {
  hydrateSettingsFromOtherPage,
  type Language,
  type SettingsData,
} from './slices/settingsDataStateSlice';
import { resetHistory } from './slices/undoRedoSlice';
import {
  asPartialSettings,
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../utils/functions/local';
import {
  sameContainerData,
  sameIgnoringKeyOrder,
} from '../utils/functions/sameContainerData';

// KAN-279 D9. Another page (the popup, or the pop-out tab) wrote a slice to
// the shared localStorage. This page takes it in only when the DATA changed,
// keeps its own view state, and never writes back: a write here would fire a
// storage event in the other page, and the two would echo forever.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// Selection is per-page view state. This page's stays if its session survived
// the other page's write; otherwise null, the fallback deleting the selected
// session uses (deleteTabContainerInternal). Never the other page's.
const withOwnSelection = (
  incoming: TabMasterContainer,
  ownSelectedId: string | null
): TabMasterContainer => {
  const selectedTabGroupId = incoming.tabGroups.some(
    (g) => g.tabGroupId === ownSelectedId
  )
    ? ownSelectedId
    : null;
  return {
    ...incoming,
    selectedTabGroupId,
    tabGroups: incoming.tabGroups.map((g) => ({
      ...g,
      isSelected: g.tabGroupId === selectedTabGroupId,
    })),
  };
};

// No hold check: this is what the drag-hold queue runs, and dropOnTop flushes
// that queue with the hold still on. Reads localStorage when it RUNS, so a
// held apply takes the latest write, not the one that queued it.
const hydrateSessionsFromStorage = (): Thunk<void> => (dispatch, getState) => {
  const incoming = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(incoming)) {
    console.warn(
      'Ignoring unreadable tabContainerData written by another page.'
    );
    return;
  }
  const current = getState().tabContainerDataState;
  if (sameContainerData(incoming, current)) return;

  const next = withOwnSelection(incoming, current.selectedTabGroupId);
  dispatch(hydrateFromOtherPage(next));
  // D12: a change this page did not make leaves nothing an undo may reverse.
  dispatch(resetHistory({ tabContainerDataState: next }));
};

// While a row is held the change waits for the release (D12): applying it
// would move the list under the pointer. The queued closure calls the inner
// thunk, never this one -- this one would see the hold still on during the
// drop's flush and queue itself again, and the drop would land in the old list.
export const applyOtherPageSessions = (): Thunk<void> => (dispatch) => {
  if (isDragHeld()) {
    whenDragReleases(() => dispatch(hydrateSessionsFromStorage()));
    return;
  }
  dispatch(hydrateSessionsFromStorage());
};

export interface OtherPageSettingsResult {
  // The language the other page switched to, for the caller to hand to
  // i18n.changeLanguage; null when the language did not change.
  languageChanged: Language | null;
}

// Settings are laid over this page's, field by field, and taken in when that
// changes anything. asPartialSettings checks only the object shape, as every
// settings reader does; a non-object reads as {} and so as no change.
export const applyOtherPageSettings =
  (): Thunk<OtherPageSettingsResult> => (dispatch, getState) => {
    const current = getState().settingsDataState;
    const next: SettingsData = {
      ...current,
      ...asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData')),
    };
    if (sameIgnoringKeyOrder(next, current)) return { languageChanged: null };

    dispatch(hydrateSettingsFromOtherPage(next));
    return {
      languageChanged:
        next.language !== current.language ? next.language : null,
    };
  };
