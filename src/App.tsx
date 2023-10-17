import { useEffect } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { APP_WIDTH } from './utils/constants/common';
import { observeAuthState } from './config/firebase';
import MainContainer from './components/MainContainer';
import { AppDispatch, RootState } from './redux/store';
import { isValidDate, loadFromLocalStorage } from './utils/helperFunctions';
import { setPresentStartup } from './redux/slice/undoRedoSlice';
import { useThemeColors } from './components/hook/useThemeColors';
import { replaceState } from './redux/slice/tabContainerDataStateSlice';
import {
  openRateAndReviewModal,
  removeUserId,
  setLoggedOut,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from './redux/slice/globalStateSlice';

import './App.css';
import { setExtensionInstalledTime } from './redux/slice/settingsDataStateSlice';

function App() {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
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

      if (!token) {
        // No token found in chrome storage sync (new user)
        chrome.storage.sync
          .set({ tokenValue: uuidv4() })
          .then(() => {
            chrome.storage.sync
              .get(['tokenValue'])
              .then((result) => {
                // New token issued
                const newToken = result.tokenValue;

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
      } else {
        // Token found in chrome storage sync (existing user)
        dispatch(setSignedIn());
        dispatch(setUserId(token));
      }
    });
  }

  // ask user to rate and review the extension
  function askUserToRateAndReview() {
    // load from localstorage to check if user has already rated and reviewed
    const {
      extensionInstalledTime = '',
      isUserRatedAndReviewed = false,
      isNeverAskAgainToRate = false,
      lastReviewRequestTime = '',
    } = loadFromLocalStorage('settingsData') || {};

    // if user has already rated and reviewed, then don't ask again
    if (isUserRatedAndReviewed || isNeverAskAgainToRate) {
      return;
    }

    // if user is first time user, then wait till he/she uses the extension for a day
    if (!isValidDate(extensionInstalledTime)) {
      dispatch(setExtensionInstalledTime());
      return;
    }
    const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
    const currentTimeInMs = new Date().getTime();
    const extensionInstalledTimeInMs = new Date(
      extensionInstalledTime
    ).getTime();
    if (currentTimeInMs - extensionInstalledTimeInMs < ONE_DAY_IN_MS) {
      return;
    }

    // if user has already been asked to rate and review, then wait for 3 days to ask again
    if (isValidDate(lastReviewRequestTime)) {
      const lastReviewRequestTimeInMs = new Date(
        lastReviewRequestTime
      ).getTime();
      const THREE_DAYS_IN_MS = 3 * ONE_DAY_IN_MS;
      if (currentTimeInMs - lastReviewRequestTimeInMs < THREE_DAYS_IN_MS) {
        return;
      }
    }

    // It's to ask the user to rate and review!
    dispatch(openRateAndReviewModal());
  }

  useEffect(() => {
    getUserTokenFromChromeStorageSync();
    askUserToRateAndReview();
    observeAuthState(dispatch);
  }, []);

  useEffect(() => {
    if (isSignedIn && userId && isAutoSync) {
      dispatch(syncStateWithFirestore());
    } else {
      // load from local storage
      const tabDataFromLocalStorage = loadFromLocalStorage('tabContainerData');
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
  }, [isSignedIn, userId]);

  const containerStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    width: ${APP_WIDTH};
  `;

  return (
    <div css={containerStyle}>
      <MainContainer />
    </div>
  );
}

export default App;
