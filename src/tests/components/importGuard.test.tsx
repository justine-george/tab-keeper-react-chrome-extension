import { describe, expect, test, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { TabMasterContainer } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-27, the wiring half. local.test.ts proves readImportedContainer refuses an
// oversized backup; these prove the import handler actually calls it, and that a
// refusal leaves the store untouched rather than half-applied.
//
// Driving the real handler means intercepting the <input type="file"> it builds
// on the fly: it is created, wired and clicked inside handleImportJSON and never
// rendered, so there is nothing in the tree to select. Spying on createElement
// is the only seam that does not require changing production code to be testable.
const captureFileInput = () => {
  const inputs: HTMLInputElement[] = [];
  const real = document.createElement.bind(document);

  vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions
  ) => {
    const el = real(tagName, options);
    if (tagName === 'input') {
      // click() on a real file input would try to open the OS picker; the
      // handler only calls it to prompt, so a no-op keeps jsdom quiet.
      (el as HTMLInputElement).click = () => {};
      inputs.push(el as HTMLInputElement);
    }
    return el;
  }) as typeof document.createElement);

  return inputs;
};

const dropFile = (input: HTMLInputElement, text: string) => {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  // The handler reads `(event.target as HTMLInputElement).files![0]`, so the
  // event only has to carry that much shape.
  input.onchange?.({ target: { files: [file] } } as unknown as Event);
};

const renderDataManagement = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.DATA_MANAGEMENT));
    },
  });

const buildOversizedBackup = (): string => {
  const container: TabMasterContainer = {
    lastModified: 1,
    selectedTabGroupId: null,
    tabGroups: [
      {
        tabGroupId: 'group-0',
        // A title, not a favicon: favicons are stripped before measuring, so
        // padding one would prove nothing about the guard.
        title: 'x'.repeat(1_200_000),
        createdTime: '2026-09-01 12:00:00',
        windowCount: 0,
        tabCount: 0,
        isAutoSave: false,
        isSelected: false,
        windows: [],
      },
    ],
  };
  return JSON.stringify(container);
};

const buildSmallBackup = (): string =>
  JSON.stringify({
    lastModified: 1,
    selectedTabGroupId: 'group-0',
    tabGroups: [
      {
        tabGroupId: 'group-0',
        title: 'Imported session',
        createdTime: '2026-09-01 12:00:00',
        windowCount: 1,
        tabCount: 1,
        isAutoSave: false,
        isSelected: true,
        windows: [
          {
            windowId: 'window-0',
            windowHeight: 600,
            windowWidth: 800,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 1,
            title: 'Imported window',
            tabs: [
              {
                tabId: 'tab-0',
                favicon: '',
                title: 'Imported tab',
                url: 'https://example.com/',
              },
            ],
          },
        ],
      },
    ],
  } satisfies TabMasterContainer);

describe('import size guard (KAN-27)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('refuses an oversized backup and leaves the store untouched', async () => {
    const inputs = captureFileInput();
    const { store } = await renderDataManagement();

    await userEvent.click(
      await screen.findByText('Restore App Data from File')
    );
    dropFile(inputs[0], buildOversizedBackup());

    await waitFor(() => {
      expect(store.getState().globalState.toastText).toMatch(
        /too large to sync/i
      );
    });

    // The half-applied state this guard exists to prevent: restoreContainer
    // writes localStorage synchronously, so a container that got that far would
    // be persisted and would then wedge sync permanently.
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(0);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // The control. Without this, a guard that rejected every import would pass
  // the test above.
  test('still imports a backup that fits', async () => {
    const inputs = captureFileInput();
    const { store } = await renderDataManagement();

    await userEvent.click(
      await screen.findByText('Restore App Data from File')
    );
    dropFile(inputs[0], buildSmallBackup());

    await waitFor(() => {
      expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(1);
    });
    expect(store.getState().globalState.toastText).toMatch(/successfully/i);
  });
});
