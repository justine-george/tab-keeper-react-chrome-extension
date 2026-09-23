import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { isDragHeld, whenDragReleases } from './dragHold';
import { hydrateFromOtherPage } from './slices/tabContainerDataStateSlice';
import {
  asShippedLanguage,
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
import { withOwnSelection } from '../utils/functions/withOwnSelection';

// KAN-279 D9. Another page (the popup, or the pop-out tab) wrote a slice to
// the shared localStorage. This page takes it in only when the DATA changed,
// keeps its own view state, and never writes back: a write here would fire a
// storage event in the other page, and the two would echo forever.

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

// No hold check: this is what the drag-hold queue runs, and what dropOnTop
// re-reads with, both with the hold still on. Reads localStorage when it
// RUNS, so a held apply takes the latest write, not the one that queued it.
export const hydrateSessionsFromStorage =
  (): Thunk<void> => (dispatch, getState) => {
    const incoming = loadFromLocalStorage('tabContainerData');
    // Absent is no value to take in, not an invalid one: nothing to warn of.
    if (incoming === undefined) return;
    if (!isValidTabMasterContainer(incoming)) {
      console.warn(
        'Ignoring unreadable tabContainerData written by another page.'
      );
      return;
    }
    const current = getState().tabContainerDataState;
    if (sameContainerData(incoming, current)) return;

    const next = withOwnSelection(incoming, current.selectedTabGroupId);
    // Also ends this page's placeholder sessions (KAN-294, globalState's
    // extraReducers): from here its selection is its own, so a later sync
    // or startup load keeps it rather than taking the last writer's.
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
// changes anything. The object shape is all that is checked, as every
// settings reader does -- except the language, which reaches i18next: an
// unshipped one would make it fetch a locale file that does not exist (#42),
// so it keeps this page's instead (never the UI language: this page already
// chose one).
export const applyOtherPageSettings =
  (): Thunk<OtherPageSettingsResult> => (dispatch, getState) => {
    const current = getState().settingsDataState;
    const loaded = loadFromLocalStorage('settingsData');
    if (loaded === undefined) return { languageChanged: null };
    if (
      typeof loaded !== 'object' ||
      loaded === null ||
      Array.isArray(loaded)
    ) {
      console.warn('Ignoring unreadable settingsData written by another page.');
      return { languageChanged: null };
    }
    const incoming = asPartialSettings<SettingsData>(loaded);
    const next: SettingsData = {
      ...current,
      ...incoming,
      language: asShippedLanguage(incoming.language) ?? current.language,
    };
    if (sameIgnoringKeyOrder(next, current)) return { languageChanged: null };

    dispatch(hydrateSettingsFromOtherPage(next));
    return {
      languageChanged:
        next.language !== current.language ? next.language : null,
    };
  };
