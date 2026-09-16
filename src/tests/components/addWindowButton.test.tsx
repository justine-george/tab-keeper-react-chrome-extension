import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';

// NOTE on what is deliberately NOT tested here. A first draft asserted the
// source no longer contains '#e3e6e9'. That test was wrong twice over: it
// forbade the string anywhere in the file, so it failed on the comment
// EXPLAINING the removal, and it inspected source text rather than behaviour --
// which the fill assertion below already covers, since the literal was an
// unreachable fallback that could never have rendered.
//
// The other thing absent here is geometry. Justine's constraint was that
// nothing else moves, and jsdom reports every box as 0x0, so that claim can
// only be made in a browser: e2e/add-window-geometry.spec.ts measures it.

// KAN-213. "Add current window" did not read as a button.
//
// It carried `background-color: HOVER_COLOR` as a RESTING fill, which measures
// 1.047:1 against the SECONDARY_COLOR header it sits on -- below the 1.20 that
// dividerContrast.test.ts treats as the floor for "can still be seen". So it
// was neither a chip nor flat text, and it wore the one token in the app that
// means "a row is under your pointer" while the pointer was elsewhere.
//
// It also set `border: none`, overriding the border every other Button has, and
// so hand-rolled a fifth look beside the three named variants.
//
// The fix is almost entirely DELETION: `quiet` is already Button's default, so
// removing the overrides lets the button be what it always was.
//
// The label is asserted through its accessible name rather than its text,
// because `en` re-maps its own key -- t('Add window') renders as "Add current
// window" (i18n keys are not display strings).
const ADD = 'Add current window';

const renderHeader = () =>
  renderWithProviders(<HeroContainerRight />, {
    seedStore: (store) => {
      store.dispatch(
        replaceState(
          buildContainer([buildSession({ tabGroupId: 'session-1' })])
        )
      );
      store.dispatch(selectTabContainer('session-1'));
    },
  });

const addButton = () => screen.getByRole('button', { name: ADD });

describe('the add-window button reads as a button (KAN-213)', () => {
  test('is bordered, like every other Button in the app', async () => {
    await renderHeader();

    const style = getComputedStyle(addButton());
    expect(style.borderTopStyle).toBe('solid');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopColor.toLowerCase()).toContain('rgb');
  });

  // The fill is the point of the defect, and it moved twice.
  //
  // First it was HOVER_COLOR -- the row-hover token, spent on a resting state.
  // Removing the override handed the button `quiet`'s rest fill, PRIMARY_COLOR,
  // which is documented as "the page's own ground". But this button is not on
  // the page's ground: it sits on a CARD, which paints SECONDARY_COLOR. So the
  // fill came out 1.104:1 LIGHTER than the surface behind it, ringed by a
  // 6.83:1 border -- a lighter plate with a hard dark edge on a darker ground,
  // which is how a raised bevel is drawn. In the dark themes the sign flipped
  // (fill 1.136:1 darker than its card) and it read as inset instead.
  //
  // So it paints no fill at all, and takes whatever ground it is put on. The
  // border alone says "button". e2e/add-window-button.spec.ts measures the
  // result -- that the button and its card are the same colour, in both a light
  // theme and a dark one -- which is the claim this can only approximate.
  test('paints no fill of its own', async () => {
    await renderHeader();

    const fill = getComputedStyle(addButton()).backgroundColor;
    expect(fill).toBe('rgba(0, 0, 0, 0)');
    expect(fill).not.toBe(hex(LIGHT_THEME.HOVER_COLOR)); // the original defect
    expect(fill).not.toBe(hex(LIGHT_THEME.PRIMARY_COLOR)); // the plate
  });

  // CONTROL for the two above: a fill that merely CHANGED would satisfy them
  // if it landed on another near-invisible value. This states the thing the
  // user reported -- that the control must separate from the header behind it.
  test('separates from the header it sits on', async () => {
    await renderHeader();

    const border = getComputedStyle(addButton()).borderTopColor;
    // BORDER_COLOR on SECONDARY_COLOR measures 6.83:1; the old borderless fill
    // measured 1.047:1 against the same ground.
    expect(border).toBe(hex(LIGHT_THEME.BORDER_COLOR));
  });
});

// jsdom reports colours as `rgb(r, g, b)`; the theme stores hex.
function hex(value: string): string {
  const v = value.replace('#', '');
  const n = parseInt(v, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
