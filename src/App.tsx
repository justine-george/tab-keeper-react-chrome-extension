import { useEffect } from 'react';

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
import { loadStateFromFirestore } from './redux/slice/globalStateSlice';

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

  useEffect(() => {
    observeAuthState(dispatch);

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
  }, [dispatch, isSignedIn, userId]);

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
