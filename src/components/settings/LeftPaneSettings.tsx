import { css } from '@emotion/react';
import HeroContainerLeftSettings from './HeroContainerLeftSettings';
import SettingsCategoryContainer from './SettingsCategoryContainer';

const LeftPaneSettings: React.FC = () => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 0px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerLeftSettings />
      <SettingsCategoryContainer />
    </div>
  );
};

export default LeftPaneSettings;
