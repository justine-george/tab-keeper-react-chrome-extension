import { afterEach, describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-7 §7. Settings → Quick access → Default view: a pair whose choice is saved
// first, then mirrored for the worker, then applied with setPopup.

const renderQuickAccess = (seed: ChromeSeed = { action: {} }) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.QUICK_ACCESS));
    },
  });

const pair = () => screen.getByRole('group', { name: 'Default view' });
const side = (name: 'Compact view' | 'Full view') =>
  within(pair()).getByRole('button', { name });
const savedSettings = (): unknown =>
  JSON.parse(localStorage.getItem('settingsData') ?? '{}');
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Default view row (KAN-7 §7)', () => {
  test('is the first row in Quick access (KAN-652), with Compact pressed', async () => {
    const { container } = await renderQuickAccess();
    expect(sectionLabels(container)).toEqual([
      'Default view',
      'Pin Tab Keeper in new windows',
      'Keyboard shortcut',
    ]);
    expect(side('Compact view')).toHaveAttribute('aria-pressed', 'true');
    expect(side('Full view')).toHaveAttribute('aria-pressed', 'false');
  });

  // KAN-749. Setup's picture cards, in place of the Compact | Full pair.
  test("shows setup's cards: each has its drawing and says where it opens, the pressed one carries a ✓", async () => {
    await renderQuickAccess();
    expect(side('Compact view')).toHaveAccessibleDescription(
      'Opens under the toolbar icon'
    );
    expect(side('Full view')).toHaveAccessibleDescription(
      'Opens in its own tab'
    );
    for (const name of ['Compact view', 'Full view'] as const) {
      expect(side(name).querySelector('svg')).not.toBeNull();
    }
    const tick = (name: 'Compact view' | 'Full view') =>
      side(name).querySelector('[data-view-label] .material-symbols-outlined');
    expect(tick('Compact view')?.textContent).toBe('check');
    expect(tick('Full view')).toBeNull();

    await userEvent.click(side('Full view'));
    expect(side('Full view')).toHaveAttribute('aria-pressed', 'true');
    expect(tick('Full view')?.textContent).toBe('check');
    expect(tick('Compact view')).toBeNull();
  });

  test('a refused setPopup still saves the choice, and says so in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store } = await renderQuickAccess({
      action: { setPopupRejects: true },
    });
    await userEvent.click(side('Full view'));

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(store.getState().settingsDataState.defaultView).toBe('full');
    expect(savedSettings()).toMatchObject({ defaultView: 'full' });
  });
});
