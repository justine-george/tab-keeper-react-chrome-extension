import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  activeRulesFor,
  classRulesFor,
  hoverRulesFor,
} from '../setup/hoverRules';
import { mixHex } from '../../styles/mixHex';
import { DURATION } from '../../styles/scale';
import { asWritten } from '../setup/asWritten';
import { rgb } from '../setup/hexColor';

// KAN-205. 22 components carry an onClick; 7 imported Button. The other 15 each
// built their own clickable surface, which is where the inconsistency people
// see actually comes from -- not from Button being wrong, but from Button only
// knowing how to look one way.
//
// Three named kinds cover every one of them, and `quiet` is the default so no
// existing caller changes.

const render = (props = {}) =>
  renderWithProviders(
    <Button text="Act" onClick={() => undefined} {...props} />
  );
const button = () => screen.getByRole('button', { name: 'Act' });
const KEY_HINT = { text: 'Del', ariaKeyShortcuts: 'Delete' };

describe('Button variants (KAN-205)', () => {
  test('defaults to quiet, so every existing caller is unchanged', async () => {
    await render();

    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR)
    );
    expect(hoverRulesFor(button())).toMatch(
      asWritten(LIGHT_THEME.ICON_HOVER_COLOR)
    );
    expect(activeRulesFor(button())).toMatch(
      asWritten(LIGHT_THEME.ICON_ACTIVE_COLOR)
    );
  });

  // KAN-511. Drawn as the dialogs draw their main action (KAN-501): the text colour as the fill, the page's ground as the ink.
  test('primary is the filled main action: text-colour fill, ground-colour label and icon', async () => {
    await render({ variant: 'primary', iconType: 'star' });

    // Derived from the token: a literal here is the exact staleness this
    // ticket spent its time removing from three other test files.
    expect(getComputedStyle(button()).backgroundColor).toBe(
      rgb(LIGHT_THEME.TEXT_COLOR)
    );
    expect(getComputedStyle(button()).color).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR)
    );
    expect(getComputedStyle(button()).border).toContain(
      rgb(LIGHT_THEME.TEXT_COLOR)
    );
    const glyph = button().querySelector('.material-symbols-outlined');
    expect(glyph && getComputedStyle(glyph).color).toBe(
      rgb(LIGHT_THEME.PRIMARY_COLOR)
    );
    expect(hoverRulesFor(button())).toMatch(
      asWritten(mixHex(LIGHT_THEME.TEXT_COLOR, LIGHT_THEME.PRIMARY_COLOR, 0.88))
    );
    expect(activeRulesFor(button())).toMatch(
      asWritten(mixHex(LIGHT_THEME.TEXT_COLOR, LIGHT_THEME.PRIMARY_COLOR, 0.76))
    );
  });

  test('quiet keeps the text colour for its label', async () => {
    await render();

    expect(getComputedStyle(button()).color).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
  });

  test('danger rests as a quiet button with red ink', async () => {
    await render({ variant: 'danger', iconType: 'delete' });

    const style = getComputedStyle(button());
    expect(style.backgroundColor).toBe(rgb(LIGHT_THEME.PRIMARY_COLOR));
    expect(style.border).toContain(rgb(LIGHT_THEME.CONTROL_BORDER_COLOR));
    expect(style.color).toBe(rgb(LIGHT_THEME.DANGER_INK));
    const glyph = button().querySelector('.material-symbols-outlined');
    expect(glyph && getComputedStyle(glyph).color).toBe(
      rgb(LIGHT_THEME.DANGER_INK)
    );
  });

  // KAN-725. Red ink at rest, a red fill under the pointer, deeper pressed.
  test('danger fills red under the pointer and deeper when pressed', async () => {
    await render({ variant: 'danger' });

    const hover = hoverRulesFor(button());
    expect(hover).toMatch(
      new RegExp(
        `background-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL).source}`,
        'i'
      )
    );
    expect(hover).toMatch(
      new RegExp(
        `[^-]color:\\s*${asWritten(LIGHT_THEME.ON_DANGER_FILL).source}`,
        'i'
      )
    );
    expect(hover).toMatch(
      new RegExp(
        `border-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL).source}`,
        'i'
      )
    );
    const active = activeRulesFor(button());
    expect(active).toMatch(asWritten(LIGHT_THEME.DANGER_FILL_DEEP));
    expect(active).toMatch(
      new RegExp(
        `border-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL_DEEP).source}`,
        'i'
      )
    );
    // KAN-725. The old rule held one red for hover and press; pressing must
    // not land back on the hover fill.
    expect(active).not.toMatch(
      new RegExp(
        `background-color:\\s*${asWritten(LIGHT_THEME.DANGER_FILL).source}`,
        'i'
      )
    );
  });

  test('danger icon follows the hover ink', async () => {
    await render({ variant: 'danger', iconType: 'delete' });

    expect(hoverRulesFor(button())).toMatch(
      new RegExp(
        `material-symbols-outlined[^}]*color:\\s*${asWritten(LIGHT_THEME.ON_DANGER_FILL).source}`,
        'i'
      )
    );
  });

  test('danger draws its ring in its own ink', async () => {
    await render({ variant: 'danger' });

    expect(classRulesFor(button())).toMatch(
      /:focus-visible[^}]*outline:\s*2px solid currentcolor/i
    );
  });

  test('other variants keep the text-coloured ring', async () => {
    await render();

    expect(classRulesFor(button())).not.toMatch(
      /outline:\s*2px solid currentcolor/i
    );
  });

  test('busy shows progress and never presses deeper', async () => {
    await render({ variant: 'danger', busy: true });

    expect(getComputedStyle(button()).cursor).toBe('progress');
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    const active = activeRulesFor(button());
    expect(active).toMatch(asWritten(LIGHT_THEME.DANGER_FILL));
    expect(active).not.toMatch(asWritten(LIGHT_THEME.DANGER_FILL_DEEP));
  });

  test('busy leaves rest and hover alone', async () => {
    await render({ variant: 'danger', busy: true });

    const style = getComputedStyle(button());
    expect(style.backgroundColor).toBe(rgb(LIGHT_THEME.PRIMARY_COLOR));
    expect(style.color).toBe(rgb(LIGHT_THEME.DANGER_INK));
    expect(hoverRulesFor(button())).toMatch(asWritten(LIGHT_THEME.DANGER_FILL));
  });

  test('a button that is not busy keeps the pointer cursor', async () => {
    await render({ variant: 'danger' });

    expect(getComputedStyle(button()).cursor).toBe('pointer');
  });

  // KAN-725. An unavailable button's label must not brighten under the pointer.
  test('unavailable keeps its L2 label through hover and press, danger or not', async () => {
    for (const variant of ['quiet', 'danger']) {
      const { unmount } = await render({ variant, ariaDisabled: true });
      expect(classRulesFor(button())).toMatch(
        new RegExp(
          `\\.(css-\\w+)\\.\\1:hover,\\s*\\.\\1\\.\\1:active\\s*\\{[^}]*[^-]color:\\s*${asWritten(LIGHT_THEME.LABEL_L2_COLOR).source}`,
          'i'
        )
      );
      unmount();
    }
  });

  test.each(['quiet', 'primary', 'chip', 'outline'])(
    '%s recolours nothing on hover or press',
    async (variant) => {
      await render({ variant });

      for (const rules of [hoverRulesFor(button()), activeRulesFor(button())]) {
        const own = rules
          .split('\n')
          .filter((r) => !/(material-symbols|data-key-hint)/.test(r));
        expect(own.join('\n')).not.toMatch(/[^-]color:/);
      }
    }
  );

  test('only danger animates border-color and colour', async () => {
    const { unmount } = await render({ variant: 'danger' });
    const danger = classRulesFor(button());
    expect(danger).toMatch(
      new RegExp(`transition:[^;]*border-color ${DURATION.COLOR}`)
    );
    expect(danger).toMatch(
      new RegExp(`transition:[^;]*[^-]color ${DURATION.COLOR}`)
    );
    unmount();

    await render();
    const quiet = classRulesFor(button());
    expect(quiet).not.toMatch(/transition:[^;]*border-color/);
    expect(quiet).not.toMatch(/transition:[^;]*[^-]color 120ms/);
  });

  // KAN-725. The fill eases in, so an ink that switched at once would show white on the pale ground.
  test("a danger button's glyph and key hint ease their ink with the fill", async () => {
    const { unmount } = await render({
      variant: 'danger',
      iconType: 'delete',
      keyHint: KEY_HINT,
    });
    const glyph = button().querySelector('.material-symbols-outlined');
    const hint = button().querySelector('[data-key-hint]');
    if (glyph === null || hint === null) throw new Error('no glyph or hint');
    expect(getComputedStyle(glyph).transition).toBe(`color ${DURATION.COLOR}`);
    expect(getComputedStyle(hint).transition).toBe(`color ${DURATION.COLOR}`);
    unmount();

    // CONTROL. A quiet button's glyph keeps no transition of its own.
    await render({ iconType: 'delete' });
    const quietGlyph = button().querySelector('.material-symbols-outlined');
    if (quietGlyph === null) throw new Error('no glyph');
    expect(getComputedStyle(quietGlyph).transition).toBe('');
  });

  // KAN-725. Red as a danger menu item's hint is; any other variant keeps LABEL_L1.
  test("a danger button's key hint rests in its red ink", async () => {
    const { unmount } = await render({ variant: 'danger', keyHint: KEY_HINT });
    const hint = button().querySelector('[data-key-hint]');
    if (hint === null) throw new Error('no hint');
    expect(getComputedStyle(hint).color).toBe(rgb(LIGHT_THEME.DANGER_INK));
    unmount();

    await render({ keyHint: KEY_HINT });
    const quietHint = button().querySelector('[data-key-hint]');
    if (quietHint === null) throw new Error('no hint');
    expect(getComputedStyle(quietHint).color).toBe(
      rgb(LIGHT_THEME.LABEL_L1_COLOR)
    );
  });

  test('CONTROL: unavailable danger rests quiet and stays quiet', async () => {
    await render({
      variant: 'danger',
      ariaDisabled: true,
      iconType: 'delete',
      keyHint: KEY_HINT,
    });

    expect(getComputedStyle(button()).color).toBe(
      rgb(LIGHT_THEME.LABEL_L2_COLOR)
    );
    // The doubled-class rule outranks the base hover and press fills.
    const quiet = new RegExp(
      `\\.(css-\\w+)\\.\\1:hover,\\s*\\.\\1\\.\\1:active\\s*\\{[^}]*background-color:\\s*${asWritten(LIGHT_THEME.PRIMARY_COLOR).source}`,
      'i'
    );
    expect(classRulesFor(button())).toMatch(quiet);
    // KAN-725. Touched, no red edge and no white label, glyph or key hint.
    for (const rules of [hoverRulesFor(button()), activeRulesFor(button())]) {
      expect(rules).not.toMatch(/border-color/);
      expect(rules).not.toMatch(/material-symbols-outlined/);
      expect(rules).not.toMatch(asWritten(LIGHT_THEME.ON_DANGER_FILL));
    }
  });

  // KAN-725. Unavailable dims all of it: the glyph and key hint take the label's L2, touched or not.
  test('unavailable danger dims its glyph and key hint with its label', async () => {
    await render({
      variant: 'danger',
      ariaDisabled: true,
      iconType: 'delete',
      keyHint: KEY_HINT,
    });

    const glyph = button().querySelector('.material-symbols-outlined');
    const hint = button().querySelector('[data-key-hint]');
    if (glyph === null || hint === null) throw new Error('no glyph or hint');
    const l2 = rgb(LIGHT_THEME.LABEL_L2_COLOR);
    expect(getComputedStyle(glyph).color).toBe(l2);
    expect(getComputedStyle(hint).color).toBe(l2);
    for (const rules of [hoverRulesFor(button()), activeRulesFor(button())]) {
      expect(rules).not.toMatch(asWritten(LIGHT_THEME.DANGER_INK));
      const hintRule = rules
        .split('\n')
        .find((r) => r.includes('[data-key-hint]'));
      expect(hintRule ?? '').toMatch(asWritten(LIGHT_THEME.LABEL_L2_COLOR));
    }
  });
});

describe('Button outline variant (KAN-394)', () => {
  test('rests transparent with a panel edge, hovers and presses on the icon fills', async () => {
    await renderWithProviders(
      <Button text="Act" variant="outline" onClick={() => undefined} />
    );
    const el = screen.getByRole('button', { name: 'Act' });
    expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(el).border).toContain(
      rgb(LIGHT_THEME.PANEL_BORDER_COLOR)
    );
    expect(hoverRulesFor(el)).toMatch(asWritten(LIGHT_THEME.ICON_HOVER_COLOR));
    expect(activeRulesFor(el)).toMatch(
      asWritten(LIGHT_THEME.ICON_ACTIVE_COLOR)
    );
  });
});
