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
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';

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
  // The glyph says which KIND of action this is, and a bare plus said the wrong
  // one. The left pane already carries two plus-bearing controls -- `add_box`
  // ("Save current window as a session") and `library_add` ("Save every open
  // window as a session") -- and both CREATE a session. This one APPENDS to the
  // session already on screen, which is the odd one out, yet it wore the most
  // generic mark of the three.
  //
  // Both of those glyphs are a plus inside a CONTAINER, which is what makes them
  // read as siblings -- correctly, since they differ only in how many windows
  // they take. `playlist_add` has no container: a plus against horizontal lines,
  // "add this to the list you are looking at". A session IS a list of windows.
  //
  // Measured with KAN-5's technique (rescale each glyph's ink to a common box,
  // distinct% = symmetric difference / union): 79.7% from `add_box` and 81.1%
  // from `library_add`, against the 54.1% those two already measure from each
  // other. The shipping pair is the most similar thing on the screen.
  //
  // Note what that number could NOT settle: a bare `add` scores 76.6% from
  // `add_box`, which is high -- the shapes really do differ. It was the MEANING
  // that collided, and an ink metric cannot see meaning. The measurement ruled
  // out a new collision; it did not choose the glyph.
  test('is the list-append glyph, not a bare create-new plus', async () => {
    await renderHeader();

    const glyph = addButton().querySelector('.material-symbols-outlined');
    expect(glyph?.textContent).toBe('playlist_add');
    expect(glyph?.textContent).not.toBe('add');
  });

  // KAN-214. A tinted chip rather than an outlined box: the fill says "button"
  // and no border is drawn. It stays flush in the card's corner, so the fill
  // runs to the card's own border there -- Justine's pick over an inset.
  test('draws no border of its own', async () => {
    await renderHeader();

    const style = getComputedStyle(addButton());
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      expect(style[`border${side}Style`], side).toBe('none');
    }
  });

  // History, so the next change does not walk back into it. The fill moved
  // three times: HOVER_COLOR (the row-hover token, 1.047:1 against the card --
  // invisible); then none at all, with a border doing the work (KAN-213); now
  // CHIP_COLOR, which chipContrast.test.ts holds to the visible floor.
  test('rests on the chip fill', async () => {
    await renderHeader();

    const fill = getComputedStyle(addButton()).backgroundColor;
    expect(fill).toBe(hex(LIGHT_THEME.CHIP_COLOR));
    expect(fill).not.toBe(hex(LIGHT_THEME.HOVER_COLOR)); // the original defect
  });

  // CONTROL for the fill: with no border, the fill is the only thing that
  // separates the control from the header behind it.
  test('separates from the header it sits on', async () => {
    await renderHeader();

    expect(getComputedStyle(addButton()).backgroundColor).not.toBe(
      hex(LIGHT_THEME.SECONDARY_COLOR)
    );
  });

  // Hover and press are the icon ladder's own two steps, so the chip changes by
  // what every other control here changes by. jsdom cannot enter either state,
  // so the injected rules are what this holds (see pressedState.test.tsx).
  test('hovers and presses on the icon tokens', async () => {
    await renderHeader();

    expect(hoverRulesFor(addButton())).toMatch(
      asWritten(LIGHT_THEME.ICON_HOVER_COLOR)
    );
    expect(activeRulesFor(addButton())).toMatch(
      asWritten(LIGHT_THEME.ICON_ACTIVE_COLOR)
    );
  });
});

/** A colour as emotion writes it, or as jsdom normalises it. */
function asWritten(value: string): RegExp {
  return new RegExp(`(${value}|${hex(value).replace(/[()]/g, '\\$&')})`, 'i');
}

// jsdom reports colours as `rgb(r, g, b)`; the theme stores hex.
function hex(value: string): string {
  const v = value.replace('#', '');
  const n = parseInt(v, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
