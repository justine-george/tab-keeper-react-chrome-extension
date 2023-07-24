import { css } from "@emotion/react";
import MainContainer from "./components/MainContainer";
import "./App.css";
import { useThemeColors } from "./components/hook/useThemeColors";

function App() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    background-color: ${COLORS.PRIMARY_COLOR};
    width: 800px;
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  return (
    <div css={containerStyle}>
      <MainContainer />
    </div>
  );
}

export default App;
