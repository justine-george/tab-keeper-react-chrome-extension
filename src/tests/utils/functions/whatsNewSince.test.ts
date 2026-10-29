import { afterEach, describe, expect, it, test, vi } from 'vitest';

import {
  WHATS_NEW_SINCE_KEY,
  recordWhatsNewSince,
} from '../../../utils/functions/whatsNewSince';
import { setupChromeFake } from '../../setup/chrome.fake';

// KAN-861. The worker records the version an update came from, so the next open can show what changed.

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const recorded = () => handle?.localArea()[WHATS_NEW_SINCE_KEY];

const update = (previousVersion?: string) =>
  handle?.fireInstalled({ reason: 'update', previousVersion } as chrome.runtime.InstalledDetails);

describe('recordWhatsNewSince', () => {
  test('an update records the version it came from', async () => {
    handle = setupChromeFake();
    recordWhatsNewSince();
    update('2.0.1');
    await vi.waitFor(() => expect(recorded()).toBe('2.0.1'));
  });

  test('a second update keeps the first', async () => {
    handle = setupChromeFake();
    recordWhatsNewSince();
    update('2.0.1');
    await vi.waitFor(() => expect(recorded()).toBe('2.0.1'));
    update('2.1.0');
    // CONTROL for the wait: a later listener sees the settled value.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recorded()).toBe('2.0.1');
  });

  it.each(['install', 'chrome_update', 'shared_module_update'])(
    '%s records nothing',
    async (reason) => {
      handle = setupChromeFake();
      recordWhatsNewSince();
      handle.fireInstalled({ reason, previousVersion: '1.0.0' } as chrome.runtime.InstalledDetails);
      // CONTROL: the listener ran, and the first event wrote nothing.
      update('9.9.9');
      await vi.waitFor(() => expect(recorded()).toBe('9.9.9'));
    }
  );

  test('an update with no previousVersion records nothing', async () => {
    handle = setupChromeFake();
    recordWhatsNewSince();
    update(undefined);
    update('9.9.9');
    await vi.waitFor(() => expect(recorded()).toBe('9.9.9'));
  });

  test('the worker registers it', async () => {
    handle = setupChromeFake({ action: {} });
    vi.resetModules();
    await import('../../../background');
    update('2.0.1');
    await vi.waitFor(() => expect(recorded()).toBe('2.0.1'));
  });
});
