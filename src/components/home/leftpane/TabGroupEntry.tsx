import React, { MouseEventHandler } from 'react';

import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import ClickableRow from '../../common/ClickableRow';
import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { RootState } from '../../../redux/store';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  formatGroupCounts,
  getPrettyDate,
  isSearchActive,
} from '../../../utils/functions/local';
import { tabContainerData } from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

interface TabGroupEntryProps {
  tabGroupData: tabContainerData;
  /**
   * Takes no event. It was typed MouseEventHandler while its only caller
   * passed a zero-argument arrow, which is what let the old keyboard path get
   * away with `onTabGroupClick(e as any)` -- handing a KeyboardEvent to
   * something the compiler believed was a MouseEventHandler.
   */
  onTabGroupClick: () => void;
  onOpenAllClick: MouseEventHandler;
  onFocusClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const TabGroupEntry: React.FC<TabGroupEntryProps> = ({
  tabGroupData,
  onTabGroupClick,
  onOpenAllClick,
  onFocusClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  // Needed as well as isSearchPanel: the row's counts are narrowed only while
  // the box has text in it, so the panel being open is not on its own enough
  // to call them matches.
  const searchInputText = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );

  const { title, createdTime, createdAt, windowCount, tabCount, isSelected } =
    tabGroupData;

  // A plain string, not css``, because it is handed to ClickableRow's `style`
  // prop, which composes it into the button's own reset.
  const leftStyle = `
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
  `;

  const rightStyle = css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    display: flex;
    flex-direction: row;
    height: 100%;
    justify-content: flex-start;
    align-items: center;
    /* Hidden by default. What reveals it lives on the CONTAINER, not here --
       see the engagement comment on containerStyle for why the two cannot be
       allowed to drift apart. */
    opacity: 0;
    transition: opacity 0.1s ease-out;
  `;

  // What "engaged" paints. Declared once and used by both rules below, so the
  // hover and keyboard branches cannot drift apart -- which is the whole point
  // of KAN-92 and the reason they are not written out twice.
  const engagedStyle = `
    ${!isSelected ? `box-shadow: inset 0 0 0 100vw ${COLORS.HOVER_COLOR};` : ''}
    [data-row-actions] {
      opacity: 1;
    }
  `;

  const containerStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ${FONT_FAMILY};
    cursor: pointer;
    /* Hover and selection are deliberately on DIFFERENT properties.
       
       A CSS transition is declared on a property, not on a reason, so while
       both wrote background-color the 0.2s ease meant for hover also animated
       selection. Creating a session unshifts it and selects it, which left the
       previously selected row -- now row TWO -- fading its highlight out over
       200ms while being pushed down a slot. Measured every frame in a live
       popup: 24 intermediate frames of rgba(59,59,59,a). That reads as the
       second row flashing (KAN-82).
       
       Selecting is a fact and must land in one frame; hovering is a gesture
       and may ease. background-color carries the fact, an inset shadow carries
       the gesture, and only the shadow transitions.
       
       The shadow is declared transparent up front rather than left as 'none':
       interpolating from 'none' animates the SPREAD from 0, which sweeps a
       rectangle inward instead of fading. Declared this way only the colour
       changes. The spread must exceed half the row's largest dimension to
       fill it, and 100vw is comfortably past that at any popup size. */
    box-shadow: inset 0 0 0 100vw transparent;
    /* The shadow eases only while the row is UNSELECTED (KAN-97).

       KAN-82 established that selecting is a fact and must land in one frame,
       while hovering is a gesture and may ease -- and it fixed the row LOSING
       selection. The row GAINING it was never checked, and had the same defect
       through the other property.

       background-color lands instantly, correctly. But the inset shadow paints
       ON TOP of the background, and on click the fill's declaration disappears
       (it is guarded on !isSelected), so it transitioned from HOVER_COLOR to
       transparent across 0.2s. The newly selected row was painted the light
       hover colour and darkened into the selection colour over 22 measured
       frames. That is what read as a flash.

       Removing the transition while selected makes the shadow snap as the
       selection colour lands, so the two agree in the same frame. Hovering an
       unselected row still eases, which is the control KAN-82's spec asserts
       and which must keep passing. */
    transition: ${isSelected ? 'none' : 'box-shadow 0.2s'};

    /* ENGAGEMENT IS ONE STATE, SO IT GETS ONE CONDITION (KAN-92).

       A row engaged with does two things: it reveals its Open/Switch/Delete
       block, and it fills. Those used to run off different triggers -- the
       reveal off a React isHovered set by onMouseEnter/onMouseLeave, or the
       block's own :focus-within; the fill off this container's :hover alone.
       Two triggers for one state will eventually disagree, and both ways of
       making them disagree were reachable:

         - Tab to an action. The block's :focus-within revealed it while
           :hover stayed false, so the row did not fill.
         - Leave the window abruptly, which is exactly what pressing a
           screenshot hotkey does. onMouseLeave never fires, so the React
           state stayed true while :hover dropped in the same frame.

       Either way the action Icons -- which carry an opaque HOVER_COLOR
       background, load-bearing because the block is positioned over the title
       and has to mask it -- became a hover-coloured strip glued to the right
       of a row with no fill, with a hard vertical edge through the title.

       So the reveal is stated HERE, next to the fill, sharing one condition.
       They can no longer drift, because there is nothing left to drift from:
       the React state is gone.

       That condition is :has(:focus-visible), NOT :focus-within (KAN-94).
       :focus-within matches any focus, including the focus a mouse click
       leaves behind -- so clicking a row engaged it indefinitely, and since a
       click draws no focus ring there was nothing on screen to explain why.
       It read as a stuck hover, and it shipped that way for half an hour.

       :focus-visible is the distinction that was wanted all along: the
       browser already decides whether a given focus deserves a visible
       indicator, and it answers no for a click and yes for a Tab. So the
       intent -- a row you have TABBED to should show what you can do with it
       -- is now stated by the selector rather than only by this comment.

       TWO RULES, not one selector list. An invalid selector anywhere in a
       comma-separated list invalidates the whole rule, so a combined
       "&:hover, &:has(...)" would take hover down with it on any engine
       without :has() (Chrome 105+). Split, :hover stands on its own and only
       the keyboard affordance degrades. The declarations are shared rather
       than typed twice, so the two rules cannot drift either.

       (No backticks anywhere in this comment: it lives inside a css template
       literal, and one would end the literal mid-comment.) */
    &:hover {
      ${engagedStyle}
    }
    &:has(:focus-visible) {
      ${engagedStyle}
    }
    background-color: ${isSelected && COLORS.SELECTION_COLOR};
  `;

  // The row's primary action lives on the inner ClickableRow, not on this
  // container, and that placement is the whole fix for KAN-64. The container
  // was a role-less div carrying tabIndex={0} and onClick: focusable, but
  // exposed as `generic`, where ARIA prohibits naming -- so it reached the
  // tab order as an anonymous stop that announced nothing.
  //
  // It cannot simply become a <button> or gain role="button" either, because
  // the Open/Switch/Delete controls are inside it and nesting buttons is
  // invalid HTML. Moving the action onto the left column instead makes them
  // siblings. `leftStyle` is width: 100%, so the clickable area is unchanged;
  // the action block is absolutely positioned on top of it.
  return (
    <div css={containerStyle}>
      <ClickableRow
        ariaLabel={title}
        onClick={onTabGroupClick}
        style={leftStyle}
      >
        <NormalLabel
          style="max-width: 100%;"
          value={title}
          color={COLORS.TEXT_COLOR}
          size="0.95rem;"
          tooltipText={title}
        />
        <NormalLabel
          value={formatGroupCounts(
            windowCount,
            tabCount,
            isSearchActive(isSearchPanel, searchInputText),
            t
          )}
          color={COLORS.LABEL_L1_COLOR}
          size="0.7rem"
          style="margin-top: 2px;"
        />
        <div
          css={css`
            color: ${COLORS.LABEL_L2_COLOR};
            font-size: 0.635rem;
            margin-top: 5px;
          `}
        >
          {/* createdAt is the instant; createdTime is a local wall clock with
              no offset, kept only for sessions saved before createdAt.
              i18n.language, not a constant: the date is formatted in the
              user's own locale (KAN-85). */}
          {getPrettyDate(createdAt ?? createdTime, i18n.language)}
        </div>
      </ClickableRow>
      {!isSearchPanel && (
        <div data-row-actions css={rightStyle}>
          <Icon
            tooltipText={t('Open session')}
            text={t('Open')}
            ariaLabel={t('Open')}
            type="reopen_window"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onOpenAllClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
          <Icon
            tooltipText={t('Switch to session')}
            text={t('Switch')}
            ariaLabel={t('Switch')}
            type="filter_center_focus"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onFocusClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
          <Icon
            tooltipText={t('Delete session')}
            text={t('Delete')}
            ariaLabel={t('Delete')}
            type="delete"
            backgroundColor={
              isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
            }
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(e);
            }}
            style="padding: 14px 10px; width: 57px;"
          />
        </div>
      )}
    </div>
  );
};

export default TabGroupEntry;
