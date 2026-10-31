import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openWhatsNew } from '../../redux/slices/globalStateSlice';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import type { ShownRelease } from '../../utils/functions/whatsNew';
import type { WhatsNewEntry } from '../../utils/constants/whatsNew';
import { WHATS_NEW_SINCE_KEY } from '../../utils/functions/whatsNewSince';

// KAN-861. The What's new dialog: its title, its entries, and its answers.

const COPY_LINKS: WhatsNewEntry = {
  titleKey: 'WhatsNewCopyLinksTitle',
  bodyKey: 'WhatsNewCopyLinksBody',
  settingsPage: SettingsCategory.SESSIONS,
  changesDefault: true,
};
const PLAIN: WhatsNewEntry = {
  titleKey: 'WhatsNewCopyLinksTitle',
  bodyKey: 'WhatsNewCopyLinksBody',
  changesDefault: false,
};
const ONE: ShownRelease[] = [
  { version: '2.1.0', fixesOnly: false, entries: [COPY_LINKS] },
];
const TWO: ShownRelease[] = [
  { version: '2.2.0', fixesOnly: false, entries: [PLAIN] },
  { version: '2.1.0', fixesOnly: false, entries: [COPY_LINKS] },
];

const render = (shown: ShownRelease[]) =>
  renderWithProviders(<MainContainer />, {
    seed: { localArea: { [WHATS_NEW_SINCE_KEY]: '2.0.1' } },
    seedStore: (s) => s.dispatch(openWhatsNew(shown)),
  });

const dialogNamed = (name: string) =>
  screen.getByRole('dialog', { name: (n) => n === name });

afterEach(() => localStorage.clear());

describe("What's new (KAN-861)", () => {
  test('one release: the title carries its version', async () => {
    await render(ONE);

    const dialog = dialogNamed("What's new in Tab Keeper 2.1.0");
    expect(within(dialog).getByText('Copy links is simpler')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'Copied links now paste as a plain list, one per line. If you preferred the old layout with headings, choose With headings in Settings › Sessions.'
      )
    ).toBeTruthy();
    expect(within(dialog).queryAllByRole('heading', { level: 3 })).toHaveLength(
      0
    );
  });

  test('several releases: one title, a version heading for each, newest first', async () => {
    await render(TWO);

    const dialog = dialogNamed("What's new in Tab Keeper");
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(['2.2.0', '2.1.0']);
  });

  test('Open Settings shows when an entry points to a setting', async () => {
    await render(ONE);
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
  });

  test('Open Settings is absent when no entry points to one', async () => {
    await render([{ version: '2.1.0', fixesOnly: false, entries: [PLAIN] }]);
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  test('Got it answers: closed, and the key removed', async () => {
    const { chrome } = await render(ONE);

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('dialog', { name: /What's new/ })).toBeNull();
    await waitFor(() =>
      expect(chrome.localArea()).not.toHaveProperty(WHATS_NEW_SINCE_KEY)
    );
  });

  test('Open Settings lands on Settings › Sessions and removes the key', async () => {
    const { chrome, store } = await render(ONE);

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    await waitFor(() =>
      expect(store.getState().globalState.isSettingsPage).toBe(true)
    );
    expect(
      store.getState().settingsCategoryState.find((c) => c.isSelected)?.name
    ).toBe(SettingsCategory.SESSIONS);
    await waitFor(() =>
      expect(chrome.localArea()).not.toHaveProperty(WHATS_NEW_SINCE_KEY)
    );
  });

  test('another page answering closes it here, and notes nothing', async () => {
    const { store } = await render([
      { version: '2.1.0', fixesOnly: false, entries: [PLAIN] },
    ]);

    await globalThis.chrome.storage.local.remove(WHATS_NEW_SINCE_KEY);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /What's new/ })).toBeNull()
    );
    expect(store.getState().settingsDataState.pendingReviewAsk).toBeNull();
  });

  test('CONTROL: another key changing leaves it open', async () => {
    await render(ONE);

    await globalThis.chrome.storage.local.set({ other: 1 });

    expect(dialogNamed("What's new in Tab Keeper 2.1.0")).toBeTruthy();
  });
});
