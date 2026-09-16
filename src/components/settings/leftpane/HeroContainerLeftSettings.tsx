import { css } from '@emotion/react';

import { useFontFamily } from '../../../hooks/useFontFamily';
import MenuContainerSettings from './MenuContainerSettings';
import { CONTROL, TYPE } from '../../../styles/scale';

export default function HeroContainer() {
  const FONT_FAMILY = useFontFamily();

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    height: ${CONTROL.HEADER};
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.TITLE};
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
