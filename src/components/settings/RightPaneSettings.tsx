import { css } from "@emotion/react";
import HeroContainerRightSettings from "./HeroContainerRightSettings";
import SettingsDetailsContainer from "./SettingsDetailsContainer";

const RightPaneSettings: React.FC = () => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerRightSettings />
      <SettingsDetailsContainer />
    </div>
  );
};

export default RightPaneSettings;
