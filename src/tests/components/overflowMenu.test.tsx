import { describe, expect, test, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OverflowMenu from '../../components/common/OverflowMenu';
import { renderWithProviders } from '../setup/renderWithProviders';

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
  const hoverRulesFor = (el: Element) => {
    const classes = [...el.classList].map((c) => `.${c}`);
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        const text = rule.cssText;
        if (text.includes(':hover') && classes.some((c) => text.includes(c))) {
          out.push(text);
        }
      }
    }
    return out.join('\n');
  };

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

    // #FF8080, as a BACKGROUND
    expect(rules).toMatch(
      /background-color:\s*(#FF8080|rgb\(255, ?128, ?128\))/i
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

    expect(rules).not.toMatch(/#FF8080|rgb\(255, ?128, ?128\)/i);
    expect(rules).toMatch(/background-color/);
  });
});
