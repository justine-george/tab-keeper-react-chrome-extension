import { css } from "@emotion/react";
import LeftPane from "./home/LeftPane";
import RightPane from "./home/RightPane";
import { useSelector } from "react-redux";
import { RootState } from "../utils/store";
import LeftPaneSettings from "./settings/LeftPaneSettings";
import RightPaneSettings from "./settings/RightPaneSettings";
import { useState } from "react";
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

  const [settingsCategoryList, setSettingsCategoryList] = useState([
    {
      name: "General",
      isSelected: true, // to be updated
    },
    {
      name: "Credits",
      isSelected: false, // to be updated
    },
  ]);

  // select the settings category
  function onUpdateSettingsCategoryList(categoryToSelect: string) {
    const newList = settingsCategoryList.map((settingsCategory) => {
      return {
        name: settingsCategory.name,
        isSelected: settingsCategory.name === categoryToSelect ? true : false,
      };
    });
    setSettingsCategoryList(newList);
  }

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
            <LeftPaneSettings
              settingsCategoryList={settingsCategoryList}
              onUpdateSettingsCategoryList={onUpdateSettingsCategoryList}
            />
          </div>
          <div
            css={css`
              width: 70%;
              height: 600px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              margin: 4px 4px 4px 4px;
            `}
          >
            <RightPaneSettings settingsCategoryList={settingsCategoryList} />
          </div>
        </div>
      )}
    </div>
  );
}
