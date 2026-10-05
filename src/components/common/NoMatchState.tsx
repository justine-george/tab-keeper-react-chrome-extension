import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import NoMatchArt from './NoMatchArt';
import { NormalLabel } from './Label';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { TYPE } from '../../styles/scale';

interface NoMatchStateProps {
  // The trimmed query.
  query: string;
  // Side padding in px: 48 in the detail pane, 24 in the list.
  inset: 48 | 24;
  // Which list was searched: the two differ in what they look in.
  scope: 'saved' | 'open';
}

// A search's empty state, centred both ways in whatever holds it.
export default function NoMatchState({
  query,
  inset,
  scope,
}: NoMatchStateProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const blockStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    padding: 0 ${inset}px;
    gap: 12px;
    text-align: center;
    color: ${COLORS.LABEL_L3_COLOR};
  `;

  const hintStyle = css`
    margin: 0;
    max-width: 26em;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECONDARY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L3_COLOR};
    text-wrap: balance;
  `;

  return (
    <div css={blockStyle} data-no-match>
      <NoMatchArt />
      <NormalLabel
        value={
          scope === 'saved'
            ? t('NoSavedTabMatches', { text: query })
            : t('NoOpenTabMatches', { text: query })
        }
        size={TYPE.BODY}
        color={COLORS.LABEL_L2_COLOR}
        style="max-width: 100%;"
      />
      <p css={hintStyle}>
        {scope === 'saved'
          ? t(
              'Search looks in session names, window names, tab titles and links.'
            )
          : t('Search looks in tab titles and links.')}
      </p>
    </div>
  );
}
