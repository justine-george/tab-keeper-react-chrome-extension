import { css } from "@emotion/react";
import HeroContainerRightSettings from "./HeroContainerRightSettings";
import SettingsDetailsContainer from "./SettingsDetailsContainer";
import { SettingsDetailsContainerProps } from "../../utils/Interfaces";

const RightPaneSettings: React.FC<SettingsDetailsContainerProps> = ({
  settingsCategoryList,
}) => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerRightSettings />
      <SettingsDetailsContainer settingsCategoryList={settingsCategoryList} />
    </div>
  );
};

export default RightPaneSettings;
