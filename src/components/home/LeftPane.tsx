import { css } from '@emotion/react';

import HeroContainerLeft from './HeroContainerLeft';
import UserInputContainer from './UserInputContainer';
import TabGroupEntryContainer from './TabGroupEntryContainer';

export default function LeftPane() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 0px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerLeft />
      <UserInputContainer />
      <TabGroupEntryContainer />
    </div>
  );
}
