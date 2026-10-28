import { afterEach, describe, expect, test } from 'vitest';

import {
  copyLooks,
  forgetCopyLooks,
  rememberCopyLook,
} from '../../../utils/functions/copyLooks';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
});

const LOOK = { title: 'Saved', favIconUrl: '' };
const windowsWith = (...tabs: Partial<chrome.tabs.Tab>[]) => {
  handle = setupChromeFake({ windows: [{ id: 1, tabs }] });
  return chrome.windows.getAll({ populate: true });
};

// KAN-851. A copy's saved look is kept only while Chrome is still loading it.
describe('forgetCopyLooks', () => {
  test('keeps a copy Chrome is still loading', async () => {
    rememberCopyLook(5, LOOK);

    forgetCopyLooks(await windowsWith({ id: 5, status: 'loading' }));

    expect(copyLooks().get(5)).toEqual(LOOK);
  });

  test('forgets a copy Chrome has loaded', async () => {
    rememberCopyLook(5, LOOK);

    forgetCopyLooks(await windowsWith({ id: 5, status: 'complete' }));

    expect(copyLooks().has(5)).toBe(false);
  });

  // A read begun before Chrome made the copy does not list it yet.
  test('keeps a copy a read does not list', async () => {
    rememberCopyLook(6, LOOK);

    forgetCopyLooks(await windowsWith({ id: 5, status: 'complete' }));

    expect(copyLooks().get(6)).toEqual(LOOK);
  });
});
