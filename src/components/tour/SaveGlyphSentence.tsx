import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { GLYPH_SLOT } from './glyphSlot';
import { ICON } from '../../styles/scale';

// A translated sentence with the save button's glyph where its {{icon}} was.
export default function SaveGlyphSentence({ sentence }: { sentence: string }) {
  const { t } = useTranslation();
  const [before, after = ''] = sentence.split(GLYPH_SLOT);
  return (
    <>
      {before}
      <span
        role="img"
        aria-label={t('Save every open window as a session')}
        css={css`
          display: inline-flex;
          vertical-align: middle;
        `}
      >
        <Icon type="library_add" size={ICON.SMALL} style="padding: 0;" />
      </span>
      {after}
    </>
  );
}
