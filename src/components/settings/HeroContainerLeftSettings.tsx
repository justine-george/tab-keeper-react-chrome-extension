import { css } from '@emotion/react';

import MenuContainerSettings from './MenuContainerSettings';

export default function HeroContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    height: 60px;
    align-items: center;
    font-family: 'Libre Franklin', sans-serif;
    font-size: 1.25rem;
    padding: 16px 0px;
    user-select: none;
  `;

  return (
    <div css={containerStyle}>
      <div>
        <MenuContainerSettings />
      </div>
    </div>
  );
}
