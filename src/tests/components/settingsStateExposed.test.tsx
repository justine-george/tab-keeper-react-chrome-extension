import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

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

// The button whose visible text is the toggle's value. Found by text rather
// than by role+name, because the name is exactly what is under test here --
// querying by the name would assume the answer.
const toggleButton = (container: HTMLElement): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].filter((b) =>
    /^(On|Off)$/.test(b.textContent?.trim() ?? '')
  );
  expect(found).toHaveLength(1);
  return found[0];
};

describe('settings toggles say which setting they control (KAN-88)', () => {
  test('the accessible name carries the setting AND its value', async () => {
    const { container } = await renderOn(SettingsCategory.SYNC);
    const toggle = toggleButton(container);

    const name = toggle.getAttribute('aria-label');
    expect(name).toBe('Auto Sync: On');

    // WCAG 2.5.3 Label in Name: the accessible name must CONTAIN the visible
    // text. This is why the name is "<setting>: <value>" and not the setting
    // alone -- a bare "Auto Sync" over a button reading "On" would name the
    // control correctly and still fail, leaving a voice-control user saying
    // "click On" with nothing to hit.
    expect(name!.toLowerCase()).toContain(
      toggle.textContent!.trim().toLowerCase()
    );
  });

  test('the value is exposed as STATE, and flips when toggled', async () => {
    const { container, store } = await renderOn(SettingsCategory.SYNC);

    expect(toggleButton(container).getAttribute('aria-pressed')).toBe('true');

    act(() => {
      store.dispatch(toggleAutoSync());
    });

    // Both have to move together. aria-pressed carries the state for a screen
    // reader; the name carries it for voice control and for the visible label.
    const after = toggleButton(container);
    expect(after.getAttribute('aria-pressed')).toBe('false');
    expect(after.getAttribute('aria-label')).toBe('Auto Sync: Off');
    expect(after.textContent!.trim()).toBe('Off');
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
    expect(pressed[0].getAttribute('title')).toBe('BB Pink');

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
        ?.getAttribute('title');

    act(() => {
      store.dispatch(setTheme(Theme.DARKENHEIMER));
    });
    expect(activeTitle()).toBe('Darkenheimer');

    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });
    expect(activeTitle()).toBe('Blue');
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
  // state it marks.
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
      /(^|\s)2px(\s|$)/.test(getComputedStyle(b).borderWidth)
    );

    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('title')).toBe('Light');

    // The marker must move with the theme, not just exist somewhere.
    act(() => {
      store.dispatch(setTheme(Theme.BLUE));
    });
    const moved = swatches(container).filter((b) =>
      /(^|\s)2px(\s|$)/.test(getComputedStyle(b).borderWidth)
    );
    expect(moved).toHaveLength(1);
    expect(moved[0].getAttribute('title')).toBe('Blue');
  });
});
