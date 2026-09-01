import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';

// KAN-44. SettingsDetailsContainer assigns settingsOptionsDiv in five if/else
// branches and renders them all into one position, so nothing told React the
// panels are different things. It reconciled Display against Sync & Privacy
// instead of remounting, and recycled the first theme swatch's <button> into
// the Auto Sync button.
//
// That was visible because a swatch is hardcoded to LIGHT_THEME.PRIMARY_COLOR
// (#F5F7FA) -- a swatch shows its own theme, not the active one -- while
// Button declares `transition: background-color 0.2s`. On a dark theme the
// recycled node animated white -> black over 200ms.
//
// Asserting on node identity rather than on colour, deliberately: the colour is
// only the symptom, it needs a dark theme to be visible at all, and sampling a
// transition mid-flight in jsdom would be a timing test. Identity is the defect.

const renderOnDisplay = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DISPLAY));
    },
  });

describe('settings panel identity (KAN-44)', () => {
  test('does not recycle a theme swatch into the Auto Sync button', async () => {
    const { store, container } = await renderOnDisplay();

    // The five theme swatches are the only buttons on the Display panel.
    const swatches = [...container.querySelectorAll('button')];
    expect(swatches.length).toBeGreaterThan(0);
    const firstSwatch = swatches[0];

    act(() => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
    });

    const autoSync = (await screen.findByText(/^(On|Off)$/)).closest('button');
    expect(autoSync).not.toBeNull();

    // Unkeyed, React matches <button> to <button> at the same position and
    // hands the swatch's own node to Auto Sync, carrying its computed
    // background with it.
    expect(autoSync).not.toBe(firstSwatch);
  });

  // The general statement of the same defect: no node *inside* the panel should
  // survive a category change, because the two panels are not the same panel.
  // Without this, a fix that only special-cased buttons would still pass above.
  //
  // The component's own outer container is excluded on purpose -- it lives
  // outside the keyed Fragment and is meant to persist. Asserting on every node
  // in `container` instead was wrong and failed against the correct fix, with
  // that one div as the sole survivor.
  test('replaces the panel contents when the category changes', async () => {
    const { store, container } = await renderOnDisplay();

    const panelRoot = container.firstElementChild!;
    const before = new Set(panelRoot.querySelectorAll('*'));
    expect(before.size).toBeGreaterThan(0);

    act(() => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
    });

    const survivors = [...panelRoot.querySelectorAll('*')].filter((node) =>
      before.has(node)
    );

    expect(survivors).toEqual([]);
  });

  // The control: keying the panel must not break the panel. A fix that
  // remounted into an empty tree would satisfy both tests above.
  test('still renders the Sync panel after the switch', async () => {
    const { store } = await renderOnDisplay();

    act(() => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
    });

    expect(await screen.findByText('Auto Sync')).toBeTruthy();
    expect(screen.getByText(/^(On|Off)$/)).toBeTruthy();
  });
});
