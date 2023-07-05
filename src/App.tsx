import { css } from "@emotion/react";
import MainContainer from "./components/MainContainer";
import { GLOBAL } from "./utils/Constants";
import "./App.css";

function App() {
  const containerStyle = css`
    background-color: ${GLOBAL.PRIMARY_COLOR};
    width: 1000px;
    border: 1px solid black;
  `;

  return (
    <div css={containerStyle}>
      <MainContainer />
    </div>
  );
}

export default App;
