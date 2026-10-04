import { useEffect } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector, useStore } from 'react-redux';

import { css } from '@emotion/react';

import { APP_WIDTH, TOAST_MESSAGES } from './utils/constants/common';
import { ensureCloudSession, isCloudConfigured } from './config/firebase';
import MainContainer from './components/MainContainer';
import { AppDispatch, RootState } from './redux/store';
import { setPresentStartup } from './redux/slices/undoRedoSlice';
import { useThemeColors } from './hooks/useThemeColors';
import { useDocumentTheme } from './hooks/useDocumentTheme';
import { useOtherPageChanges } from './hooks/useOtherPageChanges';
import { useTabCloudReads } from './hooks/useTabCloudReads';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { isTabView } from './utils/functions/viewMode';
import { firstOpenDialogs } from './redux/firstOpenDialogs';
import { openFirstDialog } from './utils/functions/dialogQueue';
import { storedSessionCount } from './utils/functions/storedSessions';
import {
  removeUserId,
  setCloudConfigured,
  setHasTabGroupsPermission,
  setHasSessionsPermission,
  setLoggedOut,
  setSignedIn,
  setUserId,
  showToast,
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
  classifyStoredToken,
  isUsableToken,
  isValidDate,
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from './utils/functions/local';

function App() {
  // KAN-279 D9. Another open page's write to the saved sessions or settings
  // reaches this one. Once, at the root, so there is one listener per page.
  useOtherPageChanges();

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
  const hasSyncedBefore = useSelector(
    (state: RootState) => state.globalState.hasSyncedBefore
  );

  // handle userToken issue from chrome storage sync
  function getUserTokenFromChromeStorageSync() {
    // check tokenValue in chrome storage sync
    // this token is the documentId
    chrome.storage.sync.get(['tokenValue']).then((result) => {
      const token = result.tokenValue;

      if (classifyStoredToken(token) === 'mint') {
        // No token found in chrome storage sync (new user)
        chrome.storage.sync
          .set({ tokenValue: uuidv4() })
          .then(() => {
            chrome.storage.sync
              .get(['tokenValue'])
              .then((result) => {
                // New token issued
                const newToken = result.tokenValue;

                if (!isUsableToken(newToken)) {
                  // read-back did not return what was just written
                  dispatch(setLoggedOut());
                  dispatch(removeUserId());
                  return;
                }

                dispatch(setSignedIn());
                dispatch(setUserId(newToken));
              })
              .catch(() => {
                // unable to load token from chrome storage sync
                dispatch(setLoggedOut());
                dispatch(removeUserId());
              });
          })
          .catch(() => {
            // unable to save new token in chrome storage sync
            dispatch(setLoggedOut());
            dispatch(removeUserId());
          });
      } else if (isUsableToken(token)) {
        // Token found in chrome storage sync (existing user)
        dispatch(setSignedIn());
        dispatch(setUserId(token));
      } else {
        // Token is present but is not a usable documentId. Do not mint a
        // replacement: that would point the user at a fresh, empty Firestore
        // document and strand whatever is stored under the existing one.
        dispatch(setLoggedOut());
        dispatch(removeUserId());
        dispatch(
          showToast({
            toastText: TOAST_MESSAGES.UNREADABLE_ACCOUNT_TOKEN,
          })
        );
      }
    });
  }

  useEffect(() => {
    getUserTokenFromChromeStorageSync();
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
    void openFirstDialog(dialogs);

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
  }, []);

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
