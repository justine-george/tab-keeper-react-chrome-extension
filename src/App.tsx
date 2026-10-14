import { useEffect } from 'react';

import { useDispatch, useSelector, useStore } from 'react-redux';

import { css } from '@emotion/react';

import { APP_WIDTH } from './utils/constants/common';
import { ensureCloudSession, isCloudConfigured } from './config/firebase';
import MainContainer from './components/MainContainer';
import { AppDispatch, RootState } from './redux/store';
import { setPresentStartup } from './redux/slices/undoRedoSlice';
import { useThemeColors } from './hooks/useThemeColors';
import { useDocumentTheme } from './hooks/useDocumentTheme';
import { useOtherPageChanges } from './hooks/useOtherPageChanges';
import { useFullViewShowRequests } from './hooks/useFullViewShowRequests';
import { useTabCloudReads } from './hooks/useTabCloudReads';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { isTabView } from './utils/functions/viewMode';
import { firstOpenDialogs } from './redux/firstOpenDialogs';
import { offerTabGroupsOnReturn } from './redux/tabGroupsOfferOnReturn';
import { takeShowFromAddress } from './utils/functions/fullViewShow';
import { fullViewShowEntry } from './redux/fullViewShow';
import { openFirstDialog } from './utils/functions/dialogQueue';
import { storedSessionCount } from './utils/functions/storedSessions';
import {
  followDeviceId,
  mintDeviceIdIfNone,
  readDeviceId,
} from './redux/deviceId';
import {
  setCloudConfigured,
  setHasTabGroupsPermission,
  setHasSessionsPermission,
  loadStoredSessionsIntoPage,
  storedLoadMustWaitForRelease,
  syncStateWithFirestore,
} from './redux/slices/globalStateSlice';
import { whenDragReleases } from './redux/dragHold';
import { hydrateSessionsFromStorage } from './redux/otherPageChanges';
import {
  hasTabGroupsPermission,
  observeTabGroupsPermission,
  hasSessionsPermission,
  observeSessionsPermission,
} from './utils/functions/permissions';

import './App.css';
import {
  setExtensionInstalledTime,
  markFullViewOpened,
  SettingsData,
  cloudSyncAllowed,
} from './redux/slices/settingsDataStateSlice';
import {
  asPartialSettings,
  isValidDate,
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from './utils/functions/local';

function App() {
  // KAN-279 D9. Another open page's write to the saved sessions or settings
  // reaches this one. Once, at the root, so there is one listener per page.
  useOtherPageChanges();
  useFullViewShowRequests();

  // KAN-279 D11. The tab view's own periodic/on-focus cloud read; a no-op in
  // the popup (isTabView() gates the whole effect inside the hook).
  useTabCloudReads();

  // KAN-301. document.title, in the tab view only; a no-op in the popup
  // (isTabView() gates the whole effect inside the hook).
  useDocumentTitle();

  const COLORS = useThemeColors();

  // Publishes the theme to <html>: scrollbar custom properties, and the flag
  // that suppresses transitions while the colours change (KAN-22). Mounted at
  // the root so it covers every route into a theme change, including a change
  // arriving from settings sync rather than the swatches in Settings.
  useDocumentTheme();

  const dispatch: AppDispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );
  const isFirebaseAuthed = useSelector(
    (state: RootState) => state.globalState.isFirebaseAuthed
  );
  const userId = useSelector((state: RootState) => state.globalState.userId);
  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );
  const syncAllowed = cloudSyncAllowed(settingsData);
  const consentGranted = settingsData.cloudConsent === 'granted';
  const awaitsDeviceId = useSelector(
    (state: RootState) => state.globalState.awaitsDeviceId
  );
  const hasSyncedBefore = useSelector(
    (state: RootState) => state.globalState.hasSyncedBefore
  );

  useEffect(() => {
    void dispatch(readDeviceId());
    const stopFollowingDeviceId = followDeviceId(dispatch, reduxStore.getState);
    dispatch(setCloudConfigured(isCloudConfigured));
    // KAN-7 §8. Decided from the disk as it was before this open wrote to it.
    const storedAtOpen = asPartialSettings<SettingsData>(
      loadFromLocalStorage('settingsData')
    );
    const dialogs = firstOpenDialogs(isTabView() ? 'full' : 'popup', {
      dispatch,
      storedAtOpen,
      storedSessions: storedSessionCount(),
      getState: reduxStore.getState,
    });
    // KAN-7 §6. The full view mounting is what "opened the full view" means.
    if (isTabView()) dispatch(markFullViewOpened());
    // KAN-149. Stamped on every open that lacks one; the rate prompt needs it.
    if (!isValidDate(storedAtOpen.extensionInstalledTime ?? '')) {
      dispatch(setExtensionInstalledTime());
    }
    // The e2e barrier for "the queue opened nothing", which no dialog can show.
    // A full view opened for a dialog decides only that one.
    const requested = isTabView() ? takeShowFromAddress() : null;
    const entries =
      requested === null ? dialogs : [fullViewShowEntry(requested, dispatch)];
    // KAN-565. The full view watches for returns once the load's queue settles.
    let isUnmounted = false;
    let stopOfferOnReturn: () => void = () => undefined;
    void openFirstDialog(
      entries,
      () => reduxStore.getState().globalState.hasRunShownHere
    ).then((opened) => {
      document.documentElement.dataset.firstOpen = opened ?? 'none';
      if (!isTabView() || isUnmounted) return;
      stopOfferOnReturn = offerTabGroupsOnReturn(
        dispatch,
        reduxStore.getState,
        opened === 'tabGroups'
      );
    });

    void hasTabGroupsPermission().then((granted) =>
      dispatch(setHasTabGroupsPermission(granted))
    );
    observeTabGroupsPermission((granted) =>
      dispatch(setHasTabGroupsPermission(granted))
    );

    void hasSessionsPermission().then((granted) =>
      dispatch(setHasSessionsPermission(granted))
    );
    observeSessionsPermission((granted) =>
      dispatch(setHasSessionsPermission(granted))
    );
    return () => {
      isUnmounted = true;
      stopOfferOnReturn();
      stopFollowingDeviceId();
    };
  }, []);

  // KAN-599. The id is minted at the yes, whichever control gave it.
  useEffect(() => {
    if (consentGranted && awaitsDeviceId) void dispatch(mintDeviceIdIfNone());
  }, [consentGranted, awaitsDeviceId, dispatch]);

  useEffect(() => {
    // isFirebaseAuthed is what makes this wait for the sign-in round trip.
    // Without it the chrome.storage.sync read alone opened this gate, and the
    // first sync of every cold start was denied by the security rules before
    // request.auth existed (KAN-70). The local-storage branch below runs in the
    // meantime, so there is nothing to show for the wait.
    // KAN-259. `syncAllowed` is consent AND the Auto Sync flag, and the
    // sign-in starts here, lazily, only once it is true: a user who never
    // says yes never creates a Firebase account. When auth then lands,
    // isFirebaseAuthed flips and this effect runs again into the sync.
    if (isSignedIn && userId && syncAllowed) ensureCloudSession(dispatch);
    if (isSignedIn && isFirebaseAuthed && userId && syncAllowed) {
      dispatch(syncStateWithFirestore());
    } else {
      // load from local storage
      // Session data, so it gets validated rather than asserted: this is the
      // same object the signed-in path replicates to Firestore.
      const candidate = loadFromLocalStorage('tabContainerData');
      const tabDataFromLocalStorage = isValidTabMasterContainer(candidate)
        ? candidate
        : undefined;
      if (candidate !== undefined && tabDataFromLocalStorage === undefined) {
        console.warn('Ignoring unreadable tabContainerData in localStorage.');
      }
      if (
        tabDataFromLocalStorage &&
        storedLoadMustWaitForRelease(
          reduxStore.getState(),
          tabDataFromLocalStorage
        )
      ) {
        // KAN-298. A re-run found another page's write while a row is held:
        // loading it would move the list under the pointer. It is taken in at
        // the release, from localStorage as it is THEN, with this page's
        // selection and an undo reset. The hydrate, not a closure that checks
        // the hold: that would queue itself again during the drop's flush.
        whenDragReleases(() => dispatch(hydrateSessionsFromStorage()));
      } else if (tabDataFromLocalStorage) {
        // KAN-294. On mount this is the page's first load and keeps the
        // stored selection; a re-run (sign-in, a hydrated consent or Auto Sync
        // change) keeps this page's own, not the last writer's. KAN-295: a
        // re-run that finds another page's write not yet taken in resets undo.
        const loaded = dispatch(
          loadStoredSessionsIntoPage(tabDataFromLocalStorage)
        );

        if (!hasSyncedBefore) {
          // reset presentState in the undoRedoState
          dispatch(
            setPresentStartup({
              tabContainerDataState: loaded,
            })
          );
        }
      }
    }
    // isFirebaseAuthed is load-bearing in this array, not decoration: it is the
    // flag that flips late, and re-running on it is what makes the sync happen
    // at all once auth lands. Recovery used to depend on isSignedIn flapping
    // false -> true, which was accidental (KAN-70).
  }, [isSignedIn, isFirebaseAuthed, userId, syncAllowed]);

  // KAN-279 D1/D2. The tab view fills the window instead of sitting in the
  // popup's fixed 790px box; the popup's own sizing (and its page-zoom
  // adaptation) is untouched below.
  const containerStyle = isTabView()
    ? css`
        background-color: ${COLORS.PRIMARY_COLOR};
        width: 100%;
        min-height: 100vh;
      `
    : css`
        background-color: ${COLORS.PRIMARY_COLOR};
        width: ${APP_WIDTH};
        /* Chrome applies the browser's default page zoom to extension popups, so
           the 800x600 allowance shrinks with it. Adapt rather than overflow. */
        max-width: 100%;
      `;

  return (
    <div css={containerStyle}>
      <MainContainer />
    </div>
  );
}

export default App;
