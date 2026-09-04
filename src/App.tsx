import { useEffect } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { APP_WIDTH, TOAST_MESSAGES } from './utils/constants/common';
import { observeAuthState } from './config/firebase';
import MainContainer from './components/MainContainer';
import { AppDispatch, RootState } from './redux/store';
import { setPresentStartup } from './redux/slices/undoRedoSlice';
import { useThemeColors } from './hooks/useThemeColors';
import { useDocumentTheme } from './hooks/useDocumentTheme';
import { replaceState } from './redux/slices/tabContainerDataStateSlice';
import {
  openRateAndReviewModal,
  openTabGroupsPrompt,
  removeUserId,
  setHasTabGroupsPermission,
  setLoggedOut,
  setSignedIn,
  setUserId,
  showToast,
  syncStateWithFirestore,
} from './redux/slices/globalStateSlice';
import {
  hasTabGroupsPermission,
  observeTabGroupsPermission,
} from './utils/functions/permissions';
import { shouldOfferTabGroups } from './utils/functions/tabGroupsOffer';

import './App.css';
import {
  setExtensionInstalledTime,
  SettingsData,
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
  const COLORS = useThemeColors();

  // Publishes the theme to <html>: scrollbar custom properties, and the flag
  // that suppresses transitions while the colours change (KAN-22). Mounted at
  // the root so it covers every route into a theme change, including a change
  // arriving from settings sync rather than the swatches in Settings.
  useDocumentTheme();

  const dispatch: AppDispatch = useDispatch();
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );
  const isFirebaseAuthed = useSelector(
    (state: RootState) => state.globalState.isFirebaseAuthed
  );
  const userId = useSelector((state: RootState) => state.globalState.userId);
  const isAutoSync = useSelector(
    (state: RootState) => state.settingsDataState.isAutoSync
  );
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

  // ask user to rate and review the extension
  //
  // Returns whether it opened the modal. KAN-74 needs that answer to keep two
  // modals off the screen at once, and it cannot read it back out of Redux:
  // this function is synchronous while the tab-groups check below is async, so
  // by the time that one resolves it would be reading a store it has no
  // guarantee of having seen settle. Handing the decision over as a value
  // makes the coordination explicit instead of an accident of dispatch order.
  function askUserToRateAndReview(): boolean {
    // load from localstorage to check if user has already rated and reviewed
    const {
      extensionInstalledTime = '',
      isUserRatedAndReviewed = false,
      isNeverAskAgainToRate = false,
      lastReviewRequestTime = '',
    } = asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));

    // if user has already rated and reviewed, then don't ask again
    if (isUserRatedAndReviewed || isNeverAskAgainToRate) {
      return false;
    }

    // if user is first time user, then wait till he/she uses the extension for a day
    if (!isValidDate(extensionInstalledTime)) {
      dispatch(setExtensionInstalledTime());
      return false;
    }
    const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
    const currentTimeInMs = new Date().getTime();
    const extensionInstalledTimeInMs = new Date(
      extensionInstalledTime
    ).getTime();
    if (currentTimeInMs - extensionInstalledTimeInMs < ONE_DAY_IN_MS) {
      return false;
    }

    // if user has already been asked to rate and review, then wait for 3 days to ask again
    if (isValidDate(lastReviewRequestTime)) {
      const lastReviewRequestTimeInMs = new Date(
        lastReviewRequestTime
      ).getTime();
      const THREE_DAYS_IN_MS = 3 * ONE_DAY_IN_MS;
      if (currentTimeInMs - lastReviewRequestTimeInMs < THREE_DAYS_IN_MS) {
        return false;
      }
    }

    // It's to ask the user to rate and review!
    dispatch(openRateAndReviewModal());
    return true;
  }

  // KAN-74. Offer the optional "tabGroups" permission to a user who has tab
  // groups open right now. shouldOfferTabGroups owns every condition; this
  // only turns its answer into a dispatch.
  //
  // "Never from autosave" is satisfied by construction rather than by a check:
  // autosave runs in the service worker, and App only mounts when the user
  // opens the popup.
  async function offerTabGroupsPermission(
    isRateAndReviewModalShowing: boolean
  ) {
    const openGroups = await shouldOfferTabGroups(isRateAndReviewModalShowing);
    if (openGroups !== null) dispatch(openTabGroupsPrompt(openGroups));
  }

  useEffect(() => {
    getUserTokenFromChromeStorageSync();
    void offerTabGroupsPermission(askUserToRateAndReview());
    observeAuthState(dispatch);

    void hasTabGroupsPermission().then((granted) =>
      dispatch(setHasTabGroupsPermission(granted))
    );
    observeTabGroupsPermission((granted) =>
      dispatch(setHasTabGroupsPermission(granted))
    );
  }, []);

  useEffect(() => {
    // isFirebaseAuthed is what makes this wait for the sign-in round trip.
    // Without it the chrome.storage.sync read alone opened this gate, and the
    // first sync of every cold start was denied by the security rules before
    // request.auth existed (KAN-70). The local-storage branch below runs in the
    // meantime, so there is nothing to show for the wait.
    if (isSignedIn && isFirebaseAuthed && userId && isAutoSync) {
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
      if (tabDataFromLocalStorage) {
        dispatch(replaceState(tabDataFromLocalStorage));

        if (!hasSyncedBefore) {
          // reset presentState in the undoRedoState
          dispatch(
            setPresentStartup({
              tabContainerDataState: tabDataFromLocalStorage,
            })
          );
        }
      }
    }
    // isFirebaseAuthed is load-bearing in this array, not decoration: it is the
    // flag that flips late, and re-running on it is what makes the sync happen
    // at all once auth lands. Recovery used to depend on isSignedIn flapping
    // false -> true, which was accidental (KAN-70).
  }, [isSignedIn, isFirebaseAuthed, userId]);

  const containerStyle = css`
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
