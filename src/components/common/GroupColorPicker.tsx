import React from 'react';

import { css } from '@emotion/react';
import { useSelector } from 'react-redux';

import { useThemeColors } from '../../hooks/useThemeColors';
import { usePopoverList } from '../../hooks/usePopoverList';
import { RADIUS } from '../../styles/scale';
import GroupColorSwatches, { SWATCH_COUNT } from './GroupColorSwatches';
import { GROUP_STRIP_TRANSITION } from './groupColorStrip';
import {
  TAB_GROUP_COLOR_HEX,
  sanitizeTabGroupColor,
  type TabGroupColor,
} from '../../utils/functions/tabGroups';
import { whileKeyNav } from './focusRing';
import {
  isMenuKey,
  isMovingRows,
  isTouch,
  useMacCtrlClickGuard,
} from './rowMenu/useRowContextMenu';
import { selectRunHere } from '../../redux/firstRun';
import { corners } from '../../styles/corners';

interface GroupColorPickerProps {
  /** The group's current colour, as stored -- may be unrecognised. */
  color: string;
  /** Names the trigger. Must contain the group's visible title (WCAG 2.5.3). */
  ariaLabel: string;
  onSelect: (color: TabGroupColor) => void;
}

/**
 * The coloured band beside a Chrome tab group, made interactive.
 *
 * The band was `aria-hidden` and purely decorative, because `role="group"`
 * already carried the grouping. That was right while it only painted; a
 * control has to be named, so it announces what it CHANGES rather than
 * repeating the group's name.
 *
 * It widens on hover by absorbing its own margin -- 3px band + 6px gap becomes
 * 6px + 3px -- so the footprint stays 9px and no tab row shifts. Growing it
 * naively pushes every row in the group sideways.
 */
const GroupColorPicker: React.FC<GroupColorPickerProps> = ({
  color,
  ariaLabel,
  onSelect,
}) => {
  const COLORS = useThemeColors();
  const current = sanitizeTabGroupColor(color);

  // 16px of horizontal footprint, always. The band grows into its own margin so
  // the widen cannot reflow the rows beside it.
  //
  // KAN-231. It was 3px in a 9px footprint, and the strip is a BUTTON -- it
  // opens this picker -- so 3px was the whole click target. Three widths were
  // rendered and measured before this one: a 24px target that starts at the
  // strip's left edge and reaches right lands 11px into every favicon when the
  // footprint is 9px (the favicon sat at strip + 13), and 4px when it is 16px.
  // Reaching LEFT instead, into the window's container padding, lands on
  // nothing -- see the hit area on the interactive strip below. The 16px
  // footprint is what makes that add up to 24 without touching a row:
  // 8 (left) + 7 (paint) + 9 (margin).
  //
  // The cost is that grouped content indents 7px further than loose tabs
  // (measured 444.5 -> 451.5 at 790px), which reads as membership.
  const bandStyle = css`
    flex: 0 0 7px;
    width: 7px;
    margin-right: 9px;
    align-self: stretch;
    background-color: ${TAB_GROUP_COLOR_HEX[current]};
    ${corners(RADIUS.CONTROL)}

    /* KAN-171. The strip changes LENGTH while a tab is dragged into or out of
       this group -- one row's worth -- and it used to be moved by a transform,
       which can only change where a fixed-length box sits. Measured: dragging
       a tab into a group's head, the strip read 64..192, moved up 34 and still
       128 long, falling 34px short of the band's bottom at 226.

       MARGINS ON A STRETCHED ITEM, which is the one way to resize this without
       reflowing anything. The item's MARGIN box is what fills the flex line, so
       a negative margin-top makes the border box that much taller and starts it
       that much higher, while the line -- and therefore the band, and therefore
       every row below it -- is untouched. A height would have done the opposite
       and grown the band.

       The two numbers are the frame's previewed extent, published on the band
       by GroupFrameFollower and inherited from it. Both default to zero, so
       outside a drag, and outside a band, this is the plain strip it was. */
    margin-top: var(--frame-top, 0px);
    margin-bottom: calc(-1 * var(--frame-bottom, 0px));

    /* KAN-164. While a tab is dragged, the group it would join opens up: the
       strip widens in the group's OWN colour rather than the app growing a
       ring in a colour it uses nowhere else.

       More emphatic than the hover widen below (11px), so the two states stay
       distinguishable, and still 16px of footprint -- it takes the whole
       margin rather than any of the row beside it, so marking a group reflows
       nothing.

       Width, not hue, is what carries this: it survives being unable to tell
       the wash from the page. */
    [data-drop-target] & {
      flex-basis: 16px;
      width: 16px;
      margin-right: 0;
    }
  `;

  const {
    isOpen,
    setOpen,
    openByPointer,
    close,
    wrapperRef,
    triggerRef,
    registerItem,
    handleKeyDown,
  } = usePopoverList({
    count: SWATCH_COUNT,
    axis: 'horizontal',
  });
  const tourRuns = useSelector(selectRunHere) !== null;
  const macGuard = useMacCtrlClickGuard();

  return (
    <div
      ref={wrapperRef}
      css={css`
        position: relative;
        display: flex;
        align-self: stretch;
      `}
    >
      <div
        ref={triggerRef}
        css={css`
          display: flex;
          align-self: stretch;
        `}
      >
        <div
          role="button"
          tabIndex={0}
          data-group-color-strip
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-tooltip={ariaLabel}
          onMouseDownCapture={macGuard.onMouseDownCapture}
          onClickCapture={macGuard.onClickCapture}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!isOpen);
          }}
          // KAN-708. A right-click opens it as a click does and never toggles it shut; the tour and a drag or carry open nothing.
          onContextMenu={(e) => {
            if (isTouch(e)) return;
            e.preventDefault();
            e.stopPropagation();
            if (!tourRuns && !isMovingRows() && !isOpen) openByPointer();
          }}
          onKeyDown={(e) => {
            if (isMenuKey(e)) {
              e.preventDefault();
              e.stopPropagation();
              if (!tourRuns && !isMovingRows() && !isOpen) setOpen(true);
              return;
            }
            macGuard.forget();
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(!isOpen);
            }
          }}
          css={css`
            ${bandStyle};
            cursor: pointer;
            /* transform is in it for KAN-165: the strip travels with its
               group's tabs and must glide as they do. Shared with Open
               now's strip (KAN-328). */
            ${GROUP_STRIP_TRANSITION};
            /* 11px + 5px, still 16px. Widening without shrinking the margin
               pushes every row in the group sideways on hover.

               KAN-233: and held while the picker is OPEN. The widen was on
               :hover alone, so the one thing a click here is for -- moving to
               a swatch -- took the pointer off the strip and shrank it back
               while its own menu was still up. The KAN-217 rule for menu
               triggers, applied to this one: the control that owns an open
               menu holds its active state until the menu closes.

               KAN-706: not during a drag, where the strip is no control to
               click and this rule, weighing the same as the drop target's
               and coming later, shrank it from 16px to 11. */
            html:not([data-dragging]) &:hover,
            ${whileKeyNav('&:focus-visible')}, &[aria-expanded='true'] {
              flex-basis: 11px;
              width: 11px;
              margin-right: 5px;
            }
            /* KAN-405 round 2 B: too narrow for the ring inside, so 2px outside. */
            ${whileKeyNav('&:focus-visible')} {
              outline: 2px solid ${COLORS.TEXT_COLOR};
              outline-offset: 2px;
            }

            /* KAN-231. The click target, 24px wide: 8px left of the paint,
               the 7px paint, and the 9px margin. Left, into the window's
               container padding that no row owns, rather than right into
               the favicons -- measured, a target reaching right from the
               paint's edge covers 4px of every favicon in the group even at
               this footprint, and 11px at the old one.

               Invisible and out of flow, so it moves nothing; a pointer on it
               resolves to this element, which is what makes it a target.

               A ::after, NOT a ::before. tab-group-join-preview.spec reads
               the strip's ::before as its paint layer and falls back when
               there is none; a ::before here would become the layer it
               measures. Measured: with top and bottom both 0 the numbers
               happen to agree today, so that spec stays green -- which is
               exactly why the coupling is dangerous rather than loud. The
               hit area stays a ::after, and tab-group-join-preview.spec's
               framePreview asserts the ::before still computes to none. */
            position: relative;
            &::after {
              content: '';
              position: absolute;
              top: 0;
              bottom: 0;
              left: -8px;
              width: 24px;
            }
          `}
        />
      </div>
      {isOpen && (
        <div
          role="menu"
          aria-orientation="horizontal"
          onKeyDown={handleKeyDown}
          css={css`
            position: absolute;
            /* NOT top: 100%. The band stretches the full height of the group,
               so 100% drops the picker below the LAST tab row -- a five-tab
               group put it five rows away from the band the user clicked.
               32px is the group header strip's height, so the picker hangs
               just under the row that names the group, wherever along the band
               the click landed. */
            top: 32px;
            left: 0;
            z-index: 1000;
            display: flex;
            gap: 6px;
            padding: 8px;
            background-color: ${COLORS.PRIMARY_COLOR};
            border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
            /* A menu, like MenuPanel (KAN-721). */
            ${corners(RADIUS.PANEL)}
          `}
        >
          <GroupColorSwatches
            current={current}
            registerItem={registerItem}
            onPick={(swatch) => {
              // close(TRUE), unlike OverflowMenu. Its items can unmount
              // their own trigger -- Delete group removes the row -- so it
              // cannot promise focus a place to land. Recolouring always
              // leaves the band standing, and measured in Chrome, closing
              // without returning focus drops a keyboard user at <body>.
              close(true);
              onSelect(swatch);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default GroupColorPicker;
