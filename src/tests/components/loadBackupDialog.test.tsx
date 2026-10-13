import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toastTexts, newestToast } from '../setup/toasts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { LoadBackupModal } from '../../components/modals/LoadBackupModal';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { toggleAutoSync } from '../../redux/slices/settingsDataStateSlice';
import { setSignedIn, setUserId } from '../../redux/slices/globalStateSlice';
import { saveToFirestore } from '../../utils/functions/external';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-252 / KAN-261. "Load sessions from a backup" reads the file, then asks
// -- one dialog, two answers that change something. Replace throws away what
// is saved here first and cannot be undone (KAN-252 put the question in front
// of it). Merge keeps everything here and adds the file's sessions that are
// not here yet (KAN-261); it is additive, so it is undoable.
//
// Asked AFTER the file is read, not before the picker: an unreadable file
// still gets the error toast and no dialog, and a readable one gets a dialog
// that can say the real numbers. Nothing touches the store until an answer.

const captureFileInput = () => {
  const inputs: HTMLInputElement[] = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions
  ) => {
    const el = real(tagName, options);
    if (tagName === 'input') {
      (el as HTMLInputElement).click = () => {};
      inputs.push(el as HTMLInputElement);
    }
    return el;
  }) as typeof document.createElement);
  return inputs;
};

const dropFile = (input: HTMLInputElement, text: string, name: string) => {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file] });
  input.onchange?.(new Event('change'));
};

// KAN-579. The file step runs in the full view; the popup hands it there (backupButtons.test.tsx).
beforeEach(() => history.replaceState(null, '', '?view=tab'));
afterEach(() => history.replaceState(null, '', '?'));

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  buildSession({ tabGroupId: 'h2', title: 'Here two' }),
  buildSession({ tabGroupId: 'h3', title: 'Here three' }),
]);

const FROM_FILE = JSON.stringify(
  buildContainer([buildSession({ tabGroupId: 'f1', title: 'From the file' })])
);

const render = (
  saved = HERE,
  seed?: (s: RenderWithProvidersResult['store']) => void
) =>
  renderWithProviders(
    <>
      <SettingsDetailsContainer />
      <LoadBackupModal />
    </>,
    {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(replaceState(saved));
        seed?.(s);
      },
    }
  );

const pickBackup = async (
  inputs: HTMLInputElement[],
  name = 'backup.json',
  text = FROM_FILE
) => {
  await userEvent.click(await screen.findByText('Load sessions from a backup'));
  dropFile(inputs[0], text, name);
  return screen.findByRole('dialog', { name: /^Load .* from this backup\?$/ });
};

const titlesHere = (r: RenderWithProvidersResult) =>
  r.store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

const HERE_TITLES = ['Here one', 'Here two', 'Here three'];

describe('the load-backup dialog (KAN-252, KAN-261)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(saveToFirestore).mockReset();
  });

  test('Cancel closes the question and leaves everything as it was, with no toast', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titlesHere(r)).toEqual(HERE_TITLES);
    expect(r.store.getState().globalState.isDirty).toBe(false);
    expect(toastTexts(r.store.getState())).toEqual([]);
  });

  test('Replace applies the file in place of what was here and reports success', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Replace sessions' })
    );

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file']);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(newestToast(r.store.getState())?.text).toBe(
        TOAST_MESSAGES.IMPORT_SUCCESS
      );
    });
  });

  test('Merge adds the file on top of what was here and reports success', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Merge sessions' })
    );

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file', ...HERE_TITLES]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(newestToast(r.store.getState())?.text).toBe(
        TOAST_MESSAGES.IMPORT_SUCCESS
      );
    });
  });

  // KAN-257 through both answers. importGuard.test.tsx pins the Auto Sync
  // gate on the no-dialog path; these pin the same gate on the two paths the
  // dialog takes, so the three cannot drift apart.
  for (const answer of ['Replace sessions', 'Merge sessions'] as const) {
    test(`${answer} with Auto Sync off writes nothing and leaves the container dirty`, async () => {
      const inputs = captureFileInput();
      const r = await render(HERE, (s) => {
        s.dispatch(setSignedIn());
        s.dispatch(setUserId('uuid-1'));
        s.dispatch(toggleAutoSync());
      });
      expect(r.store.getState().settingsDataState.isAutoSync).toBe(false);
      const dialog = await pickBackup(inputs);

      await userEvent.click(
        within(dialog).getByRole('button', { name: answer })
      );

      await waitFor(() => {
        expect(titlesHere(r)).toContain('From the file');
      });
      expect(saveToFirestore).not.toHaveBeenCalled();
      expect(r.store.getState().globalState.isDirty).toBe(true);
    });
  }

  // A file whose sessions are all here already: Merge has nothing to add, so
  // it must not mark the container dirty -- that would schedule a cloud write
  // of nothing -- and the toast still says the load went fine.
  test('Merge with nothing new to add changes nothing and writes nothing', async () => {
    const inputs = captureFileInput();
    const r = await render(HERE, (s) => {
      s.dispatch(setSignedIn());
      s.dispatch(setUserId('uuid-1'));
    });
    const dialog = await pickBackup(inputs, 'same.json', JSON.stringify(HERE));

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Merge sessions' })
    );

    await waitFor(() => {
      expect(newestToast(r.store.getState())?.text).toBe(
        TOAST_MESSAGES.IMPORT_SUCCESS
      );
    });
    expect(titlesHere(r)).toEqual(HERE_TITLES);
    expect(r.store.getState().globalState.isDirty).toBe(false);
    expect(saveToFirestore).not.toHaveBeenCalled();
  });

  // A fresh install restoring a backup is the common case, and a question
  // whose two answers do the same thing is not a question.
  test('with nothing saved here, the backup applies without asking', async () => {
    const inputs = captureFileInput();
    const r = await render(buildContainer([]));

    await userEvent.click(
      await screen.findByText('Load sessions from a backup')
    );
    dropFile(inputs[0], FROM_FILE, 'backup.json');

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file']);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // KAN-265. The decision above was read from the render that handled the
  // click, but it runs inside reader.onload -- seconds later, after the OS
  // picker closes. A fresh device's boot sync can land the other device's
  // sessions in that window; the stale closure still saw nothing here,
  // Replaced without asking, and (KAN-262) buried every one of them
  // cloud-wide. Decide from the store at dispatch time.
  test('sessions that arrive while the picker is open are asked about, not silently replaced', async () => {
    const inputs = captureFileInput();
    const r = await render(buildContainer([]));

    await userEvent.click(
      await screen.findByText('Load sessions from a backup')
    );
    // The sync lands while the picker is open.
    act(() => {
      r.store.dispatch(replaceState(HERE));
    });
    dropFile(inputs[0], FROM_FILE, 'backup.json');

    expect(
      await screen.findByRole('dialog', {
        name: 'Load 1 session from this backup?',
      })
    ).toBeTruthy();
    expect(titlesHere(r)).toEqual(HERE_TITLES);
    expect(
      r.store.getState().tabContainerDataState.deletedTabGroups ?? []
    ).toEqual([]);
  });

  test('one session here, several in the file: each count in its own number', async () => {
    const inputs = captureFileInput();
    await render(buildContainer([buildSession({ title: 'Only one' })]));

    const dialog = await pickBackup(
      inputs,
      'two.json',
      JSON.stringify(
        buildContainer([
          buildSession({ tabGroupId: 'a', title: 'A' }),
          buildSession({ tabGroupId: 'b', title: 'B' }),
        ])
      )
    );

    expect(dialog).toHaveAccessibleName('Load 2 sessions from this backup?');
    expect(within(dialog).getByText('two.json')).toBeTruthy();
    expect(dialog).toHaveTextContent(
      'Merge keeps the session on this device and adds any sessions from the backup that aren’t already here.'
    );
    expect(dialog).toHaveTextContent(
      'Replace deletes the session on this device and on every device that syncs with it, then loads the backup. This can’t be undone.'
    );
  });
});
