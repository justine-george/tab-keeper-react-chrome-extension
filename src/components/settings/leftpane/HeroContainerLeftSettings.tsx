import { css } from '@emotion/react';

import { useFontFamily } from '../../../hooks/useFontFamily';
import MenuContainerSettings from './MenuContainerSettings';
import { TYPE } from '../../../styles/scale';

export default function HeroContainer() {
  const FONT_FAMILY = useFontFamily();

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.TITLE};
    /* No fixed height: a pane header is not a control, it is content
       plus padding, and giving it a control height is what put 32px of
       icons inside a 64px box with half of it empty.

       12px against the pane's 8px sides. 8px was tried and read as
       tight; 16px is what it was, and that is the floating look. */
    padding: 12px 0px;
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
