import { useEffect } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { APP_WIDTH } from './utils/constants/common';
import { observeAuthState } from './config/firebase';
import MainContainer from './components/MainContainer';
import { AppDispatch, RootState } from './redux/store';
import { loadFromLocalStorage } from './utils/helperFunctions';
import { setPresentStartup } from './redux/slice/undoRedoSlice';
import { useThemeColors } from './components/hook/useThemeColors';
import { replaceState } from './redux/slice/tabContainerDataStateSlice';
import {
  loadStateFromFirestore,
  removeUserId,
  setLoggedOut,
  setSignedIn,
  setUserId,
} from './redux/slice/globalStateSlice';

import './App.css';

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

  //
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

  useEffect(() => {
    getUserTokenFromChromeStorageSync();
    observeAuthState(dispatch);
  }, []);

  useEffect(() => {
    // fetch data from Firestore
    if (isSignedIn && userId && isAutoSync) {
      dispatch(loadStateFromFirestore(userId));
    } else {
      // load from local storage
      const tabDataFromLocalStorage = loadFromLocalStorage('tabContainerData');
      if (tabDataFromLocalStorage) {
        dispatch(replaceState(tabDataFromLocalStorage));

        // reset presentState in the undoRedoState
        dispatch(
          setPresentStartup({ tabContainerDataState: tabDataFromLocalStorage })
        );
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
