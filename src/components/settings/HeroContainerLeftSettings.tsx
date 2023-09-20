import { css } from '@emotion/react';

import { useFontFamily } from '../hook/useFontFamily';
import MenuContainerSettings from './MenuContainerSettings';

export default function HeroContainer() {
  const FONT_FAMILY = useFontFamily();

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    height: 60px;
    align-items: center;
    font-family: ${FONT_FAMILY};
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
