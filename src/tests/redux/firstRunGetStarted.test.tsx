import { afterEach, describe, expect, test } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { welcomeGetStarted, whatsNewGetStarted } from '../../redux/firstRun';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-624. The popup's run starts ask for the run, so a full view the worker only focuses still shows it.

let handle: ReturnType<typeof setupChromeFake> | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  localStorage.clear();
});

describe('Get started and Start ask the full view for the run', () => {
  test.each([
    ['the welcome’s Get started', welcomeGetStarted],
    ['What’s new’s Start', whatsNewGetStarted],
  ])('%s', async (_, start) => {
    handle = setupChromeFake();
    const { store } = makeTestStore();
    await store.dispatch(start());
    expect(handle.sentMessages).toEqual([
      expect.objectContaining({ type: OPEN_IN_TAB_MESSAGE, show: 'run' }),
    ]);
  });
});
