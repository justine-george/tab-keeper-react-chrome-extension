import { css } from "@emotion/react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "../../redux/store";
import { NormalLabel } from "../common/Label";
import {
  toggleAutoSync,
  toggleDarkMode,
} from "../../redux/slice/settingsDataStateSlice";
import Button from "../common/Button";
import { useThemeColors } from "../hook/useThemeColors";
import { Account } from "./Account";
import {
  APP_VERSION,
  DEV_CREDITS,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  FEEDBACK_REQUEST,
  SHARE_TWITTER_TEXT,
} from "../../utils/constants/common";
import { syncWithThunk } from "../../redux/slice/globalStateSlice";

const SettingsDetailsContainer: React.FC = () => {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState,
  );

  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState,
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
    (settings) => settings.isSelected,
  )[0].name;

  const handleToggleAutoSync = () => {
    if (!settingsData.isAutoSync) {
      dispatch(syncWithThunk());
    }
    dispatch(toggleAutoSync());
  };

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
            onClick={handleToggleAutoSync}
            style={`
              margin-left: 16px;
              width: 120px;
            `}
          />
        </div>
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
  } else if (settingsCategoryName === "Credits") {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          height: 100%;
          align-items: center;
          margin-top: 40px;
          flex-grow: 1;
        `}
      >
        <NormalLabel color={COLORS.LABEL_L1_COLOR} value={DEV_CREDITS} />
        <Button
          text={FEEDBACK_REQUEST}
          iconType="mail"
          onClick={() =>
            (window.location.href = `mailto:${DEV_EMAIL}?subject=${FEEDBACK_MAIL_SUBJECT}`)
          }
          style="width: 250px; justify-content: center; margin-top: 16px;"
        />
        <Button
          text={"Share on Twitter (X)"}
          iconType="send"
          onClick={() => window.open(SHARE_TWITTER_TEXT)}
          style="width: 250px; justify-content: center; margin-top: 16px;"
        />
        <NormalLabel
          color={COLORS.LABEL_L3_COLOR}
          value={`v${APP_VERSION}`}
          style={`margin: auto auto 30px;`}
        />
      </div>
    );
  }

  return <div css={containerStyle}>{settingsOptionsDiv}</div>;
};

export default SettingsDetailsContainer;
