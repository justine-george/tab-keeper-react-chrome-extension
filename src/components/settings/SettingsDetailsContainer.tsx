import { css } from "@emotion/react";
import { SettingsDetailsContainerProps } from "../../utils/interfaces";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import { NormalLabel } from "../common/Label";
import {
  toggleAutoSave,
  toggleAutoSync,
  toggleDarkMode,
} from "../../redux/slice/settingsDataStateSlice";
import Button from "../common/Button";
import { useThemeColors } from "../hook/useThemeColors";
import { Account } from "./Account";

const SettingsDetailsContainer: React.FC<
  SettingsDetailsContainerProps
> = ({}) => {
  const COLORS = useThemeColors();

  const dispatch = useDispatch();

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState
  );

  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const settingsItemStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 250px;
    margin-bottom: 16px;
  `;

  const settingsCategoryName: string = settingsCategoryList.filter(
    (settings) => settings.isSelected
  )[0].name;

  let settingsOptionsDiv;
  if (settingsCategoryName === "General") {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
          margin-top: 40px;
        `}
      >
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Toggle Theme"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isDarkMode ? `Light` : `Dark`}
            onClick={() => dispatch(toggleDarkMode())}
            style={`
              margin-left: 16px;
              width: 120px;
              &:hover {
                background-color: ${COLORS.INVERSE_PRIMARY_COLOR};
                border: 1px solid ${COLORS.INVERSE_PRIMARY_COLOR};
                color: ${COLORS.PRIMARY_COLOR};
              }
            `}
          />
        </div>
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Auto Sync"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isAutoSync ? `On` : `Off`}
            onClick={() => dispatch(toggleAutoSync())}
            style={`
              margin-left: 16px;
              width: 120px;
            `}
          />
        </div>
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Auto Save"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isAutoSave ? `On` : `Off`}
            onClick={() => dispatch(toggleAutoSave())}
            style={`
              margin-left: 16px;
              width: 120px;
            `}
          />
        </div>
      </div>
    );
  } else if (settingsCategoryName === "Credits") {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 40px;
        `}
      >
        <NormalLabel value={settingsData.footerText} />
      </div>
    );
  } else if (settingsCategoryName === "Account") {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 40px;
        `}
      >
        <Account />
      </div>
    );
  }

  return <div css={containerStyle}>{settingsOptionsDiv}</div>;
};

export default SettingsDetailsContainer;
