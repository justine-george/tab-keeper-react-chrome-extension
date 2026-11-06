import React from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../hooks/useThemeColors';
import { RADIUS } from '../../styles/scale';
import {
  TAB_GROUP_COLOR_HEX,
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

export const SWATCH_COUNT = PICKER_ORDER.length;

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

// KAN-936. The nine swatches, for the strip's picker and the group title menus; the caller lays them out and says what a pick does.
const GroupColorSwatches: React.FC<{
  current: TabGroupColor;
  registerItem: (index: number) => (el: HTMLElement | null) => void;
  onPick: (color: TabGroupColor) => void;
}> = ({ current, registerItem, onPick }) => {
  const COLORS = useThemeColors();
  const { t } = useTranslation();

  return PICKER_ORDER.map((swatch, index) => (
    <button
      key={swatch}
      type="button"
      role="menuitemradio"
      aria-checked={swatch === current}
      aria-label={t(COLOR_LABEL_KEY[swatch])}
      data-tooltip={t(COLOR_LABEL_KEY[swatch])}
      ref={registerItem(index)}
      onClick={(e) => {
        e.stopPropagation();
        onPick(swatch);
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
        box-shadow: ${
          swatch === current
            ? `0 0 0 2px ${COLORS.PRIMARY_COLOR}, 0 0 0 4px ${COLORS.LABEL_L3_COLOR}`
            : 'none'
        };
      `}
    />
  ));
};

export default GroupColorSwatches;
