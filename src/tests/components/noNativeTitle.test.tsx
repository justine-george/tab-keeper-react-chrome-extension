import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSettingsPage,
  deviceIdReadFinished,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import {
  replaceState,
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-695. Chrome's native tooltip is gone: the tooltip text lives on
// data-tooltip and the app draws it. A leftover title would draw a second one.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Trip planning',
      tabs: [
        { tabId: 't-1', favicon: '', title: 'Fushimi', url: 'https://a.test/' },
      ],
    },
  ],
});

const nativeTitles = (root: Element) =>
  root.querySelectorAll('[title]:not(iframe)');

describe('no element asks Chrome for a native tooltip (KAN-695)', () => {
  test('home: the sync button and a session row carry data-tooltip, nothing carries title', async () => {
    const { container } = await renderWithProviders(<MainContainer />, {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(deviceIdReadFinished());
        store.dispatch(saveToTabContainerInternal(SESSION));
        store.dispatch(selectTabContainer('session-kyoto'));
      },
    });

    expect(nativeTitles(container)).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Sync unavailable' })
    ).toHaveAttribute('data-tooltip', 'Sync unavailable');
    const [date] = screen.getAllByText(/^(Created|Edited) /);
    expect(date.closest('[data-tooltip]')).not.toBeNull();
  });

  test('settings: the pane keeps its tooltips as data-tooltip, nothing carries title', async () => {
    const { container } = await renderWithProviders(<MainContainer />, {
      seedStore: (store) => {
        store.dispatch(openSettingsPage.fulfilled(undefined, '', undefined));
        store.dispatch(selectCategory(SettingsCategory.DISPLAY));
      },
    });

    expect(nativeTitles(container)).toHaveLength(0);
    // The swatch is named by its visible text: it never had a tooltip.
    expect(screen.getByRole('button', { name: 'Ink' })).not.toHaveAttribute(
      'data-tooltip'
    );
    expect(container.querySelector('[data-tooltip]')).not.toBeNull();
  });

  test('the export page: its toolbar buttons carry data-tooltip, nothing but the frame carries title', async () => {
    const { container } = await renderWithProviders(
      <ExportPage
        source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
        from="full"
      />,
      {
        seedStore: (store) => {
          store.dispatch(replaceState(buildContainer([SESSION])));
        },
      }
    );

    expect(nativeTitles(container)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute(
      'data-tooltip',
      'Light'
    );
  });
});
