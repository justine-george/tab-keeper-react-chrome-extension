import { css } from "@emotion/react";
import { SettingsDetailsContainerProps } from "../../utils/Interfaces";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../utils/store";
import { NormalLabel } from "../common/Label";
import { toggleDarkMode } from "../slice/settingsStateSlice";
import Button from "../common/Button";
import { useThemeColors } from "../hook/useThemeColors";

const SettingsDetailsContainer: React.FC<SettingsDetailsContainerProps> = ({
  settingsCategoryList,
}) => {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    // height: 100%;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const dispatch = useDispatch();

  const settingsItemStyle = css`
    display: flex;
    align-items: center;
    padding: 4px;
  `;

  const settingsData = useSelector((state: RootState) => state.settingsState);

  const settingsCategoryName: string = settingsCategoryList.filter(
    (settings) => settings.isSelected
  )[0].name;

  let settingsOptionsDiv;
  if (settingsCategoryName === "General") {
    settingsOptionsDiv = (
      <>
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Toggle Theme"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isDarkMode ? `Light` : `Dark`}
            onClick={() => dispatch(toggleDarkMode())}
            style="margin-left: 16px; width: 120px;"
          />
        </div>
      </>
    );
  } else if (settingsCategoryName === "Credits") {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100%;
        `}
      >
        <NormalLabel value={settingsData.footerText} />
      </div>
    );
  }

  return <div css={containerStyle}>{settingsOptionsDiv}</div>;
};

export default SettingsDetailsContainer;
