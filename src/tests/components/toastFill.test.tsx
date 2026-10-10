import { beforeEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../hooks/useThemeColors';
import { offerReopen } from '../../redux/reopenOffer';
import { setTheme, Theme } from '../../redux/slices/settingsDataStateSlice';
import { closeOpenTab } from '../../utils/functions/reopen';
import { toOpenWindows } from '../../utils/functions/openNow';
import { contrast } from '../setup/contrast';
import { initTestI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-487. A toast floats over the session list, so it must not wear the
// list's own colour: the card fill and the theme's floating shadow. The card
// is also what the Reopen chip's fill was tuned on (chipContrast.test.ts), so
// the chip keeps its fill on the toast in every theme.

const THEMES: [Theme, ThemeColors][] = [
  [Theme.LIGHT, LIGHT_THEME],
  [Theme.WARM_LIGHT, WARM_LIGHT_THEME],
  [Theme.BB_PINK, BB_PINK_THEME],
  [Theme.DARKENHEIMER, DARKENHEIMER_THEME],
  [Theme.BLUE, BLUE_THEME],
];

// The weakest step any theme's card takes off its ground (Paper, 1.10:1).
const OFF_THE_LIST = 1.08;
// chipContrast.test.ts's floor for a chip that can be seen on its card.
const CHIP_FLOOR = 1.2;
const TEXT_FLOOR = 4.5;

const hex = (rgb: string): string => {
  const parts = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (parts === null) throw new Error(`not a colour: ${rgb}`);
  return `#${parts
    .slice(1, 4)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
};

beforeEach(async () => {
  await initTestI18n();
});

async function reopenToastIn(theme: Theme) {
  const { store } = await renderWithProviders(<Toast />, {
    seed: {
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [{ url: 'https://home.test/', active: true }],
        },
        {
          id: 2,
          tabs: [{ url: 'https://a.test/' }, { url: 'https://b.test/' }],
        },
      ],
    },
    seedStore: (s) => s.dispatch(setTheme(theme)),
  });
  const all = await chrome.windows.getAll({ populate: true });
  const w2 = toOpenWindows(all, null, null).find((w) => w.id === 2);
  const b = w2?.tabs.find((t) => t.url === 'https://b.test/');
  if (w2 === undefined || b === undefined) throw new Error('no tab b');
  const item = await closeOpenTab(w2, b);
  if (item === null) throw new Error('close failed');
  await act(async () => {
    await store.dispatch(offerReopen(item));
  });
  const chip = screen.getByRole('button', { name: 'Reopen' });
  const toast = chip.closest<HTMLElement>('[data-toast]');
  if (toast === null) throw new Error('no toast around the chip');
  return { toast, chip };
}

describe('a toast stands out from the list it floats over (KAN-487)', () => {
  test.each(THEMES)(
    '%s: off the list’s colour, with the floating shadow',
    async (theme, colors) => {
      const { toast } = await reopenToastIn(theme);
      const fill = hex(getComputedStyle(toast).backgroundColor);
      expect(
        contrast(fill, colors.PRIMARY_COLOR),
        `toast ${fill} on the list's ${colors.PRIMARY_COLOR}`
      ).toBeGreaterThanOrEqual(OFF_THE_LIST);
      // jsdom drops the space between layers.
      const layers = (shadow: string) => shadow.replace(/,\s*/g, ',');
      expect(layers(getComputedStyle(toast).boxShadow)).toBe(
        layers(colors.FLOATING_SHADOW)
      );
    }
  );

  test.each(THEMES)(
    '%s: the Reopen chip keeps its fill on it, and the text reads',
    async (theme, colors) => {
      const { toast, chip } = await reopenToastIn(theme);
      const fill = hex(getComputedStyle(toast).backgroundColor);
      const chipFill = hex(getComputedStyle(chip).backgroundColor);
      // PREMISE: the chip is drawn in its resting fill.
      expect(chipFill).toBe(colors.CHIP_COLOR.toUpperCase());
      expect(
        contrast(chipFill, fill),
        `chip ${chipFill} on toast ${fill}`
      ).toBeGreaterThanOrEqual(CHIP_FLOOR);
      expect(contrast(colors.TEXT_COLOR, fill)).toBeGreaterThanOrEqual(
        TEXT_FLOOR
      );
    }
  );
});
