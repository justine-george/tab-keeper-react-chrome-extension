import { useId } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Button from '../../common/Button';
import Icon from '../../common/Icon';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import type { AppDispatch } from '../../../redux/store';
import { startSampleTour } from '../../../redux/sampleTour';
import { useSampleNames } from '../../../hooks/useSampleNames';
import { ICON, TYPE } from '../../../styles/scale';

// Where the save glyph goes in the translated step, split out as ShortcutSentence splits its keys.
const GLYPH_SLOT = '\u2063';

// In the empty saved list, popup and full view; page content, so it sits behind any dialog.
export default function StartHereCard() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const titleId = useId();
  const sampleNames = useSampleNames();
  const [beforeGlyph, afterGlyph = ''] = t(
    'Type a name, then press {{icon}} to save every open window.',
    { icon: GLYPH_SLOT }
  ).split(GLYPH_SLOT);

  const cardStyle = css`
    margin: 12px;
    padding: 16px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background-color: ${COLORS.PRIMARY_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    color: ${COLORS.LABEL_L1_COLOR};
    text-align: left;
  `;
  // font: inherit drops the browser's bold; the popup ranks by size and colour.
  const headingStyle = css`
    margin: 0 0 10px 0;
    font: inherit;
    font-size: ${TYPE.SECTION};
    color: ${COLORS.TEXT_COLOR};
  `;
  const listStyle = css`
    margin: 0 0 16px 0;
    padding-left: 20px;
    line-height: 1.6;
  `;
  const glyphStyle = css`
    display: inline-flex;
    vertical-align: middle;
  `;

  return (
    <section data-start-here aria-labelledby={titleId} css={cardStyle}>
      <h2 id={titleId} css={headingStyle}>
        {t('Start here')}
      </h2>
      <ol css={listStyle}>
        <li>
          {beforeGlyph}
          <span
            role="img"
            aria-label={t('Save every open window as a session')}
            css={glyphStyle}
          >
            <Icon type="library_add" size={ICON.SMALL} style="padding: 0;" />
          </span>
          {afterGlyph}
        </li>
        <li>{t('Pick a saved session to see its tabs.')}</li>
        <li>{t('Press Open to bring them all back, any time.')}</li>
      </ol>
      <Button
        text={t('Try it with an example')}
        onClick={() => void dispatch(startSampleTour(sampleNames))}
      />
    </section>
  );
}
