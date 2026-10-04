import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  focusTabContainer,
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-7: switching to a session (focus mode) restores it, which is a value
// moment (KAN-149) for an ordinary session and none for the sample.

const paramsFor = (tabGroupId: string) => ({
  tabGroupId,
  goToURLText: 'Go to URL',
  saveTitle: 'Auto-saved before switching',
});

describe('focus mode and the value moment', () => {
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
    return store.getState().settingsDataState.lastValueMomentTime;
  };

  it('switching to the sample records nothing', async () => {
    expect(await switchTo(`${SAMPLE_ID_PREFIX}1`)).toBe('');
  });

  it('CONTROL: switching to an ordinary session records one', async () => {
    expect(typeof (await switchTo('ordinary'))).toBe('number');
  });
});
