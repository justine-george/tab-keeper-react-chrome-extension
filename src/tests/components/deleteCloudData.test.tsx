import { describe, expect, test, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
  displayToast: vi.fn(),
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
    expect(body.textContent).toMatch(/Auto Sync/);
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
