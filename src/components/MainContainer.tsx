import { css } from "@emotion/react";
import LeftPane from "./home/LeftPane";
import RightPane from "./home/RightPane";
import { useSelector } from "react-redux";
import { RootState } from "../redux/store";
import LeftPaneSettings from "./settings/LeftPaneSettings";
import RightPaneSettings from "./settings/RightPaneSettings";
import { useThemeColors } from "./hook/useThemeColors";

export default function MainContainer() {
  const COLORS = useThemeColors();

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-content: center;
  `;

  const leftPaneStyle = css`
    width: 50%;
    height: 600px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 4px 4px 4px 4px;
  `;

  const rightPaneStyle = css`
    width: 50%;
    height: 600px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 4px 4px 4px 4px;
  `;

  const leftPaneSettingsStyle = css`
    width: 30%;
    height: 600px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 4px 4px 4px 4px;
  `;

  const rightPaneSettingsStyle = css`
    width: 70%;
    height: 600px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 4px 4px 4px 4px;
  `;

  return (
    <div>
      {!isSettingsPage ? (
        <div css={containerStyle}>
          <div css={leftPaneStyle}>
            <LeftPane />
          </div>
          <div css={rightPaneStyle}>
            <RightPane />
          </div>
        </div>
      ) : (
        <div css={containerStyle}>
          <div css={leftPaneSettingsStyle}>
            <LeftPaneSettings />
          </div>
          <div css={rightPaneSettingsStyle}>
            <RightPaneSettings />
          </div>
        </div>
      )}
    </div>
  );
}
