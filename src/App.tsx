import { css } from "@emotion/react";
import MainContainer from "./components/MainContainer";
import { useThemeColors } from "./components/hook/useThemeColors";
import { APP_WIDTH } from "./utils/constants/common";
import { useDispatch, useSelector } from "react-redux";
import { useEffect } from "react";
import { observeAuthState } from "./config/firebase";
import { AppDispatch, RootState } from "./redux/store";
import { loadFromLocalStorage } from "./utils/helperFunctions";
import { replaceState } from "./redux/slice/tabContainerDataStateSlice";
import { loadStateFromFirestore } from "./redux/slice/globalStateSlice";
import { setPresentStartup } from "./redux/slice/undoRedoSlice";
import "./App.css";

function App() {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn,
  );
  const userId = useSelector((state: RootState) => state.globalState.userId);

  useEffect(() => {
      observeAuthState(dispatch);

    // if signed in, fetch data from Firestore
    if (isSignedIn && userId) {
      dispatch(loadStateFromFirestore(userId));
    } else {
      // load from local storage
      const tabDataFromLocalStorage = loadFromLocalStorage("tabContainerData");
      if (tabDataFromLocalStorage) {
        dispatch(replaceState(tabDataFromLocalStorage));

        // reset presentState in the undoRedoState
        dispatch(
          setPresentStartup({ tabContainerDataState: tabDataFromLocalStorage }),
        );
      }
    }
  }, [dispatch, isSignedIn, userId]);

  const containerStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    width: ${APP_WIDTH};
    // border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  return (
    <div css={containerStyle}>
      <MainContainer />
    </div>
  );
}

export default App;
