import React from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../hooks/useThemeColors';
import { usePopoverList } from '../../hooks/usePopoverList';
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

  // 9px of horizontal footprint, always. The band grows into its own margin so
  // the widen cannot reflow the rows beside it.
  const bandStyle = css`
    flex: 0 0 3px;
    width: 3px;
    margin-right: 6px;
    align-self: stretch;
    background-color: ${TAB_GROUP_COLOR_HEX[current]};

    /* KAN-164. While a tab is dragged, the group it would join opens up: the
       strip widens in the group's OWN colour rather than the app growing a
       ring in a colour it uses nowhere else.

       More emphatic than the hover widen below (6px), so the two states stay
       distinguishable, and still 9px of footprint -- it takes the whole margin
       rather than any of the row beside it, so marking a group reflows
       nothing.

       Width, not hue, is what carries this: it survives being unable to tell
       the wash from the page. */
    [data-drop-target] & {
      flex-basis: 9px;
      width: 9px;
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
            transition-duration: 150ms;
            transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
            /* 6px + 3px, still 9px. Widening without shrinking the margin
               pushes every row in the group sideways on hover. */
            &:hover,
            &:focus-visible {
              flex-basis: 6px;
              width: 6px;
              margin-right: 3px;
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
            border-radius: 0px;
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
                border-radius: 50%;
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
