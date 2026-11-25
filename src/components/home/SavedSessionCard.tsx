import { css } from '@emotion/react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import Icon from '../common/Icon';
import { useThemeColors } from '../../hooks/useThemeColors';
import { endSavedSessionPeek } from '../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import type { AppDispatch, RootState } from '../../redux/store';
import {
  formatNameWithCount,
  formatTabCount,
} from '../../utils/functions/local';
import { SAVED_CARD_ICON } from './opennow/foldIcon';
import { runPaneMotion } from './paneMotion';
import { handFoldFocusTo } from './foldFocus';
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
    /* KAN-1003 (his pick B): the glyph on the top row's line, the pane title's. */
    padding-top: 0;
    background-color: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    /* No drop lands here: under a drag or a carry it shows no hover, so it never reads as a target. */
    /* His pick H2: a session row's hover and press fills, card-wide, and a darker outline. */
    html:not([data-dragging]):not([data-carrying]) &:hover {
      background-color: ${COLORS.HOVER_COLOR};
      border-color: ${COLORS.LABEL_L2_COLOR};
    }
    /* As specific as the hover, and after it, so a press shows. */
    html:not([data-dragging]):not([data-carrying]) &:active {
      background-color: ${COLORS.ACTIVE_COLOR};
    }
  `;

  const label = t('Show the saved session');
  // His pick W1: the tooltip names what the card holds, "Trip, 2 Tabs", as
  // the rail's does; the name stays the action.
  const session = useSelector((s: RootState) => {
    const { tabGroups, selectedTabGroupId } = s.tabContainerDataState;
    return tabGroups.find((g) => g.tabGroupId === selectedTabGroupId) ?? null;
  });
  const tip =
    session === null
      ? label
      : formatNameWithCount(
          session.title,
          formatTabCount(session.tabCount, t),
          t
        );
  return (
    <div css={slotStyle} data-saved-card-slot="">
      <button
        type="button"
        css={buttonStyle}
        aria-label={label}
        data-tooltip={tip}
        data-saved-session-card=""
        data-pane-layer="saved-card"
        onClick={show}
      >
        <Icon type={SAVED_CARD_ICON} />
        <RailLabel text={t('Saved session')} />
      </button>
    </div>
  );
}
