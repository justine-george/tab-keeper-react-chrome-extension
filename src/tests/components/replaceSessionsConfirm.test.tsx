import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { ReplaceSessionsModal } from '../../components/modals/ReplaceSessionsModal';
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

// KAN-252. "Replace sessions from a backup" was the most destructive action in
// the app and the only one with neither an undo nor a confirm: one click, a
// file pick, and every session not in the file was gone locally, for good
// (restoreContainer is excluded from the undo snapshots). This is option 1 of
// the ticket -- confirm before replacing -- chosen because it is cheap and
// forecloses nothing.
//
// The question is asked AFTER the file is read, not before the picker: an
// unreadable file still gets the error toast and no dialog, and a readable one
// gets a dialog that can say the real numbers. Nothing touches the store until
// Replace.

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
  input.onchange?.({ target: { files: [file] } } as unknown as Event);
};

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  buildSession({ tabGroupId: 'h2', title: 'Here two' }),
  buildSession({ tabGroupId: 'h3', title: 'Here three' }),
]);

const FROM_FILE = JSON.stringify(
  buildContainer([buildSession({ tabGroupId: 'f1', title: 'From the file' })])
);

const render = (saved = HERE) =>
  renderWithProviders(
    <>
      <SettingsDetailsContainer />
      <ReplaceSessionsModal />
    </>,
    {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        s.dispatch(replaceState(saved));
      },
    }
  );

const pickBackup = async (inputs: HTMLInputElement[], name = 'backup.json') => {
  await userEvent.click(
    await screen.findByText('Replace sessions from a backup')
  );
  dropFile(inputs[0], FROM_FILE, name);
  return screen.findByRole('dialog', { name: 'Replace your saved sessions?' });
};

const titlesHere = (r: RenderWithProvidersResult) =>
  r.store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

describe('confirm before replacing sessions from a backup (KAN-252)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(saveToFirestore).mockReset();
  });

  test('a readable backup asks first, naming both counts and the file, and applies nothing yet', async () => {
    const inputs = captureFileInput();
    const r = await render();

    const dialog = await pickBackup(inputs, 'monday.json');

    expect(dialog).toHaveTextContent(
      'Your 3 saved sessions here will be replaced.'
    );
    expect(dialog).toHaveTextContent('monday.json holds 1 session.');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    // Opens unlit (KAN-243): the dialog holds the focus; Replace is not one
    // accidental Enter away.
    expect(document.activeElement).toBe(dialog);
    // Nothing has happened to the store.
    expect(titlesHere(r)).toEqual(['Here one', 'Here two', 'Here three']);
    expect(r.store.getState().globalState.isDirty).toBe(false);
    expect(r.store.getState().globalState.toastText).toBe('');
  });

  test('Cancel closes the question and leaves everything as it was, with no toast', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titlesHere(r)).toEqual(['Here one', 'Here two', 'Here three']);
    expect(r.store.getState().globalState.isDirty).toBe(false);
    expect(r.store.getState().globalState.toastText).toBe('');
  });

  test('Escape is Cancel', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titlesHere(r)).toEqual(['Here one', 'Here two', 'Here three']);
  });

  test('Replace applies the file and reports success', async () => {
    const inputs = captureFileInput();
    const r = await render();
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Replace' })
    );

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file']);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Not isDirty: Auto Sync is on here, so the write ran and cleared it.
    // importGuard.test.tsx (KAN-257) pins the off case, where it stays set.
    await waitFor(() => {
      expect(r.store.getState().globalState.toastText).toBe(
        TOAST_MESSAGES.IMPORT_SUCCESS
      );
    });
  });

  // KAN-257 through the dialog. importGuard.test.tsx pins the Auto Sync gate
  // on the no-dialog path (nothing saved there); this is the same gate on the
  // path Replace takes, so the two cannot drift apart.
  test('Replace with Auto Sync off writes nothing and leaves the container dirty', async () => {
    const inputs = captureFileInput();
    const r = await renderWithProviders(
      <>
        <SettingsDetailsContainer />
        <ReplaceSessionsModal />
      </>,
      {
        seedStore: (s) => {
          s.dispatch(selectCategory(SettingsCategory.SYNC));
          s.dispatch(replaceState(HERE));
          s.dispatch(setSignedIn());
          s.dispatch(setUserId('uuid-1'));
          s.dispatch(toggleAutoSync());
        },
      }
    );
    expect(r.store.getState().settingsDataState.isAutoSync).toBe(false);
    const dialog = await pickBackup(inputs);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Replace' })
    );

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file']);
    });
    expect(saveToFirestore).not.toHaveBeenCalled();
    expect(r.store.getState().globalState.isDirty).toBe(true);
  });

  // A fresh install restoring a backup is the common case, and "replace your
  // 0 sessions?" is a question with nothing behind it.
  test('with nothing saved here, the backup applies without asking', async () => {
    const inputs = captureFileInput();
    const r = await render(buildContainer([]));

    await userEvent.click(
      await screen.findByText('Replace sessions from a backup')
    );
    dropFile(inputs[0], FROM_FILE, 'backup.json');

    await waitFor(() => {
      expect(titlesHere(r)).toEqual(['From the file']);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('one session here reads in the singular', async () => {
    const inputs = captureFileInput();
    await render(buildContainer([buildSession({ title: 'Only one' })]));

    const dialog = await pickBackup(inputs);

    expect(dialog).toHaveTextContent(
      'The session saved here will be replaced.'
    );
  });
});
