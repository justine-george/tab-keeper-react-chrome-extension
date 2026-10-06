import { css } from '@emotion/react';

import Icon from '../common/Icon';
import type { IconName } from '../common/iconNames';
import { GLYPH_SLOT } from './glyphSlot';
import { ICON } from '../../styles/scale';

// A translated sentence with a button's glyph where its {{icon}} was, named as the button is.
export default function GlyphSentence({
  sentence,
  icon,
  label,
}: {
  sentence: string;
  icon: IconName;
  label: string;
}) {
  const [before, after = ''] = sentence.split(GLYPH_SLOT);
  return (
    <>
      {before}
      <span
        role="img"
        aria-label={label}
        css={css`
          display: inline-flex;
          vertical-align: middle;
        `}
      >
        <Icon type={icon} size={ICON.SMALL} style="padding: 0;" />
      </span>
      {after}
    </>
  );
}
