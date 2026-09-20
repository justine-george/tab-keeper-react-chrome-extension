import React from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../hooks/useThemeColors';
import { usePopoverList } from '../../hooks/usePopoverList';
import { DURATION, RADIUS } from '../../styles/scale';
import {
  TAB_GROUP_COLOR_HEX,
  sanitizeTabGroupColor,
  type TabGroupColor,
} from '../../utils/functions/tabGroups';

/**
 * Chrome's own picker order, taken from the browser rather than from our
 * TAB_GROUP_COLORS, which is alphabetical for validation. The TypeScript enum
 * in @types/chrome is alphabetical too, so it is no evidence either way -- this
 * order was read off Chrome's actual tab-group colour picker.
 */
const PICKER_ORDER: readonly TabGroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;

// Keyed by colour so the i18n keys are literals the accessibleNames sweep can
// see; a computed `t(color)` would be invisible to it.
const COLOR_LABEL_KEY: Record<TabGroupColor, string> = {
  grey: 'Grey',
  blue: 'Blue',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  pink: 'Pink',
  purple: 'Purple',
  cyan: 'Cyan',
  orange: 'Orange',
};

interface GroupColorPickerProps {
  /** The group's current colour, as stored -- may be unrecognised. */
  color: string;
  /** Names the trigger. Must contain the group's visible title (WCAG 2.5.3). */
  ariaLabel: string;
  onSelect: (color: TabGroupColor) => void;
  /**
   * Paints the band and nothing else: no name, no focus, no picker.
   *
   * The search panel withholds every mutating group action (KAN-62), and a
   * control that cannot act must not be focusable. Rendering the plain band
   * from here rather than at the call site keeps the 3px/6px arithmetic in one
   * place -- a second copy is exactly how the two drift apart.
   */
  decorative?: boolean;
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
  decorative = false,
}) => {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
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
    close,
    wrapperRef,
    triggerRef,
    registerItem,
    handleKeyDown,
  } = usePopoverList({
    count: PICKER_ORDER.length,
    axis: 'horizontal',
  });

  if (decorative)
    return <div aria-hidden="true" data-group-color-strip css={bandStyle} />;

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
          title={ariaLabel}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!isOpen);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(!isOpen);
            }
          }}
          css={css`
            ${bandStyle};
            cursor: pointer;
            /* Named properties, never the all keyword. */
            /* transform joins the list for KAN-165: the strip travels
               with its group's tabs and must glide as they do. */
            transition-property: width, flex-basis, margin-right, transform;
            transition-duration: ${DURATION.COLOR};
            transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
            /* 11px + 5px, still 16px. Widening without shrinking the margin
               pushes every row in the group sideways on hover.

               KAN-233: and held while the picker is OPEN. The widen was on
               :hover alone, so the one thing a click here is for -- moving to
               a swatch -- took the pointer off the strip and shrank it back
               while its own menu was still up. The KAN-217 rule for menu
               triggers, applied to this one: the control that owns an open
               menu holds its active state until the menu closes. */
            &:hover,
            &:focus-visible,
            &[aria-expanded='true'] {
              flex-basis: 11px;
              width: 11px;
              margin-right: 5px;
            }

            /* KAN-231. The click target, 24px wide: 8px left of the paint,
               the 7px paint, and the 9px margin. Left, into the window's
               container padding that no row owns, rather than right into
               the favicons -- measured, a target reaching right from the
               paint's edge covers 4px of every favicon in the group even at
               this footprint, and 11px at the old one.

               Invisible and out of flow, so it moves nothing; a pointer on it
               resolves to this element, which is what makes it a target.
               Only on the interactive strip: the decorative one (search
               results) is aria-hidden and has nothing to be a target for.

               A ::after, NOT a ::before. tab-group-join-preview.spec reads
               the strip's ::before as its paint layer and falls back when
               there is none; a ::before here would become the layer it
               measures. Measured: with top and bottom both 0 the numbers
               happen to agree today, so that spec stays green -- which is
               exactly why the coupling is dangerous rather than loud. The
               hit area stays a ::after, and e2e/group-strip-target.spec
               pins that the ::before still computes to none. */
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
            border: 1px solid ${COLORS.BORDER_COLOR};
            /* Square and flat, like Toast and OverflowMenu. */
            border-radius: ${RADIUS.SQUARE};
          `}
        >
          {PICKER_ORDER.map((swatch, index) => (
            <button
              key={swatch}
              type="button"
              role="menuitemradio"
              aria-checked={swatch === current}
              aria-label={t(COLOR_LABEL_KEY[swatch])}
              title={t(COLOR_LABEL_KEY[swatch])}
              ref={registerItem(index)}
              onClick={(e) => {
                e.stopPropagation();
                // close(TRUE), unlike OverflowMenu. Its items can unmount
                // their own trigger -- Delete group removes the row -- so it
                // cannot promise focus a place to land. Recolouring always
                // leaves the band standing, and measured in Chrome, closing
                // without returning focus drops a keyboard user at <body>.
                close(true);
                onSelect(swatch);
              }}
              css={css`
                width: 18px;
                height: 18px;
                padding: 0;
                cursor: pointer;
                /* Circles, as Chrome draws them. */
                border-radius: ${RADIUS.CIRCLE};
                background-color: ${TAB_GROUP_COLOR_HEX[swatch]};
                /* A hairline on every swatch, so a pale fill still reads as a
                   circle rather than a smudge. Fixed, not a token: it sits on
                   the pastel, which does not vary by theme. */
                border: 1px solid rgba(0, 0, 0, 0.1);
                box-sizing: border-box;
                /* The active marker is an OFFSET ring, not a thicker border.
                   themeSwatchMarker in Settings thickens the border, and
                   LABEL_L3_COLOR was measured for that job against the PAGE.
                   Here the border sits on a Chrome pastel instead, and the
                   same token measures 1.10-2.00:1 against those nine fills on
                   the default Light theme -- the purple swatch's marker is
                   invisible. The gap puts the ring back on the menu surface,
                   where LABEL_L3 is the measured 2.56-4.03:1 (KAN-95).

                   box-shadow, so the marker costs no layout: the swatch keeps
                   its 18px and the row never reflows as selection moves. 4px
                   of ring into the 6px gap leaves 2px of clearance, so it does
                   not touch its neighbours -- the reason an earlier ring in
                   Settings was rejected. */
                box-shadow: ${swatch === current
                  ? `0 0 0 2px ${COLORS.PRIMARY_COLOR}, 0 0 0 4px ${COLORS.LABEL_L3_COLOR}`
                  : 'none'};
              `}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default GroupColorPicker;
