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
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';

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

// What Chrome holds, asked the way hasTabGroupsPermission() asks: through the
// installed fake's own API, not a recorder beside it.
const has = () =>
  new Promise<boolean>((r) =>
    chrome.permissions.contains({ permissions: ['tabGroups'] }, r)
  );
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

  // The other two toggles live on a different panel and were the same defect,
  // and became pairs after Auto Sync did (KAN-249).
  //
  // Note the first group's name. The code passes t('Lazy Load Tabs'), but
  // `en` RE-MAPS that key to "Optimize Memory Usage On Session Restore" -- an
  // i18n key in this repo is not its own display string. Asserting the key
  // here would fail against entirely correct code, which is what it did on
  // the first run. Always assert the rendered VALUE.
  // The other toggle lives on the Data Management panel and was the same
  // defect; it became a pair after Auto Sync did (KAN-249). The memory
  // setting that sat above it is gone (KAN-250): restores always open later
  // tabs as placeholders, so there is nothing to choose.
  test('Data Management has one pair, Save Tab Groups, and no memory setting', async () => {
    await renderOn(SettingsCategory.DATA_MANAGEMENT);

    const groups = screen.getByRole('group', { name: 'Save Tab Groups' });
    expect(
      within(groups)
        .getByRole('button', { name: 'Off' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(
      screen.queryByText('Optimize Memory Usage On Session Restore')
    ).toBeNull();
    // No "<setting>: <value>" names survive: the group carries the setting.
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? '').not.toMatch(/: (On|Off)$/);
    }
  });

  // Save Tab Groups is not a store toggle: On asks Chrome for the permission,
  // Off gives it back, and the pressed side follows hasTabGroupsPermission,
  // which the change listener (or the next popup open) writes. Nothing here
  // subscribes, so the knob does not move; what is asserted is what Chrome
  // was asked, read back from the fake. Two renders, because a pointer on the
  // pressed side flips the pair (KAN-218): with the store still saying Off,
  // clicking Off would be another request, not a removal.
  test('from Off, pressing On asks Chrome for the tab-groups permission', async () => {
    const user = userEvent.setup();
    await renderOn(SettingsCategory.DATA_MANAGEMENT);
    expect(await has()).toBe(false);

    await user.click(
      within(screen.getByRole('group', { name: 'Save Tab Groups' })).getByRole(
        'button',
        { name: 'On' }
      )
    );
    expect(await has()).toBe(true);
  });

  test('from On, pressing Off gives the tab-groups permission back', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<SettingsDetailsContainer />, {
      seed: { grantedPermissions: ['tabGroups'] },
      seedStore: (store) => {
        store.dispatch(selectCategory(SettingsCategory.DATA_MANAGEMENT));
        store.dispatch(setHasTabGroupsPermission(true));
      },
    });
    expect(await has()).toBe(true);
    const groups = screen.getByRole('group', { name: 'Save Tab Groups' });
    expect(
      within(groups)
        .getByRole('button', { name: 'On' })
        .getAttribute('aria-pressed')
    ).toBe('true');

    await user.click(within(groups).getByRole('button', { name: 'Off' }));
    expect(await has()).toBe(false);
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
