import { useEffect, useRef } from 'react';

import { css } from '@emotion/react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Icon from '../common/Icon';
import { useThemeColors } from '../../hooks/useThemeColors';
import { endSavedSessionPeek } from '../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import type { AppDispatch } from '../../redux/store';
import { FOLD_ICON } from './opennow/foldIcon';
import { runPaneMotion } from './paneMotion';
import { handFoldFocusTo, takeFoldFocus } from './foldFocus';
import { railCardStyle } from './railCard';
import RailLabel from './RailLabel';

// KAN-999 (his pick D4). While the saved session is folded, its column keeps
// a card between the list and Currently open, so the list does not read as
// a session with Currently open as its contents. The whole card is one
// button: it shows the saved session, as the panel button it replaces did.
export default function SavedSessionCard() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Folded by Currently open's button, which then went: focus comes here.
  useEffect(() => {
    if (takeFoldFocus('savedCard')) buttonRef.current?.focus();
  }, []);

  const show = () => {
    handFoldFocusTo('openNowFold');
    runPaneMotion(
      () => {
        dispatch(setFoldSavedSessionInTabView(false));
        dispatch(endSavedSessionPeek());
      },
      'saved',
      'unfold'
    );
  };

  // The window's frame runs on across the column's top and bottom; the card
  // sits 8px in from both, as the list card and Currently open's header do.
  const slotStyle = css`
    grid-area: saved-card;
    box-sizing: border-box;
    height: 100vh;
    min-width: 0;
    padding: 8px 8px 8px 0;
    border-top: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-bottom: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;

  const buttonStyle = css`
    ${railCardStyle(COLORS)}
    padding-top: 8px;
    background-color: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    /* No drop lands here: under a drag or a carry it shows no hover, so it never reads as a target. */
    html:not([data-dragging]):not([data-carrying]) &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    &:active {
      background-color: ${COLORS.ICON_ACTIVE_COLOR};
    }
  `;

  const label = t('Show the saved session');
  return (
    <div css={slotStyle} data-saved-card-slot="">
      <button
        ref={buttonRef}
        type="button"
        css={buttonStyle}
        aria-label={label}
        data-tooltip={label}
        data-saved-session-card=""
        data-pane-layer="saved-card"
        onClick={show}
      >
        <Icon type={FOLD_ICON.folded} />
        <RailLabel text={t('Saved session')} />
      </button>
    </div>
  );
}
