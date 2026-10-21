import { describe, expect, test, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  deleteFromFirestore: vi.fn<(userId: string) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  deleteFromFirestore: mocks.deleteFromFirestore,
  ensureCloudSessionReady: vi.fn(async () => undefined),
  // KAN-719. The confirm reads before it deletes.
  cloudDocumentExists: vi.fn(async () => true),
}));

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { DeleteCloudDataModal } from '../../components/modals/DeleteCloudDataModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  openDeleteCloudDataModal,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setAutoSync,
  setLastSyncedTime,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-254. Settings -> Sync & Backup gets a "Delete cloud data" action behind
// a confirm dialog. The pane test pins that the button opens the dialog and
// nothing else; the dialog tests pin that Cancel changes nothing and Confirm
// deletes exactly once. What the delete does to the store is
// deleteCloudData.test.ts's.

describe('the Sync & Backup pane offers Delete cloud data (KAN-254)', () => {
  test('a danger button under its own heading, which opens the dialog', async () => {
    const user = userEvent.setup();
    const { store } = await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
      },
    });

    expect(screen.getByText('Cloud data')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Delete cloud data' });
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);

    await user.click(button);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(true);
    // Opening asks; it does not delete.
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
  });
});

describe('the Delete cloud data dialog (KAN-254)', () => {
  const renderOpen = () =>
    renderWithProviders(<DeleteCloudDataModal />, {
      seedStore: (s) => {
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(openDeleteCloudDataModal());
      },
    });

  test('says what will happen, including the part the user cannot see', async () => {
    await renderOpen();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete your cloud data?');
    const body = within(dialog).getByText(/other devices/i);
    expect(body.textContent).toMatch(/Auto sync/);
    expect(body.textContent).toMatch(/stay on this device/);
  });

  test('Cancel comes first, and closes without deleting', async () => {
    const user = userEvent.setup();
    const { store } = await renderOpen();
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Cancel');

    await user.click(buttons[0]);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
  });

  test('Delete deletes once, and the dialog closes', async () => {
    mocks.deleteFromFirestore.mockClear();
    const user = userEvent.setup();
    const { store } = await renderOpen();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
    );
    expect(mocks.deleteFromFirestore).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
  });
});

// KAN-573. With nothing left in the cloud, the card must not still say when it last synced.
// KAN-632. Nor read as manual sync with a sync bar: the yes is gone, so it reads like a device that never said it.
describe('after Delete cloud data, Sync Status (KAN-573, KAN-632)', () => {
  for (const isAutoSync of [true, false]) {
    test(`Auto Sync ${isAutoSync ? 'on' : 'off'}: no "Last synced" time, no sync bar, and the card says sync is off`, async () => {
      const user = userEvent.setup();
      await renderWithProviders(
        <>
          <SettingsDetailsContainer />
          <DeleteCloudDataModal />
        </>,
        {
          seedStore: (s) => {
            s.dispatch(selectCategory(SettingsCategory.SYNC));
            s.dispatch(setSignedIn());
            s.dispatch(setUserId('uuid-1'));
            s.dispatch(grantCloudConsent());
            s.dispatch(setAutoSync(isAutoSync));
            s.dispatch(setLastSyncedTime(Date.UTC(2026, 9, 12, 5, 5, 40)));
          },
        }
      );
      const card = screen.getByTestId('sync-status');
      // PREMISE: the time and the bar show before the delete (manual shows them; on needs a cloud this build lacks).
      if (!isAutoSync) {
        expect(card.querySelector('[data-sync-synced]')).not.toBeNull();
        expect(screen.getByTestId('sync-space')).toBeInTheDocument();
      }

      await user.click(
        screen.getByRole('button', { name: 'Delete cloud data' })
      );
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete',
        })
      );

      await waitFor(() =>
        expect(card).toHaveAttribute('data-sync-state', 'off')
      );
      expect(card.querySelector('[data-sync-synced]')).toBeNull();
      expect(card.textContent).not.toMatch(/Last synced/);
      expect(screen.queryByTestId('sync-space')).toBeNull();
    });
  }
});
