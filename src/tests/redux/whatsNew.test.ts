import { afterEach, describe, expect, it, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { answerWhatsNew, decideWhatsNew } from '../../redux/whatsNew';
import { noteReviewMoment } from '../../redux/reviewAsk';
import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import { WHATS_NEW_SINCE_KEY } from '../../utils/functions/whatsNewSince';
import type { ShownRelease } from '../../utils/functions/whatsNew';

// KAN-861. Deciding whether What's new shows on this open, and what each answer does.

const DAY = 24 * 3600_000;

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
});

const stored = () => handle?.localArea()[WHATS_NEW_SINCE_KEY];

// A manifest far ahead keeps these true after the cut renames 'next'.
const start = (localArea?: Record<string, unknown>) => {
  handle = setupChromeFake({ localArea, manifestVersion: '99.0.0' });
  return makeTestStore().store;
};

describe('deciding', () => {
  test('after an update, it opens the shipped release', async () => {
    const store = start({ [WHATS_NEW_SINCE_KEY]: '2.0.1' });

    const opener = await decideWhatsNew(store.dispatch);

    expect(opener).not.toBeNull();
    opener?.();
    const shown = store.getState().globalState.whatsNew;
    expect(shown?.[0].version).toBe('99.0.0');
    expect(shown?.[0].entries[0].titleKey).toBe('WhatsNewCopyLinksTitle');
    expect(stored()).toBe('2.0.1');
  });

  test('no key: nothing, and nothing written', async () => {
    const store = start();
    const set = vi.spyOn(chrome.storage.local, 'set');
    const remove = vi.spyOn(chrome.storage.local, 'remove');

    expect(await decideWhatsNew(store.dispatch)).toBeNull();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['abc', '99.0.0', '100.0.0'])(
    'a since of %s: nothing, and the key is removed',
    async (since) => {
      const store = start({ [WHATS_NEW_SINCE_KEY]: since });

      expect(await decideWhatsNew(store.dispatch)).toBeNull();
      await vi.waitFor(() =>
        expect(handle?.localArea()).not.toHaveProperty(WHATS_NEW_SINCE_KEY)
      );
    }
  );
});

describe('answering', () => {
  const entry = (settingsPage?: SettingsCategory) => ({
    titleKey: 'T',
    bodyKey: 'B',
    settingsPage,
    changesDefault: false,
  });
  const withDefaultChange: ShownRelease[] = [
    {
      version: '2.1.0',
      fixesOnly: false,
      entries: [{ ...entry(), changesDefault: true }],
    },
  ];
  const withoutDefaultChange: ShownRelease[] = [
    {
      version: '2.1.0',
      fixesOnly: false,
      entries: [entry(SettingsCategory.SESSIONS)],
    },
  ];

  // Installed two days ago, so an ask is allowed.
  const answering = () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ extensionInstalledTime: Date.now() - 2 * DAY })
    );
    return start({ [WHATS_NEW_SINCE_KEY]: '2.0.1' });
  };

  const settings = (store: ReturnType<typeof answering>) =>
    store.getState().settingsDataState;

  test('Got it with a default change notes no moment', async () => {
    const store = answering();

    store.dispatch(answerWhatsNew('gotIt', withDefaultChange));

    await vi.waitFor(() =>
      expect(handle?.localArea()).not.toHaveProperty(WHATS_NEW_SINCE_KEY)
    );
    expect(store.getState().globalState.whatsNew).toBeNull();
    expect(settings(store).pendingReviewAsk).toBeNull();
  });

  test("Got it without one notes 'updated'", () => {
    const store = answering();

    store.dispatch(answerWhatsNew('gotIt', withoutDefaultChange));

    expect(settings(store).pendingReviewAsk?.moment).toEqual({
      kind: 'updated',
    });
  });

  it.each(['openSettings', 'dismissed'] as const)(
    '%s never notes one',
    async (answer) => {
      const store = answering();

      store.dispatch(answerWhatsNew(answer, withoutDefaultChange));

      await vi.waitFor(() =>
        expect(handle?.localArea()).not.toHaveProperty(WHATS_NEW_SINCE_KEY)
      );
      expect(settings(store).pendingReviewAsk).toBeNull();
    }
  );

  test("Open Settings opens Settings at the entry's page", async () => {
    const store = answering();

    store.dispatch(answerWhatsNew('openSettings', withoutDefaultChange));

    await vi.waitFor(() =>
      expect(store.getState().globalState.isSettingsPage).toBe(true)
    );
    const selected = store
      .getState()
      .settingsCategoryState.find((c) => c.isSelected);
    expect(selected?.name).toBe(SettingsCategory.SESSIONS);
  });

  test("a default change clears another page's waiting ask", () => {
    const store = answering();
    store.dispatch(noteReviewMoment({ kind: 'restored' }));
    expect(settings(store).pendingReviewAsk).not.toBeNull();

    store.dispatch(answerWhatsNew('gotIt', withDefaultChange));

    expect(settings(store).pendingReviewAsk).toBeNull();
  });

  test('CONTROL: a dismissal with no default change keeps it', () => {
    const store = answering();
    store.dispatch(noteReviewMoment({ kind: 'restored' }));

    store.dispatch(answerWhatsNew('dismissed', withoutDefaultChange));

    expect(settings(store).pendingReviewAsk?.moment).toEqual({
      kind: 'restored',
    });
  });
});
