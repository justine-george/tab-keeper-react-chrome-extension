import { css } from "@emotion/react";
import MainContainer from "./components/MainContainer";
import { useThemeColors } from "./components/hook/useThemeColors";
import { APP_WIDTH } from "./utils/constants/common";
import { useDispatch } from "react-redux";
import { useEffect } from "react";
import { observeAuthState } from "./config/firebase";
import "./App.css";

function App() {
  const COLORS = useThemeColors();
  const dispatch = useDispatch();

  useEffect(() => {
    observeAuthState(dispatch);
  }, [dispatch]);

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
