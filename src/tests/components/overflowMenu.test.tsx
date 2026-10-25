import { describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import OverflowMenu, {
  type OverflowMenuItem,
} from '../../components/common/OverflowMenu';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor, hoverRulesFor } from '../setup/hoverRules';
import { asWritten } from '../setup/asWritten';
import { rgb } from '../setup/hexColor';

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

const ITEMS: OverflowMenuItem[] = [
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

describe('OverflowMenu elevation (KAN-267)', () => {
  // The menu sits on the same PRIMARY_COLOR ground as the page, and a 1px
  // border alone read as a panel cut INTO the page. A shadow -- not a scrim,
  // which is the dialogs' modal signal -- is what says "above it". jsdom
  // resolves emotion's injected stylesheet, so the computed value is real.
  test('the open menu casts a shadow', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(trigger());

    const shadow = getComputedStyle(screen.getByRole('menu')).boxShadow;
    expect(shadow).not.toBe('');
    expect(shadow).not.toBe('none');
    // Two layers: a tight contact edge and a soft lift.
    expect(shadow.split('),').length).toBe(2);
  });

  // Black at 18% can take 18% off a ground that is already at 42/255: the
  // same shadow measured Δ50 below the menu's edge on Paper and Δ8 on
  // Graphite. Shadows fail on dark surfaces unless they are much heavier,
  // so the strength is a theme token, and the dark themes carry more of it.
  test('the dark themes cast a heavier shadow than the light ones', () => {
    const heaviest = (shadow: string) =>
      Math.max(
        ...[...shadow.matchAll(/rgba\(0, 0, 0, ([\d.]+)\)/g)].map((m) =>
          Number(m[1])
        )
      );
    for (const dark of [DARKENHEIMER_THEME, BLUE_THEME, CHARCOAL_THEME]) {
      for (const light of [
        LIGHT_THEME,
        WARM_LIGHT_THEME,
        BB_PINK_THEME,
        CHALK_THEME,
      ]) {
        expect(heaviest(dark.FLOATING_SHADOW)).toBeGreaterThan(
          heaviest(light.FLOATING_SHADOW)
        );
      }
    }
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

  // Chrome closes the popup on an Esc the page leaves unprevented (KAN-403).
  const escape = () =>
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

  test('the Escape that closes it is prevented, so the popup stays open', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());
    const event = escape();

    act(() => {
      document.activeElement?.dispatchEvent(event);
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  test('an Escape with the menu closed is left alone, so the popup closes', async () => {
    await renderMenu();
    trigger().focus();
    const event = escape();

    act(() => {
      trigger().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
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
  // KAN-725. A danger item is red ink at rest and fills red, with white ink, when touched.
  // Hover rules are read from the injected CSS because jsdom applies no :hover; rest is computed.

  const DANGER_ITEM: OverflowMenuItem = {
    key: 'delete',
    label: 'Delete group',
    icon: 'delete',
    danger: true,
    onSelect: () => undefined,
  };
  const inkOf = (el: Element) => getComputedStyle(el).color;

  test('a danger item fills red on hover with white ink', async () => {
    const user = userEvent.setup();
    await renderMenu({ items: [DANGER_ITEM] });
    await user.click(trigger());

    const rules = hoverRulesFor(
      screen.getByRole('menuitem', { name: 'Delete group' })
    );

    expect(rules).toMatch(
      new RegExp(
        `background-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL).source}`,
        'i'
      )
    );
    expect(rules).toMatch(
      new RegExp(
        `color:\\s*${asWritten(LIGHT_THEME.ON_DANGER_FILL).source}`,
        'i'
      )
    );
  });

  test('a danger item is red at rest', async () => {
    const user = userEvent.setup();
    await renderMenu({ items: [DANGER_ITEM] });
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Delete group' });
    const glyph = item.querySelector('.overflow-menu-glyph');
    if (glyph === null) throw new Error('no glyph');

    expect(inkOf(item)).toBe(rgb(LIGHT_THEME.DANGER_INK));
    expect(inkOf(glyph)).toBe(rgb(LIGHT_THEME.DANGER_INK));
  });

  test("a danger item's glyph turns white on the red fill", async () => {
    const user = userEvent.setup();
    await renderMenu({ items: [DANGER_ITEM] });
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Delete group' });
    const glyph = item.querySelector('.overflow-menu-glyph');
    if (glyph === null) throw new Error('no glyph');

    // The glyph sets no colour of its own, so it follows the item's per-state ink.
    expect(classRulesFor(glyph)).not.toMatch(/color:\s*rgb\(|color:\s*#/i);
    expect(hoverRulesFor(item)).toMatch(asWritten(LIGHT_THEME.ON_DANGER_FILL));
  });

  test("a danger item's key hint is red at rest and white on the fill", async () => {
    const user = userEvent.setup();
    await renderMenu({
      items: [
        {
          ...DANGER_ITEM,
          shortcut: {
            hint: 'Del',
            ariaKeyShortcuts: 'Delete',
            matches: () => false,
          },
        },
      ],
    });
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Delete group' });
    const hint = item.querySelector('[data-key-hint]');
    if (hint === null) throw new Error('no hint');

    expect(inkOf(hint)).toBe(rgb(LIGHT_THEME.DANGER_INK));
    expect(hoverRulesFor(item)).toMatch(
      new RegExp(
        `\\[data-key-hint\\][^}]*color:\\s*${asWritten(LIGHT_THEME.ON_DANGER_FILL).source}`,
        'i'
      )
    );
  });

  // THE CONTROL. Only a danger item turns the hint red.
  test("a non-danger item's hint keeps LABEL_L1", async () => {
    const user = userEvent.setup();
    await renderMenu({
      items: [
        {
          key: 'ungroup',
          label: 'Ungroup',
          icon: 'label_off',
          onSelect: () => undefined,
          shortcut: { hint: 'U', ariaKeyShortcuts: 'U', matches: () => false },
        },
      ],
    });
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Ungroup' });
    const hint = item.querySelector('[data-key-hint]');
    if (hint === null) throw new Error('no hint');

    expect(inkOf(hint)).toBe(rgb(LIGHT_THEME.LABEL_L1_COLOR));
    expect(inkOf(item)).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
  });

  // THE CONTROL. Asserting only that red appears would pass against a menu that painted everything red.
  test('CONTROL: a non-danger item uses no danger colour', async () => {
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

    expect(rules).not.toMatch(asWritten(LIGHT_THEME.DANGER_FILL));
    expect(rules).not.toMatch(asWritten(LIGHT_THEME.DANGER_INK));
    expect(rules).toMatch(asWritten(LIGHT_THEME.HOVER_COLOR));
  });

  // KAN-725. The fill eases in, so ink that switched at once would show white on the pale ground.
  test("a danger item's ink and key hint ease with its fill; other items' do not", async () => {
    const user = userEvent.setup();
    const shortcut = {
      hint: 'Del',
      ariaKeyShortcuts: 'Delete',
      matches: () => false,
    };
    await renderMenu({
      items: [
        { ...DANGER_ITEM, shortcut },
        {
          key: 'ungroup',
          label: 'Ungroup',
          icon: 'label_off',
          onSelect: () => undefined,
          shortcut: { ...shortcut, hint: 'U' },
        },
      ],
    });
    await user.click(trigger());

    const danger = screen.getByRole('menuitem', { name: 'Delete group' });
    const dangerHint = danger.querySelector('[data-key-hint]');
    if (dangerHint === null) throw new Error('no hint');
    const item = getComputedStyle(danger);
    expect(item.transitionProperty).toMatch(/^background-color, ?color$/);
    const hint = getComputedStyle(dangerHint);
    expect(hint.transitionProperty).toBe('color');
    expect(hint.transitionDuration).toBe(item.transitionDuration);
    expect(hint.transitionTimingFunction).toBe(item.transitionTimingFunction);

    // CONTROL. A plain item keeps its one transition, and its hint none.
    const plain = screen.getByRole('menuitem', { name: 'Ungroup' });
    const plainHint = plain.querySelector('[data-key-hint]');
    if (plainHint === null) throw new Error('no hint');
    expect(getComputedStyle(plain).transitionProperty).toBe('background-color');
    expect(getComputedStyle(plainHint).transitionDuration).toBe('0s');
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

// KAN-208. The save row's trigger is a SEGMENT of a bordered group, the same
// height as the button beside it, so its hover and pressed fills cover the
// segment the way the button's do. Icon's box is otherwise content-sized.
describe('OverflowMenu triggerStyle', () => {
  test('is appended to the trigger box', async () => {
    await renderMenu({ triggerStyle: 'width: 40px;' });

    expect(getComputedStyle(trigger()).width).toBe('40px');
  });

  // CONTROL: without it the trigger keeps its own size, so the test above is
  // measuring the prop rather than a constant.
  test('CONTROL: without it the trigger keeps its own size', async () => {
    await renderMenu();

    expect(getComputedStyle(trigger()).width).not.toBe('40px');
  });
});

describe('OverflowMenu beside the coach mark (KAN-413)', () => {
  // Finish must not close the menu its mark points at. CONTROL: a press anywhere else still closes it.
  test('a press on the coach mark leaves the menu open', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());
    const coach = document.createElement('div');
    coach.setAttribute('data-coach-mark', '');
    const finish = document.createElement('button');
    coach.append(finish);
    document.body.append(coach);
    fireEvent.pointerDown(finish);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    coach.remove();
  });
});
