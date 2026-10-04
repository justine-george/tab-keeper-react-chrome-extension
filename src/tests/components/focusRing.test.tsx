import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Button from '../../components/common/Button';
import Icon from '../../components/common/Icon';
import OverflowMenu from '../../components/common/OverflowMenu';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../../hooks/useThemeColors';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';

// KAN-405 (picks 1A, 2A). jsdom matches no :focus-visible, so the ring is
// read from the injected rules; the painted ring is the e2e's.

const THEMES = [
  [Theme.LIGHT, LIGHT_THEME],
  [Theme.WARM_LIGHT, WARM_LIGHT_THEME],
  [Theme.BB_PINK, BB_PINK_THEME],
  [Theme.DARKENHEIMER, DARKENHEIMER_THEME],
  [Theme.BLUE, BLUE_THEME],
] as const;

// The :focus-visible rules on `el`, lower-cased.
const ringRules = (el: Element) =>
  classRulesFor(el)
    .split('\n')
    .filter((r) => r.includes(':focus-visible'))
    .join('\n')
    .toLowerCase();

const ring = (text: string) =>
  new RegExp(
    `outline: 2px solid ${text.toLowerCase()};\\s*outline-offset: -4px`
  );

describe('the themed ring (1A)', () => {
  test.each(THEMES)('an Icon button, in %s', async (theme, colors) => {
    await renderWithProviders(
      <Icon type="more_vert" ariaLabel="More" onClick={() => undefined} />,
      { seedStore: (store) => store.dispatch(setTheme(theme)) }
    );
    expect(ringRules(screen.getByRole('button'))).toMatch(
      ring(colors.TEXT_COLOR)
    );
  });

  test.each(THEMES)('a Button, in %s', async (theme, colors) => {
    await renderWithProviders(
      <Button ariaLabel="Save" iconType="library_add" onClick={() => {}} />,
      { seedStore: (store) => store.dispatch(setTheme(theme)) }
    );
    expect(ringRules(screen.getByRole('button'))).toMatch(
      ring(colors.TEXT_COLOR)
    );
  });

  test('CONTROL: a decorative Icon, never focused, has no ring', async () => {
    const { container } = await renderWithProviders(<Icon type="tab" />);
    const el = container.firstElementChild;
    if (el === null) throw new Error('no icon');
    expect(el.getAttribute('tabindex')).toBeNull();
    expect(ringRules(el)).toBe('');
  });
});

describe('Esc returns focus to the trigger (2A)', () => {
  afterEach(() => vi.restoreAllMocks());

  const trigger = () => screen.getByRole('button', { name: 'More actions' });
  const renderMenu = () =>
    renderWithProviders(
      <OverflowMenu
        ariaLabel="More actions"
        items={[
          { key: 'a', label: 'First', icon: 'add_box', onSelect: () => {} },
          { key: 'b', label: 'Second', icon: 'ios_share', onSelect: () => {} },
        ]}
      />
    );
  // How the trigger was focused when Esc closed the menu.
  const focusOnEsc = async (user: ReturnType<typeof userEvent.setup>) => {
    const focus = vi.spyOn(trigger(), 'focus');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(1);
    return focus.mock.calls[0][0];
  };

  test('opened with a click: no ring', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());
    expect(await focusOnEsc(user)).toEqual({ focusVisible: false });
  });

  test('opened with Enter: the ring stays', async () => {
    const user = userEvent.setup();
    await renderMenu();
    act(() => trigger().focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(await focusOnEsc(user)).toBeUndefined();
  });

  test('opened with Space: the ring stays', async () => {
    const user = userEvent.setup();
    await renderMenu();
    act(() => trigger().focus());
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(await focusOnEsc(user)).toBeUndefined();
  });

  test('opened with a click, then walked with the arrows: the ring stays', async () => {
    const user = userEvent.setup();
    await renderMenu();
    await user.click(trigger());
    await user.keyboard('{ArrowDown}');
    expect(await focusOnEsc(user)).toBeUndefined();
  });

  test('a click-open after a keyboard-open: no ring again', async () => {
    const user = userEvent.setup();
    await renderMenu();
    act(() => trigger().focus());
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    await user.click(trigger());
    expect(await focusOnEsc(user)).toEqual({ focusVisible: false });
  });
});
