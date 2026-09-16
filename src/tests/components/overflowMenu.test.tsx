import { describe, expect, test, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OverflowMenu from '../../components/common/OverflowMenu';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { hoverRulesFor } from '../setup/hoverRules';

/**
 * A colour as it may appear in an injected rule: the hex emotion was given, or
 * the `rgb(...)` jsdom normalises it to. Derived from the token rather than
 * pinned, because KAN-204 changed four of the five delete fills and a literal
 * here went stale without failing.
 */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

// The app's first popover.
//
// Built on real listeners rather than the native Popover API, which would have
// given light-dismiss and Escape for free: jsdom 30 implements none of it
// (`'popover' in el` is false, showPopover is undefined), so a popover-based
// menu would throw in every test here and ship with no coverage at all. The
// E2E suite cannot substitute -- it has no way to grant the tabGroups
// permission, so it never renders a group row to hang a menu on.
//
// What this component owns, and why it is extracted rather than inlined: the
// menu semantics and the keyboard contract, in one place, once. Six a11y
// tickets (KAN-62/64/66/67/68/77) are the reason that is worth a component.

const ITEMS = [
  { key: 'ungroup', label: 'Ungroup', icon: 'label_off', onSelect: vi.fn() },
  { key: 'delete', label: 'Delete group', icon: 'delete', onSelect: vi.fn() },
];

const renderMenu = (
  overrides: Partial<React.ComponentProps<typeof OverflowMenu>> = {}
) =>
  renderWithProviders(
    <OverflowMenu ariaLabel="More actions" items={ITEMS} {...overrides} />
  );

const trigger = () => screen.getByRole('button', { name: 'More actions' });

describe('OverflowMenu trigger', () => {
  test('is a button that advertises the menu it controls', async () => {
    await renderMenu();

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  test('the menu is not in the document until opened', async () => {
    await renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('opening flips aria-expanded and reveals the menu', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('OverflowMenu items', () => {
  test('each item is a menuitem named by its label', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    const menu = screen.getByRole('menu');

    expect(
      within(menu).getByRole('menuitem', { name: 'Ungroup' })
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: 'Delete group' })
    ).toBeInTheDocument();
  });

  // The glyph is decorative -- the label already names the item, so the
  // ligature text must not leak into the accessible name (BINDING CONSTRAINT
  // 3 in WindowEntryContainer, and the same rule KAN-56 was about).
  test('an item icon stays out of the accessible name', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());

    expect(
      screen.queryByRole('menuitem', { name: /label_off/ })
    ).not.toBeInTheDocument();
  });

  test('choosing an item runs its action and closes the menu', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    await renderMenu({
      items: [
        { key: 'ungroup', label: 'Ungroup', icon: 'label_off', onSelect },
      ],
    });

    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('OverflowMenu dismissal', () => {
  test('Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  test('a click outside closes it', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // THE CONTROL for the test above. Every dismissal assertion is "the menu
  // went away", which a menu that never opened would satisfy just as well.
  // This proves a click INSIDE does not close it, so the outside-click
  // listener is discriminating rather than indiscriminate.
  test('CONTROL: a click inside the menu does not close it', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.click(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  test('clicking the trigger again closes it', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.click(trigger());

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('OverflowMenu keyboard navigation', () => {
  // Roving focus is the part the platform would never have given us, popover
  // or not, and the part a pointer-only test would never notice was missing.
  test('opening moves focus to the first item', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());

    expect(screen.getByRole('menuitem', { name: 'Ungroup' })).toHaveFocus();
  });

  test('ArrowDown walks to the next item', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.keyboard('{ArrowDown}');

    expect(
      screen.getByRole('menuitem', { name: 'Delete group' })
    ).toHaveFocus();
  });

  test('ArrowDown wraps from the last item to the first', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.keyboard('{ArrowDown}{ArrowDown}');

    expect(screen.getByRole('menuitem', { name: 'Ungroup' })).toHaveFocus();
  });

  test('ArrowUp wraps from the first item to the last', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());
    await user.keyboard('{ArrowUp}');

    expect(
      screen.getByRole('menuitem', { name: 'Delete group' })
    ).toHaveFocus();
  });
});

describe('OverflowMenu destructive styling', () => {
  // The app expresses "this action destroys something" as a red FILL behind a
  // dark glyph -- Icon.tsx:115 picks DELETE_ICON_HOVER_COLOR as the hover
  // BACKGROUND, and the glyph stays TEXT_COLOR. The first version of this menu
  // used the token the other way round, tinting the glyph on a grey row, which
  // read as a different control entirely beside the row delete icons.
  //
  // Asserted against the generated CSS rather than a rendered hover, because
  // jsdom applies no :hover pseudo-class -- getComputedStyle would report the
  // resting state for both branches and pass against either. The real hover is
  // verified in a browser.

  test('a danger item fills with the delete colour on hover', async () => {
    const user = userEvent.setup();
    await renderMenu({
      items: [
        {
          key: 'delete',
          label: 'Delete group',
          icon: 'delete',
          danger: true,
          onSelect: () => undefined,
        },
      ],
    });
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Delete group' });
    const rules = hoverRulesFor(item);

    // Read from the token, not pinned as a literal: KAN-204 changed this value
    // in four of the five themes, and a hardcoded hex here went stale silently.
    // What this test owns is that the token arrives as a BACKGROUND -- the
    // CONTROL below is what makes that a real claim.
    expect(rules).toMatch(
      new RegExp(
        `background-color:\\s*${
          asWritten(LIGHT_THEME.DELETE_ICON_HOVER_COLOR).source
        }`,
        'i'
      )
    );
  });

  // THE CONTROL. Asserting only that the token appears would pass against the
  // original bug, which used the very same token -- as a foreground colour.
  test('CONTROL: a non-danger item does not use the delete colour', async () => {
    const user = userEvent.setup();
    await renderMenu({
      items: [
        {
          key: 'ungroup',
          label: 'Ungroup',
          icon: 'label_off',
          onSelect: () => undefined,
        },
      ],
    });
    await user.click(trigger());

    const rules = hoverRulesFor(
      screen.getByRole('menuitem', { name: 'Ungroup' })
    );

    expect(rules).not.toMatch(asWritten(LIGHT_THEME.DELETE_ICON_HOVER_COLOR));
    expect(rules).toMatch(/background-color/);
  });
});

// KAN-193. The menu was always anchored to its trigger's RIGHT edge, which
// suits a trigger at the end of a row -- the tab group title, its first
// consumer -- and not one near the start. In the session header it opened
// leftward across the pane divider, over the session list. `align` says which
// edge of the trigger the menu lines up with; 'end' stays the default so the
// existing consumer does not move.
// KAN-203. Reported from the session More-actions menu: the item icons flicker
// when the pointer crosses between items, and look washed out beside every
// other icon in the app.
//
// One rule caused both. The glyph was painted LABEL_L2_COLOR at rest and
// repainted to TEXT_COLOR on hover, over a 150ms colour transition -- so
// crossing between two items faded one glyph down while the other faded up.
// Measured in a real build, Light theme: rest rgb(110,112,115) against a label
// of rgb(59,61,64), and sampling every 25ms through a crossing caught both
// glyphs mid-fade travelling in opposite directions.
//
// The glyph now has ONE colour, the same as the label beside it and the
// toolbar icons above it. Nothing animates, so nothing can flicker.
describe('OverflowMenu item glyphs have one colour (KAN-203)', () => {
  const glyphOf = (item: HTMLElement) =>
    item.querySelector('.overflow-menu-glyph')!;

  const openFirstItem = async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());
    return screen.getByRole('menuitem', { name: 'Ungroup' });
  };

  test('the glyph is painted in the same colour as its label', async () => {
    const item = await openFirstItem();

    const glyph = getComputedStyle(glyphOf(item)).color;
    expect(glyph).toBe(getComputedStyle(item).color);
    // And that colour is TEXT_COLOR, not the quieter label tier it used to be.
    expect(glyph).toBe('rgb(59, 61, 64)');
    expect(glyph).not.toBe('rgb(110, 112, 115)');
  });

  test('no hover rule repaints the glyph', async () => {
    const item = await openFirstItem();

    // hoverRulesFor reads the rules emotion injected, because jsdom applies no
    // :hover -- a computed style would report the resting state either way and
    // pass against the bug this pins.
    expect(hoverRulesFor(glyphOf(item))).toBe('');
  });

  test('the glyph has no transition to animate', async () => {
    const item = await openFirstItem();

    // Asserted on DURATION, not property. jsdom reports transition-property as
    // 'all' when nothing declares one, so a property assertion would be
    // testing jsdom's default rather than this component. A zero duration is
    // the claim that matters, and it fails against the 150ms this replaced.
    expect(getComputedStyle(glyphOf(item)).transitionDuration).toBe('0s');
  });

  // THE CONTROL. The three assertions above are all satisfied by a glyph that
  // is simply invisible, or by one painted the ground colour. This is what
  // makes them claims about a READABLE glyph rather than an absent one.
  test('CONTROL: the glyph is still drawn, and reads against the menu', async () => {
    const item = await openFirstItem();
    const glyph = glyphOf(item);

    expect(glyph.textContent).toBe('label_off');
    expect(getComputedStyle(glyph).color).not.toBe(
      getComputedStyle(screen.getByRole('menu')).backgroundColor
    );
  });
});

describe('which edge of the trigger the menu lines up with (KAN-193)', () => {
  test('by default the menu lines up with the trigger END, as before', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());

    const menu = getComputedStyle(screen.getByRole('menu'));
    expect(menu.right).toBe('0px');
    expect(menu.left).not.toBe('0px');
  });

  test('align start lines the menu up with the trigger START instead', async () => {
    const user = userEvent.setup();
    await renderMenu({ align: 'start' });
    await user.click(trigger());

    const menu = getComputedStyle(screen.getByRole('menu'));
    expect(menu.left).toBe('0px');
    // CONTROL: not both. A menu pinned to both edges stretches to the
    // trigger's width instead of opening beside it.
    expect(menu.right).not.toBe('0px');
  });

  // A two-line label reads as two items squeezed together, and in the session
  // header "Export as PDF / web page" wrapped at the minimum width. jsdom
  // cannot lay text out, so this pins the rule; the e2e measures the heights.
  test('an item label never wraps onto a second line', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());

    expect(
      getComputedStyle(screen.getAllByRole('menuitem')[0]).whiteSpace
    ).toBe('nowrap');
  });
});
