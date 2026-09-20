import { describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  Theme,
  setTheme,
  toggleAutoSync,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-88. Two settings controls knew their own state and never said it.
//
//  * The on/off toggles rendered their VALUE as their entire visible text
//    ("On"), with the setting's name in an unassociated sibling label -- so
//    the accessible name was "On", announced with no indication of what was on.
//  * The five theme swatches were identical in every respect a user or a
//    screen reader could perceive: same border colour, no ARIA state. Nothing
//    marked the active theme.

const renderOn = (category: SettingsCategory) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(category));
    },
  });

// KAN-248 replaced the Sync panel's single "On" button with a SlidingPair:
// a group named for the setting, holding one real button per side. KAN-88's
// concern -- the name must say WHICH setting -- is now met by the group's
// name, and Label in Name (WCAG 2.5.3) by each side being named its own
// visible word. Found by role, because the structure is what is under test.
const autoSyncPair = () => screen.getByRole('group', { name: 'Auto Sync' });
const side = (word: 'On' | 'Off') =>
  within(autoSyncPair()).getByRole('button', { name: word });

describe('settings toggles say which setting they control (KAN-88)', () => {
  test('the pair is named for the setting, and each side for its own word', async () => {
    await renderOn(SettingsCategory.SYNC);

    // The setting's name is on the group, not on a sibling label the
    // buttons are unassociated with.
    expect(autoSyncPair()).toHaveAccessibleName('Auto Sync');
    // Each side's name IS its visible text, so "click On" hits it.
    expect(side('On')).toHaveAccessibleName('On');
    expect(side('Off')).toHaveAccessibleName('Off');
  });

  test('the value is exposed as STATE, and flips when toggled', async () => {
    const { store } = await renderOn(SettingsCategory.SYNC);

    expect(side('On').getAttribute('aria-pressed')).toBe('true');
    expect(side('Off').getAttribute('aria-pressed')).toBe('false');

    act(() => {
      store.dispatch(toggleAutoSync());
    });

    expect(side('On').getAttribute('aria-pressed')).toBe('false');
    expect(side('Off').getAttribute('aria-pressed')).toBe('true');
  });

  test('activating the other side toggles the setting exactly once', async () => {
    const user = userEvent.setup();
    const { store } = await renderOn(SettingsCategory.SYNC);
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);

    await user.click(side('Off'));
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);

    // The pressed side, from the keyboard, is a no-op (KAN-225): a screen
    // reader announces nothing for a pressed button, so it must not flip.
    side('Off').focus();
    await user.keyboard(' ');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
  });

  // The other two toggles live on a different panel and were the same defect.
  //
  // Note the first expectation. The code passes t('Lazy Load Tabs'), but `en`
  // RE-MAPS that key to "Optimize Memory Usage On Session Restore" -- an i18n
  // key in this repo is not its own display string. Asserting the key here
  // would fail against entirely correct code, which is what it did on the
  // first run. Always assert the rendered VALUE.
  test('the Data Management toggles are named too', async () => {
    const { container } = await renderOn(SettingsCategory.DATA_MANAGEMENT);

    const names = [...container.querySelectorAll('button')]
      .filter((b) => /^(On|Off)$/.test(b.textContent?.trim() ?? ''))
      .map((b) => b.getAttribute('aria-label'));

    expect(names).toEqual([
      'Optimize Memory Usage On Session Restore: On',
      'Save Tab Groups: Off',
    ]);
  });
});

describe('the theme picker marks the active theme (KAN-88)', () => {
  // The five swatches are the only buttons on the Display panel.
  const swatches = (container: HTMLElement) => [
    ...container.querySelectorAll('button'),
  ];

  test('exactly one swatch is pressed, and it is the active theme', async () => {
    const { container, store } = await renderOn(SettingsCategory.DISPLAY);

    act(() => {
      store.dispatch(setTheme(Theme.BB_PINK));
    });

    const pressed = swatches(container).filter(
      (b) => b.getAttribute('aria-pressed') === 'true'
    );
    expect(pressed).toHaveLength(1);
    // The name is the button's visible text and accessible name (KAN-237);
    // it used to be a title and nothing else.
    expect(pressed[0]).toHaveAccessibleName('Petal');

    // Every other swatch must say so explicitly rather than be silent: an
    // absent aria-pressed reads as "not a toggle", not as "not selected".
    const unpressed = swatches(container).filter(
      (b) => b.getAttribute('aria-pressed') === 'false'
    );
    expect(unpressed).toHaveLength(4);
  });

  test('the pressed swatch follows the theme', async () => {
    const { container, store } = await renderOn(SettingsCategory.DISPLAY);

    const activeTitle = () =>
      swatches(container)
        .find((b) => b.getAttribute('aria-pressed') === 'true')
        ?.textContent?.trim();

    act(() => {
      store.dispatch(setTheme(Theme.DARKENHEIMER));
    });
    expect(activeTitle()).toBe('Graphite');

    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });
    expect(activeTitle()).toBe('Ink');
  });

  // The visual half. A screen reader gets aria-pressed; a sighted user needs
  // something drawn, and before this there was nothing at all.
  //
  // Asserted as "the active swatch is marked and no other is", not as a
  // specific colour: the marker is drawn in the active theme's own
  // LABEL_L3_COLOR, so pinning the value would make this a change detector for
  // the palette.
  //
  // The marker was an outline until KAN-95 and is now the swatch's own border,
  // thickened -- an outline is drawn OUTSIDE the box and collided with the
  // neighbouring swatches, and TEXT_COLOR made it far louder than the passive
  // state it marks. Since KAN-237 the swatch is a button holding a TILE and a
  // name, and the frame -- and so the marker -- is the tile's.
  //
  // Read through the `border` SHORTHAND, for the same jsdom reason the outline
  // was: jsdom fills a shorthand it was given but does not reliably decompose
  // it into longhands, so an assertion on borderWidth can fail against correct
  // code. The real-browser widths are pinned by
  // e2e/theme-swatch-marker.spec.ts, which is also the only place the
  // no-resize guarantee can be measured at all.
  test('the active swatch is the only one marked', async () => {
    const { container, store } = await renderOn(SettingsCategory.DISPLAY);

    act(() => {
      store.dispatch(setTheme(Theme.LIGHT));
    });

    const marked = swatches(container).filter((b) =>
      /(^|\s)2px(\s|$)/.test(
        getComputedStyle(b.querySelector('[data-theme-tile]')!).borderWidth
      )
    );

    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAccessibleName('Paper');

    // The marker must move with the theme, not just exist somewhere.
    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });
    const moved = swatches(container).filter((b) =>
      /(^|\s)2px(\s|$)/.test(
        getComputedStyle(b.querySelector('[data-theme-tile]')!).borderWidth
      )
    );
    expect(moved).toHaveLength(1);
    expect(moved[0]).toHaveAccessibleName('Ink');
  });
});
