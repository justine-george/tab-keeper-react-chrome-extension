// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { readBackupFile, saveBackupFile } from '../../../redux/backupFile';
import { hydrateFromOtherPage } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  setSkipDuplicateTabs,
  setTheme,
} from '../../../redux/slices/settingsDataStateSlice';
import { Theme } from '../../../utils/constants/theme';
import { readLocalSessions } from '../../../utils/functions/localSessions';
import {
  IMPORT_INVALID_STRUCTURE,
  TranslatableError,
} from '../../../utils/functions/local';
import { makeTestStore } from '../../setup/makeStore';
import { buildContainer, buildSession } from '../../fixtures/sessionFixture';

// KAN-961. A backup's settings ride in one top-level field, and never into the saved sessions.

describe('readBackupFile', () => {
  test('splits the settings off the container', () => {
    const { container, settings } = readBackupFile(
      JSON.stringify({
        ...buildContainer([buildSession()]),
        settings: { theme: 'Charcoal' },
      })
    );
    expect('settings' in container).toBe(false);
    expect(container.tabGroups).toHaveLength(1);
    expect(settings).toEqual({ theme: 'Charcoal' });
  });

  test('an older backup has no settings', () => {
    expect(
      readBackupFile(JSON.stringify(buildContainer([buildSession()]))).settings
    ).toBeNull();
  });

  test('a non-object settings field never fails the file', () => {
    const read = readBackupFile(
      JSON.stringify({ ...buildContainer([buildSession()]), settings: 'x' })
    );
    expect(read.settings).toBeNull();
    expect('settings' in read.container).toBe(false);
  });

  test('a bad file still throws, settings or not', () => {
    expect(() =>
      readBackupFile(JSON.stringify({ settings: { theme: 'Charcoal' } }))
    ).toThrow(new TranslatableError(IMPORT_INVALID_STRUCTURE));
  });
});

describe('readLocalSessions', () => {
  beforeEach(() => localStorage.clear());

  test('drops a stray settings key', () => {
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify({
        ...buildContainer([buildSession()]),
        settings: { theme: 'Charcoal' },
      })
    );
    const read = readLocalSessions(buildContainer([]));
    expect(
      typeof read === 'object' && read !== null && 'settings' in read
    ).toBe(false);
  });
});

describe('saveBackupFile', () => {
  let written: string | null = null;
  beforeEach(() => {
    localStorage.clear();
    written = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      written = this.getAttribute('href');
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const savedFile = (): Record<string, unknown> => {
    const prefix = 'data:text/json;charset=utf-8,';
    expect(written?.startsWith(prefix)).toBe(true);
    return JSON.parse(decodeURIComponent((written ?? '').slice(prefix.length)));
  };

  test('writes the changed settings', () => {
    const { store } = makeTestStore();
    store.dispatch(setTheme(Theme.CHALK));
    store.dispatch(setSkipDuplicateTabs(true));
    store.dispatch(saveBackupFile());
    const file = savedFile();
    expect(file.settings).toEqual({ skipDuplicateTabs: true });
    expect(file.tabGroups).toEqual(
      store.getState().tabContainerDataState.tabGroups
    );
  });

  test('nothing changed writes no settings field', () => {
    const { store } = makeTestStore();
    store.dispatch(setTheme(Theme.CHALK));
    store.dispatch(saveBackupFile());
    expect('settings' in savedFile()).toBe(false);
  });

  test('writes fresh settings over a stray one', () => {
    const { store } = makeTestStore();
    store.dispatch(setTheme(Theme.CHALK));
    const stray = {
      ...buildContainer([buildSession()]),
      settings: { theme: 'Charcoal' },
    };
    store.dispatch(hydrateFromOtherPage(stray));
    store.dispatch(saveBackupFile());
    expect('settings' in savedFile()).toBe(false);
  });
});
