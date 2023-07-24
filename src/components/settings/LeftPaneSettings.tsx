import { css } from "@emotion/react";
import HeroContainerLeftSettings from "./HeroContainerLeftSettings";
import SettingsCategoryContainer from "./SettingsCategoryContainer";
import { SettingsCategory } from "../../utils/Interfaces";

interface SettingsCategoryContainerProps {
  settingsCategoryList: SettingsCategory[];
  onUpdateSettingsCategoryList: Function;
}

const LeftPaneSettings: React.FC<SettingsCategoryContainerProps> = ({
  settingsCategoryList,
  onUpdateSettingsCategoryList,
}) => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 0px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerLeftSettings />
      <SettingsCategoryContainer
        settingsCategoryList={settingsCategoryList}
        onUpdateSettingsCategoryList={onUpdateSettingsCategoryList}
      />
    </div>
  );
};

export default LeftPaneSettings;