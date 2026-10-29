import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

import { cloudDocumentExists } from '../../utils/functions/external';
import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { DeleteCloudDataModal } from '../../components/modals/DeleteCloudDataModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { CROSSFADE_MS } from '../../components/common/syncMotion';
import { asWritten } from '../setup/asWritten';
import { newestToast } from '../setup/toasts';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  askToDeleteCloudData,
  deleteCloudData,
  openDeleteCloudDataModal,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
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
        s.dispatch(grantCloudConsent());
      },
    });

    expect(screen.getByText('Cloud data')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Delete cloud data' });
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);

    await user.click(button);
    await waitFor(() =>
      expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(true)
    );
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
    // KAN-860. "turn sync off the next time they sync" read as a contradiction.
    expect(
      within(dialog).getByText(
        'This removes your sessions from the cloud and turns off Auto sync on this device. Your sessions stay here. Your other devices keep their sessions too, and stop syncing the next time they open Tab Keeper.'
      )
    ).toBeTruthy();
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

// KAN-719. A granted press reads the cloud first; the button says so once the
// read has taken longer than 300ms, and ignores presses until it ends.
describe('the Delete cloud data button while it checks or deletes (KAN-719, KAN-750)', () => {
  let resolveCheck: (exists: boolean) => void;

  beforeEach(() => {
    // No shouldAdvanceTime: real time must not push "299ms" past 300.
    vi.useFakeTimers();
    vi.mocked(cloudDocumentExists)
      .mockClear()
      .mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveCheck = resolve;
          })
      );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(cloudDocumentExists).mockReset().mockResolvedValue(true);
  });

  const flush = (ms = 0) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  const renderPane = (consent: 'granted' | 'declined') =>
    renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(
          consent === 'granted' ? grantCloudConsent() : declineCloudConsent()
        );
      },
    });

  const deleteButton = () =>
    screen.getByRole('button', { name: 'Delete cloud data' });
  const press = async () => {
    fireEvent.click(deleteButton());
    await flush();
  };
  const faceShown = () => deleteButton().getAttribute('data-second-face-shown');
  const dialogOpen = (store: Awaited<ReturnType<typeof renderPane>>['store']) =>
    store.getState().globalState.isDeleteCloudDataModalOpen;

  test('a check that ends before 300ms never shows Checking…', async () => {
    const { store } = await renderPane('granted');
    await press();
    expect(faceShown()).toBe('false');
    await flush(299);
    expect(faceShown()).toBe('false');

    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    expect(dialogOpen(store)).toBe(true);
    // The cleared timer must not fire late.
    await flush(1000);
    expect(faceShown()).toBe('false');
  });

  test('a check still running at 300ms shows Checking…, then clears', async () => {
    const { store } = await renderPane('granted');
    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(
      deleteButton().querySelector('[data-second-face]')
    ).toHaveTextContent('Checking…');
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');

    resolveCheck(false);
    await flush();
    expect(faceShown()).toBe('false');
    expect(deleteButton()).not.toHaveAttribute('aria-disabled');
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
    );
    expect(dialogOpen(store)).toBe(false);
  });

  test('a check past 300ms that finds a document clears the face as the dialog opens', async () => {
    const { store } = await renderPane('granted');
    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(dialogOpen(store)).toBe(false);

    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    expect(dialogOpen(store)).toBe(true);
    expect(deleteButton()).not.toHaveAttribute('aria-disabled');
  });

  test('presses during the check start no second check', async () => {
    await renderPane('granted');
    await press();
    await press();
    await press();
    expect(cloudDocumentExists).toHaveBeenCalledTimes(1);
    resolveCheck(true);
    await flush();
  });

  test('the busy label keeps its ink', async () => {
    await renderPane('granted');
    await press();
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');
    // jsdom keeps the clicked button :hover; the pointer leaves, then the
    // Checking… face appears (300ms), which also refreshes the computed style.
    fireEvent.mouseOut(deleteButton());
    await flush(300);
    expect(faceShown()).toBe('true');
    const ink = getComputedStyle(deleteButton()).color;
    expect(ink).toMatch(asWritten(LIGHT_THEME.DANGER_INK));
    expect(ink).not.toMatch(asWritten(LIGHT_THEME.LABEL_L2_COLOR));
    resolveCheck(true);
    await flush();
  });

  test('the accessible name stays Delete cloud data while busy', async () => {
    await renderPane('granted');
    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Delete cloud data' })
    ).toBeTruthy();
    resolveCheck(true);
    await flush();
  });

  // KAN-750 r3 (D1). The busy face's glyph is the sync button's turning arrows.
  const busyGlyph = () => {
    const g = deleteButton().querySelector('[data-second-face] [data-glyph]');
    return {
      glyph: g?.getAttribute('data-glyph'),
      turning: g?.getAttribute('data-turning'),
    };
  };

  test('Checking… turns the sync arrows until its face has faded out', async () => {
    await renderPane('granted');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'false' });
    await press();
    await flush(299);
    expect(busyGlyph().turning).toBe('false');
    await flush(1);
    expect(faceShown()).toBe('true');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'true' });
    // Drawn arrows, not a font ligature.
    expect(
      deleteButton().querySelector(
        '[data-second-face] .material-symbols-outlined'
      )
    ).toBeNull();

    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    // Still turning while the face fades out, then still.
    await flush(CROSSFADE_MS - 1);
    expect(busyGlyph().turning).toBe('true');
    await flush(1);
    expect(busyGlyph().turning).toBe('false');
  });

  test('a second check turns the arrows again', async () => {
    await renderPane('granted');
    await press();
    await flush(300);
    resolveCheck(false);
    // The stop starts at the commit, which act holds to the end of its flush.
    await flush();
    await flush(CROSSFADE_MS);
    expect(busyGlyph().turning).toBe('false');

    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(busyGlyph().turning).toBe('true');
    resolveCheck(true);
    await flush();
  });

  // A check that outlives the pane leaves no timer behind to stop the arrows.
  test('a check that ends after the pane closes schedules nothing', async () => {
    const { unmount } = await renderPane('granted');
    await press();
    await flush(300);
    expect(busyGlyph().turning).toBe('true');
    unmount();
    await flush();
    const left = vi.getTimerCount();

    resolveCheck(true);
    await flush();
    expect(vi.getTimerCount()).toBe(left);
  });

  test('a pane closed while the face fades out leaves no timer', async () => {
    const { unmount } = await renderPane('granted');
    await press();
    await flush(300);
    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    expect(busyGlyph().turning).toBe('true');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a press while the face fades out keeps the arrows turning', async () => {
    await renderPane('granted');
    await press();
    await flush(300);
    resolveCheck(false);
    await flush();
    await flush(CROSSFADE_MS / 2);
    await press();
    await flush(CROSSFADE_MS);
    expect(busyGlyph().turning).toBe('true');
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(busyGlyph().turning).toBe('true');
    resolveCheck(true);
    await flush();
  });

  // KAN-750 R20. The check runs in the store; the pane is only its view.
  const switchPane = (
    store: Awaited<ReturnType<typeof renderPane>>['store'],
    to: SettingsCategory
  ) =>
    act(() => {
      store.dispatch(selectCategory(to));
    });

  test('back on the pane mid-check, Checking… still turns and a press starts nothing', async () => {
    const { store } = await renderPane('granted');
    await press();
    await flush(300);
    expect(busyGlyph().turning).toBe('true');

    switchPane(store, SettingsCategory.DISPLAY);
    expect(
      screen.queryByRole('button', { name: 'Delete cloud data' })
    ).toBeNull();
    await flush(100);
    switchPane(store, SettingsCategory.SYNC);
    expect(faceShown()).toBe('true');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'true' });
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');
    await press();
    expect(cloudDocumentExists).toHaveBeenCalledTimes(1);

    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    expect(dialogOpen(store)).toBe(true);
  });

  test('back on the pane before 300ms, Checking… still waits out the 300ms', async () => {
    const { store } = await renderPane('granted');
    await press();
    await flush(100);
    switchPane(store, SettingsCategory.DISPLAY);
    await flush(50);
    switchPane(store, SettingsCategory.SYNC);
    expect(faceShown()).toBe('false');
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');
    await flush(149);
    expect(faceShown()).toBe('false');
    await flush(1);
    expect(faceShown()).toBe('true');
    expect(busyGlyph().turning).toBe('true');
    resolveCheck(true);
    await flush();
  });

  test('under reduced motion Checking… shows the arrows still', async () => {
    const media = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation(
        (query: string) =>
          new FakeMediaQueryList(
            query,
            query === '(prefers-reduced-motion: reduce)'
          )
      );
    await renderPane('granted');
    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'false' });
    resolveCheck(true);
    await flush();
    media.mockRestore();
  });

  test('declined: the dialog opens with no check and no face', async () => {
    const { store } = await renderPane('declined');
    await press();
    expect(dialogOpen(store)).toBe(true);
    expect(cloudDocumentExists).not.toHaveBeenCalled();
    expect(faceShown()).toBe('false');
  });

  // KAN-750. The delete after the confirm: the same face, saying "Deleting…".
  const busyText = () =>
    deleteButton().querySelector('[data-second-face]')?.textContent;
  const confirm = async (
    store: Awaited<ReturnType<typeof renderPane>>['store']
  ) => {
    act(() => {
      void store.dispatch(deleteCloudData());
    });
    await flush();
  };

  test('a delete still running at 300ms shows Deleting… with the arrows turning, until its face fades out', async () => {
    const { store } = await renderPane('declined');
    await press();
    expect(dialogOpen(store)).toBe(true);
    await confirm(store);
    expect(dialogOpen(store)).toBe(false);
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');
    await flush(299);
    expect(faceShown()).toBe('false');
    await flush(1);
    expect(faceShown()).toBe('true');
    expect(busyText()).toBe('Deleting…');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'true' });

    resolveCheck(true);
    await flush();
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETED
    );
    expect(faceShown()).toBe('false');
    expect(deleteButton()).not.toHaveAttribute('aria-disabled');
    // Fading out, it still says what it was doing.
    expect(busyText()).toBe('Deleting…');
    await flush(CROSSFADE_MS - 1);
    expect(busyGlyph().turning).toBe('true');
    await flush(1);
    expect(busyGlyph().turning).toBe('false');
  });

  test('a delete that ends before 300ms never shows Deleting…', async () => {
    const { store } = await renderPane('declined');
    await press();
    await confirm(store);
    await flush(299);
    resolveCheck(false);
    await flush();
    expect(faceShown()).toBe('false');
    await flush(1000);
    expect(faceShown()).toBe('false');
    expect(busyGlyph().turning).toBe('false');
  });

  test('a check after a delete says Checking… again', async () => {
    const { store } = await renderPane('declined');
    await press();
    await confirm(store);
    await flush(300);
    expect(busyText()).toBe('Deleting…');
    resolveCheck(false);
    await flush();
    act(() => {
      store.dispatch(grantCloudConsent());
    });

    await press();
    await flush(300);
    expect(faceShown()).toBe('true');
    expect(busyText()).toBe('Checking…');
    resolveCheck(false);
    await flush();
  });

  test('back on the pane mid-delete, Deleting… still turns and a press starts nothing', async () => {
    mocks.deleteFromFirestore.mockClear();
    const { store } = await renderPane('declined');
    await press();
    await confirm(store);
    await flush(300);
    switchPane(store, SettingsCategory.DISPLAY);
    await flush(100);
    switchPane(store, SettingsCategory.SYNC);
    expect(faceShown()).toBe('true');
    expect(busyText()).toBe('Deleting…');
    expect(busyGlyph()).toEqual({ glyph: 'sync', turning: 'true' });
    expect(deleteButton()).toHaveAttribute('aria-disabled', 'true');
    await press();
    expect(store.getState().globalState.deleteCheckStartedAt).toBeNull();
    expect(cloudDocumentExists).toHaveBeenCalledTimes(1);

    resolveCheck(true);
    await flush();
    expect(faceShown()).toBe('false');
    expect(mocks.deleteFromFirestore).toHaveBeenCalledTimes(1);
  });
});

// KAN-750 R20. Whether a delete check is running is the store's, so every view of it agrees.
describe('the store knows when a delete check runs', () => {
  afterEach(() => {
    vi.mocked(cloudDocumentExists).mockReset().mockResolvedValue(true);
  });

  const running = (
    store: Awaited<ReturnType<typeof renderWithProviders>>['store']
  ) => store.getState().globalState.deleteCheckStartedAt !== null;

  async function check(
    seed: (s: Awaited<ReturnType<typeof renderWithProviders>>['store']) => void
  ) {
    let finish: () => void = () => {};
    const { store } = await renderWithProviders(<div />, { seedStore: seed });
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(cloudDocumentExists).mockImplementation(async () => {
      await held;
      return mockedExists();
    });
    expect(running(store)).toBe(false);
    const done = store.dispatch(askToDeleteCloudData());
    const during = running(store);
    finish();
    await done;
    return { store, during };
  }
  let mockedExists: () => boolean = () => true;

  const signedInWithConsent = (
    s: Awaited<ReturnType<typeof renderWithProviders>>['store']
  ) => {
    s.dispatch(setSignedIn());
    s.dispatch(setUserId('uuid-1'));
    s.dispatch(grantCloudConsent());
  };

  test('a check that finds a document: running until the dialog opens', async () => {
    mockedExists = () => true;
    const { store, during } = await check(signedInWithConsent);
    expect(during).toBe(true);
    expect(running(store)).toBe(false);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(true);
  });

  test('a check that finds none: running until its toast', async () => {
    mockedExists = () => false;
    const { store, during } = await check(signedInWithConsent);
    expect(during).toBe(true);
    expect(running(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
    );
  });

  test('a check that throws: running until its toast', async () => {
    mockedExists = () => {
      throw new Error('offline');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, during } = await check(signedInWithConsent);
    expect(during).toBe(true);
    expect(running(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
    warn.mockRestore();
  });

  test('no id to check, or no cloud check at all: running, then not', async () => {
    const noId = await check(() => {});
    expect(noId.during).toBe(true);
    expect(running(noId.store)).toBe(false);

    const declined = await check((s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setUserId('uuid-1'));
      s.dispatch(declineCloudConsent());
    });
    expect(declined.during).toBe(true);
    expect(running(declined.store)).toBe(false);
    expect(
      declined.store.getState().globalState.isDeleteCloudDataModalOpen
    ).toBe(true);
  });
});
