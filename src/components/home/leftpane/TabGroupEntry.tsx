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

/**
 * How far a row's action icon sits inside the row, per side, in CSS px.
 *
 * Stated here rather than left to fall out of the icon's own padding (KAN-101).
 * The icon used to be sized by its content and centred in the row, which left
 * ~0.27px over -- a number nobody chose, below one device pixel, and therefore
 * rounded to a 0px gap on some rows and 1px on others. Now the icon's height is
 * derived FROM the row and this is the only thing standing between them.
 *
 * `e2e/row-action-inset.spec.ts` asserts this value, and asserts it survives
 * the row changing height.
 */
const ACTION_ICON_INSET = 2;

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
    /* Both edges pinned to the row, NOT centred with a percentage and a
       transform (KAN-103).

       top: 50% is a layout value and is quantised to 1/64px; the matching
       translateY(-50%) is a float computed from the element's own height.
       On a row whose height makes those disagree -- which is most of them,
       since the height is font-metric derived and never round -- the block
       ended up 0.0036px above the row. Measured on 11 of 17 sampled row
       heights.

       That is far below one device pixel and would not matter, except the mask
       is opaque and the row separator is the very next thing beneath it. At
       dpr 2.2 the block's bottom edge landed on 573.93 and the separator began
       at 573.94 -- the same device pixel -- so the mask antialiased over the
       separator and the line visibly broke where the strip began. Reported with
       a zoomed screenshot showing exactly that.

       Pinning both edges makes the box the row's box, with no arithmetic in
       between and nothing to quantise. Same lesson as ACTION_ICON_INSET above,
       one level out: derive the box, do not approximate it. */
    top: 0;
    bottom: 0;
    right: 0;
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    /* stretch, NOT center (KAN-101). Centring sized each icon by its own
       content and left the difference between that and the row as a remainder
       -- 0.27px, which no one chose and which is below one device pixel, so it
       rendered as a gap on some rows and no gap on others. Stretching makes the
       icon's height derive from the row, and ACTION_ICON_INSET below is then
       the only thing between them. */
    align-items: stretch;
    /* THE MASK LIVES HERE, ON ONE ELEMENT (KAN-98), AND IT NEVER FADES
       (KAN-100).

       This block is absolutely positioned over the title, so it has to be
       opaque or the text reads through the controls (KAN-92). That mask used
       to be painted by the three Icons individually, via a backgroundColor
       prop carrying the ROW's state colour, which made one property carry both
       the row's state and each icon's own gesture (KAN-98).

       It then used to FADE, via this block's opacity, over a row whose fill was
       still travelling. That cannot be made to agree by tuning timings, and the
       algebra says why. An opaque layer at alpha a over the row's fill L shows
       a*H + (1-a)*L, which equals L only when a is 0 or L has already reached
       H. So matching the two durations does not help -- it leaves f(1-f)(P-H),
       which peaks at a quarter of the full colour distance halfway through.
       Measured before this change: the strip arrived at 100ms and the row at
       183ms, 18 disagreeing frames of 64 with a hard vertical edge between them.

       The only shapes that agree are "the mask is invisible" and "the row has
       already arrived". So the mask is declared with NO transition and the fill
       below has none either: both land in the same frame, in both directions.

       What still eases is the icons, below. They are glyphs sitting on a
       background that is already uniform, so fading them cannot produce an
       edge -- which is the whole difference between them and this mask. */
    background-color: transparent;

    /* Hidden by default. What reveals them lives on the CONTAINER, not here --
       see the engagement comment on containerStyle for why the two cannot be
       allowed to drift apart. */
    & > * {
      opacity: 0;
      transition: opacity 0.1s ease-out;
      margin: ${ACTION_ICON_INSET}px 0;
    }
  `;

  // What "engaged" paints. Declared once and used by both rules below, so the
  // hover and keyboard branches cannot drift apart -- which is the whole point
  // of KAN-92 and the reason they are not written out twice.
  const engagedStyle = `
    ${!isSelected ? `box-shadow: inset 0 0 0 100vw ${COLORS.HOVER_COLOR};` : ''}
    [data-row-actions] {
      background-color: ${
        isSelected ? COLORS.SELECTION_COLOR : COLORS.HOVER_COLOR
      };
    }
    [data-row-actions] > * {
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
       
       The shadow is declared transparent up front rather than left as 'none'
       so that the row's fill is always readable as a colour, in every state,
       by anything measuring it. The spread must exceed half the row's largest
       dimension to fill it, and 100vw is comfortably past that at any popup
       size. */
    box-shadow: inset 0 0 0 100vw transparent;
    /* THE FILL DOES NOT EASE, IN EITHER DIRECTION (KAN-100).

       KAN-82 established that selecting is a fact and must land in one frame,
       while hovering is a gesture and MAY ease -- and for a while it did, over
       0.2s. KAN-97 then had to remove that ease while selected, because the
       shadow paints on top of the background and eased out over a freshly
       selected row.

       What was left still could not work. The action strip is an opaque mask
       over the title, and a mask is only invisible when it is fully
       transparent or when the row underneath has already arrived at the
       colour the mask is painted. While the fill travelled, the strip -- which
       is at its destination colour from frame zero -- ran ahead of it, and the
       row filled in two halves with a hard vertical edge between them.

       No timing fixes that. Equalising the two durations still leaves
       f(1-f)(P-H) between the halves, a quarter of the full colour distance at
       the midpoint. The fill has to arrive in one frame so that there is never
       an intermediate state for the mask to disagree with.

       So engagement is now a fact too, and lands like one. What remains a
       gesture, and still eases, is the icons appearing -- see rightStyle. */

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
