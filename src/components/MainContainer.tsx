import { css } from "@emotion/react";
import LeftPane from "./LeftPane";
import RightPane from "./RightPane";
import { useSelector } from "react-redux";
import { RootState } from "../utils/store";
import LeftPaneSettings from "./LeftPaneSettings";
import RightPaneSettings from "./RightPaneSettings";

export default function MainContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-content: center;
  `;

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  return (
    <div>
      {!isSettingsPage ? (
        <div css={containerStyle}>
          <div
            css={css`
              width: 50%;
              height: 600px;
              border: 1px solid black;
              margin: 4px 4px 4px 4px;
            `}
          >
            <LeftPane />
          </div>
          <div
            css={css`
              width: 50%;
              height: 600px;
              border: 1px solid black;
              margin: 4px 4px 4px 4px;
            `}
          >
            <RightPane />
          </div>
        </div>
      ) : (
        <div css={containerStyle}>
          <div
            css={css`
              width: 30%;
              height: 600px;
              border: 1px solid black;
              margin: 4px 4px 4px 4px;
            `}
          >
            <LeftPaneSettings />
          </div>
          <div
            css={css`
              width: 70%;
              height: 600px;
              border: 1px solid black;
              margin: 4px 4px 4px 4px;
            `}
          >
            <RightPaneSettings />
          </div>
        </div>
      )}
    </div>
  );
}
