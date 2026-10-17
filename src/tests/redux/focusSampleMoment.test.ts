import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import {
  focusTabContainer,
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-7: switching to a session (focus mode) restores it, which asks "Your
// tabs are back" (KAN-149, KAN-653) for an ordinary session and nothing for
// the sample.

const paramsFor = (tabGroupId: string) => ({
  tabGroupId,
  goToURLText: 'Go to URL',
  saveTitle: 'Auto-saved before switching',
});

describe('focus mode and the review ask', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    localStorage.clear();
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://a.example/', title: 'A' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });
  });
  afterEach(() => handle?.restore());

  const switchTo = async (tabGroupId: string) => {
    const { store } = makeTestStore();
    store.dispatch(
      restoreContainer(buildContainer([buildSession({ tabGroupId })]))
    );
    await store.dispatch(focusTabContainer(paramsFor(tabGroupId)));
    return (
      store.getState().settingsDataState.pendingReviewAsk?.moment.kind ?? null
    );
  };

  it('switching to the sample notes nothing', async () => {
    expect(await switchTo(`${SAMPLE_ID_PREFIX}1`)).toBeNull();
  });

  it('CONTROL: switching to an ordinary session notes a restore', async () => {
    expect(await switchTo('ordinary')).toBe('restored');
  });
});
