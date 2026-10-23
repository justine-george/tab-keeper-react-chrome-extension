import { css } from '@emotion/react';

import { paneInsetCss } from '../../../styles/paneInset';

import SettingsDetailsContainer from './SettingsDetailsContainer';
import HeroContainerRightSettings from './HeroContainerRightSettings';

const RightPaneSettings: React.FC = () => {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    ${paneInsetCss}
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
