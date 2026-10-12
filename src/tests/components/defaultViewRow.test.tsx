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

// KAN-7 §7. Settings → Sessions → Default view: a pair whose choice is saved
// first, then mirrored for the worker, then applied with setPopup.

const renderSessions = (seed: ChromeSeed = { action: {} }) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
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
  test('sits between tab history and Pin Tab Keeper in new windows, with Compact pressed', async () => {
    const { container } = await renderSessions();
    expect(sectionLabels(container)).toEqual([
      'Save Tab Groups',
      'Bring back tab history when reopening',
      'Default view',
      'Pin Tab Keeper in new windows',
      'Keyboard shortcut',
    ]);
    expect(side('Compact view')).toHaveAttribute('aria-pressed', 'true');
    expect(side('Full view')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a refused setPopup still saves the choice, and says so in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store } = await renderSessions({
      action: { setPopupRejects: true },
    });
    await userEvent.click(side('Full view'));

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(store.getState().settingsDataState.defaultView).toBe('full');
    expect(savedSettings()).toMatchObject({ defaultView: 'full' });
  });
});
