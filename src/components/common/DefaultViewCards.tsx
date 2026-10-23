import { useId, type ReactNode } from 'react';
import { css } from '@emotion/react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Icon from './Icon';
import { focusRingCss } from './focusRing';
import { slidingPairColors } from './slidingPairColors';
import { CompactViewArt, FullViewArt } from '../modals/defaultViewArt';
import { useThemeColors } from '../../hooks/useThemeColors';
import { chooseDefaultView } from '../../redux/defaultViewChoice';
import type { AppDispatch, RootState } from '../../redux/store';
import type { DefaultView } from '../../utils/functions/defaultView';
import { ICON, TYPE } from '../../styles/scale';

// KAN-7 §5 step 3, and Settings › Default view since KAN-749: the two views as
// picture cards, each a toggle button that sets Default view. One component, so
// setup and Settings cannot drift apart.
export default function DefaultViewCards() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const defaultView = useSelector(
    (s: RootState) => s.settingsDataState.defaultView
  );
  const pressed = slidingPairColors(COLORS);
  const idPrefix = useId();

  const cardsStyle = css`
    display: flex;
    gap: 14px;
    /* Setup's width at 16px; the full view's pane is wider than the cards need. */
    max-width: 36rem;
  `;
  const viewCardStyle = css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: ${COLORS.TEXT_COLOR};
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
    ${focusRingCss(COLORS)}
  `;
  // D2: the pressed card's outline is 1px TEXT; its label strip is filled below.
  const viewCardPressedStyle = css`
    border-color: ${COLORS.TEXT_COLOR};
  `;
  const viewArtStyle = css`
    display: block;
    padding: 12px;
  `;
  const viewLabelStyle = css`
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 6px 12px;
    /* Holds two lines, so the check's padded box never resizes the pressed strip. */
    min-height: 3rem;
  `;
  const viewLabelTextStyle = css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `;
  const viewCaptionStyle = css`
    font-size: ${TYPE.SECONDARY};
    line-height: 1.35;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  // D2: the language cell's pressed look, on the label strip.
  const viewLabelPressedStyle = css`
    background-color: ${pressed.knob};
    color: ${pressed.labelOnKnob};
  `;
  const viewCaptionPressedStyle = css`
    color: ${pressed.labelOnKnob};
  `;

  const viewCard = (
    view: DefaultView,
    label: string,
    caption: string,
    art: ReactNode
  ) => {
    const isActive = defaultView === view;
    const labelId = `${idPrefix}-${view}-label`;
    const captionId = `${idPrefix}-${view}-caption`;
    return (
      <button
        key={view}
        type="button"
        aria-pressed={isActive}
        aria-labelledby={labelId}
        aria-describedby={captionId}
        css={[viewCardStyle, isActive && viewCardPressedStyle]}
        onClick={() => void dispatch(chooseDefaultView(view))}
      >
        <span aria-hidden="true" css={viewArtStyle}>
          {art}
        </span>
        <span
          data-view-label
          css={[viewLabelStyle, isActive && viewLabelPressedStyle]}
        >
          {isActive && (
            <Icon type="check" size={ICON.SMALL} color={pressed.labelOnKnob} />
          )}
          <span css={viewLabelTextStyle}>
            <span id={labelId}>{label}</span>
            <span
              id={captionId}
              data-view-caption
              css={[viewCaptionStyle, isActive && viewCaptionPressedStyle]}
            >
              {caption}
            </span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div css={cardsStyle}>
      {viewCard(
        'compact',
        t('Compact view'),
        t('Opens under the toolbar icon'),
        <CompactViewArt />
      )}
      {viewCard(
        'full',
        t('Full view'),
        t('Opens in its own tab'),
        <FullViewArt />
      )}
    </div>
  );
}
