import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';

import Icon from '../../components/common/Icon';
import OpenNowColumn from '../../components/home/opennow/OpenNowColumn';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import {
  activeRulesFor,
  classRulesFor,
  hoverRulesFor,
} from '../setup/hoverRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import { asWritten } from '../setup/asWritten';
import { rgb } from '../setup/hexColor';

// KAN-725. Which icons go red is an explicit `danger` opt-in, not the glyph's
// type: "close" is shared with six dismissals that stay quiet.

const FILL = asWritten(LIGHT_THEME.DANGER_FILL);
const DEEP = asWritten(LIGHT_THEME.DANGER_FILL_DEEP);
const ON_FILL = LIGHT_THEME.ON_DANGER_FILL;
const noop = vi.fn();

const glyphColorRules = (rules: string) =>
  rules
    .split('\n')
    .filter((r) => /material-symbols-outlined/.test(r))
    .join('\n');

describe('a danger Icon', () => {
  test('fills red on hover and deeper on press', async () => {
    await renderWithProviders(
      <Icon type="delete" danger ariaLabel="Delete tab" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Delete tab' });
    expect(hoverRulesFor(button)).toMatch(FILL);
    expect(activeRulesFor(button)).toMatch(DEEP);
    expect(activeRulesFor(button)).not.toMatch(FILL);
  });

  test('turns its glyph white on the red', async () => {
    await renderWithProviders(
      <Icon type="delete" danger ariaLabel="Delete tab" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Delete tab' });
    const white = asWritten(ON_FILL);
    expect(glyphColorRules(hoverRulesFor(button))).toMatch(
      new RegExp(`color:\\s*${white.source}`, 'i')
    );
    expect(glyphColorRules(activeRulesFor(button))).toMatch(
      new RegExp(`color:\\s*${white.source}`, 'i')
    );
  });

  test('turns its focus ring white while it sits on the red', async () => {
    await renderWithProviders(
      <Icon type="delete" danger ariaLabel="Delete tab" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Delete tab' });
    const rules = classRulesFor(button).split('\n');
    const ring = (state: string) =>
      rules.find(
        (r) =>
          r.includes(':focus-visible') &&
          r.includes(state) &&
          /outline(-color)?:/.test(r)
      ) ?? '';
    const white = asWritten(ON_FILL).source;
    expect(ring(':hover')).toMatch(new RegExp(`outline[^;]*${white}`, 'i'));
    expect(ring(':active')).toMatch(new RegExp(`outline[^;]*${white}`, 'i'));
  });

  test('rests as a plain icon: TEXT_COLOR glyph on no fill', async () => {
    await renderWithProviders(
      <Icon type="delete" danger ariaLabel="Delete tab" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Delete tab' });
    const glyph = button.querySelector('.material-symbols-outlined');
    if (!glyph) throw new Error('no glyph');
    expect(getComputedStyle(glyph).color).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
    expect(getComputedStyle(button).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  // KAN-725. The fill eases in, so a glyph that switched at once would show white on the pale ground.
  test('eases its glyph ink with its fill; a plain icon does not', async () => {
    await renderWithProviders(
      <>
        <Icon type="delete" danger ariaLabel="Delete tab" onClick={noop} />
        <Icon type="close" ariaLabel="Dismiss" onClick={noop} />
      </>
    );
    const danger = screen.getByRole('button', { name: 'Delete tab' });
    const glyph = danger.querySelector('.material-symbols-outlined');
    if (!glyph) throw new Error('no glyph');
    expect(getComputedStyle(glyph).transition).toBe(
      getComputedStyle(danger).transition.replace('background-color', 'color')
    );

    const plain = screen.getByRole('button', { name: 'Dismiss' });
    const plainGlyph = plain.querySelector('.material-symbols-outlined');
    if (!plainGlyph) throw new Error('no glyph');
    expect(getComputedStyle(plainGlyph).transition).toBe('');
  });

  test('stays inert when disabled', async () => {
    await renderWithProviders(
      <Icon
        type="delete"
        danger
        disable
        ariaLabel="Delete tab"
        onClick={noop}
      />
    );
    const button = screen.getByRole('button', { name: 'Delete tab' });
    expect(hoverRulesFor(button)).not.toMatch(FILL);
  });
});

describe('controls', () => {
  test('a close icon without danger is not red', async () => {
    await renderWithProviders(
      <Icon type="close" ariaLabel="Dismiss" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expect(hoverRulesFor(button)).toMatch(
      asWritten(LIGHT_THEME.ICON_HOVER_COLOR)
    );
    expect(hoverRulesFor(button)).not.toMatch(FILL);
  });

  test('type="delete" alone no longer makes an icon red', async () => {
    await renderWithProviders(
      <Icon type="delete" ariaLabel="Remove" onClick={noop} />
    );
    const button = screen.getByRole('button', { name: 'Remove' });
    expect(hoverRulesFor(button)).not.toMatch(FILL);
    expect(activeRulesFor(button)).not.toMatch(DEEP);
  });
});

describe('Open now', () => {
  test('its close x is a danger icon', async () => {
    await renderWithProviders(<OpenNowColumn folded={true} />, {
      seed: {
        grantedPermissions: ['tabGroups'],
        windows: [
          {
            id: 1,
            focused: true,
            tabs: [{ id: 11, title: 'alpha', url: 'https://a.test/1' }],
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    });
    const close = await screen.findByRole('button', {
      name: 'Close tab: alpha',
    });
    expect(hoverRulesFor(close)).toMatch(FILL);
  });
});
