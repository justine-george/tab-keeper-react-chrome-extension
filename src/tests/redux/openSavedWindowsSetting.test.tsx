import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { asOpenSavedWindowsIn } from '../../redux/slices/settingsDataStateSlice';

// KAN-892. Settings → Sessions → Open saved windows: New window or This window, device-local.
const freshSlice = async () => {
  vi.resetModules();
  return import('../../redux/slices/settingsDataStateSlice');
};

afterEach(() => localStorage.clear());

describe('asOpenSavedWindowsIn', () => {
  it('reads anything but the two values as new-window', () => {
    expect(asOpenSavedWindowsIn('this-window')).toBe('this-window');
    expect(asOpenSavedWindowsIn('new-window')).toBe('new-window');
    for (const v of [undefined, null, 'This window', 1, true, {}]) {
      expect(asOpenSavedWindowsIn(v)).toBe('new-window');
    }
  });
});

describe('openSavedWindowsIn in the store', () => {
  it('is new-window for a new install and for settings written before it existed', async () => {
    expect((await freshSlice()).initialState.openSavedWindowsIn).toBe(
      'new-window'
    );
    localStorage.setItem('settingsData', JSON.stringify({ theme: 'Blue' }));
    expect((await freshSlice()).initialState).toMatchObject({
      theme: 'Blue',
      openSavedWindowsIn: 'new-window',
    });
  });

  it('keeps a saved this-window, and reads a malformed one as new-window', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ openSavedWindowsIn: 'this-window' })
    );
    expect((await freshSlice()).initialState.openSavedWindowsIn).toBe(
      'this-window'
    );
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ openSavedWindowsIn: 'This window' })
    );
    expect((await freshSlice()).initialState.openSavedWindowsIn).toBe(
      'new-window'
    );
  });

  it('setOpenSavedWindowsIn changes it and saves it', async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { setOpenSavedWindowsIn } =
      await import('../../redux/slices/settingsDataStateSlice');
    const { store } = makeTestStore();
    store.dispatch(setOpenSavedWindowsIn('this-window'));
    expect(store.getState().settingsDataState.openSavedWindowsIn).toBe(
      'this-window'
    );
    expect(
      JSON.parse(localStorage.getItem('settingsData') ?? '{}')
    ).toMatchObject({ openSavedWindowsIn: 'this-window' });
  });
});

describe('another page writing it', () => {
  const setup = async () => {
    vi.resetModules();
    const { makeTestStore } = await import('../setup/makeStore');
    const { applyOtherPageSettings } =
      await import('../../redux/otherPageChanges');
    const { setOpenSavedWindowsIn } =
      await import('../../redux/slices/settingsDataStateSlice');
    return {
      ...makeTestStore(),
      applyOtherPageSettings,
      setOpenSavedWindowsIn,
    };
  };

  it('takes this-window', async () => {
    const { store, applyOtherPageSettings } = await setup();
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        openSavedWindowsIn: 'this-window',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.openSavedWindowsIn).toBe(
      'this-window'
    );
  });

  it('a write without the key keeps this page’s value', async () => {
    const { store, applyOtherPageSettings, setOpenSavedWindowsIn } =
      await setup();
    store.dispatch(setOpenSavedWindowsIn('this-window'));
    const older = Object.fromEntries(
      Object.entries(store.getState().settingsDataState).filter(
        ([key]) => key !== 'openSavedWindowsIn'
      )
    );
    // PREMISE: the write differs from this page only in the theme, and lacks the key.
    expect(store.getState().settingsDataState.theme).not.toBe('Blue');
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ ...older, theme: 'Blue' })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState).toMatchObject({
      theme: 'Blue',
      openSavedWindowsIn: 'this-window',
    });
  });

  it('reads a malformed value as new-window', async () => {
    const { store, applyOtherPageSettings, setOpenSavedWindowsIn } =
      await setup();
    store.dispatch(setOpenSavedWindowsIn('this-window'));
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...store.getState().settingsDataState,
        openSavedWindowsIn: 'This window',
      })
    );
    store.dispatch(applyOtherPageSettings());
    expect(store.getState().settingsDataState.openSavedWindowsIn).toBe(
      'new-window'
    );
  });
});

describe('Settings › Sessions › Open saved windows', () => {
  const HELP =
    'Used by Open on a saved window or session. The other way is in the ⋮ menu.';
  const renderSessions = () =>
    renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (store) => {
        store.dispatch(selectCategory(SettingsCategory.SESSIONS));
      },
    });

  it('defaults to New window, stores This window when picked, and is described by its help line', async () => {
    const user = userEvent.setup();
    const { store } = await renderSessions();
    const pair = screen.getByRole('group', { name: 'Open saved windows' });
    expect(
      within(pair).getByRole('button', { name: 'New window' })
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(pair).getByRole('button', { name: 'This window' }));
    expect(store.getState().settingsDataState.openSavedWindowsIn).toBe(
      'this-window'
    );
    expect(
      within(pair).getByRole('button', { name: 'This window' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(pair).toHaveAccessibleDescription(HELP);
  });

  it('sits directly below Default save', async () => {
    const { container } = await renderSessions();
    const titles = [
      ...container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    ].map((s) => s.querySelector('span')?.textContent);
    const at = titles.indexOf('Default save');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(titles[at + 1]).toBe('Open saved windows');
  });
});
