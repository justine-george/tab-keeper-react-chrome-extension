import { memo } from 'react';

import { css } from '@emotion/react';

import HeroContainerLeft from './HeroContainerLeft';
import UserInputContainer from './UserInputContainer';
import TabGroupEntryContainer from './TabGroupEntryContainer';

function LeftPane() {
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

// Memoised (KAN-321 O1a): MainContainer re-renders on every pointermove of
// an Open now resize, and this pane has nothing to redraw for it.
export default memo(LeftPane);
