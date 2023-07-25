import { css } from "@emotion/react";
import LeftPane from "./home/LeftPane";
import RightPane from "./home/RightPane";
import { useSelector } from "react-redux";
import { RootState } from "../utils/store";
import LeftPaneSettings from "./settings/LeftPaneSettings";
import RightPaneSettings from "./settings/RightPaneSettings";
import { useThemeColors } from "./hook/useThemeColors";

export default function MainContainer() {
  const COLORS = useThemeColors();

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
              border: 1px solid ${COLORS.BORDER_COLOR};
              margin: 4px 4px 4px 4px;
            `}
          >
            <LeftPane />
          </div>
          <div
            css={css`
              width: 50%;
              height: 600px;
              border: 1px solid ${COLORS.BORDER_COLOR};
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
              border: 1px solid ${COLORS.BORDER_COLOR};
              margin: 4px 4px 4px 4px;
            `}
          >
            <LeftPaneSettings />
          </div>
          <div
            css={css`
              width: 70%;
              height: 600px;
              border: 1px solid ${COLORS.BORDER_COLOR};
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
