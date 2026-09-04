import { afterEach, describe, expect, test } from 'vitest';

import {
  setupChromeFake,
  type ChromeFakeHandle,
} from '../../setup/chrome.fake';
import { countOpenTabGroups } from '../../../utils/functions/liveTabGroups';

let handle: ChromeFakeHandle;
afterEach(() => handle?.restore());

describe('countOpenTabGroups', () => {
  // The premise of KAN-74. Every test below seeds no grantedPermissions, so
  // the whole file is really one long assertion that counting works while
  // ungranted -- but this one says it out loud, because if it ever stops being
  // true the feature has no trigger and the rest of these tests would look
  // like they were merely testing arithmetic.
  test('counts groups on a profile that has NOT granted tabGroups', async () => {
    handle = setupChromeFake({
      tabs: [{ groupId: 42 }, { groupId: -1 }],
    });

    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(false);
    expect(await countOpenTabGroups()).toBe(1);
  });

  test('zero when nothing is grouped', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: -1 }, { groupId: -1 }] });
    expect(await countOpenTabGroups()).toBe(0);
  });

  test('zero when there are no tabs at all', async () => {
    handle = setupChromeFake();
    expect(await countOpenTabGroups()).toBe(0);
  });

  // Distinct, not total. Two tabs in one group is one group to offer to save.
  test('two tabs sharing a group count as one group', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: 7 }, { groupId: 7 }] });
    expect(await countOpenTabGroups()).toBe(1);
  });

  // The ticket's "all windows, not just the current one": the ask is about the
  // feature in general. A per-window query would return 1 here.
  test('counts groups across separate windows', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1 }, { id: 2 }],
      tabs: [
        { groupId: 7, windowId: 1 },
        { groupId: 9, windowId: 2 },
      ],
    });
    expect(await countOpenTabGroups()).toBe(2);
  });

  // Paired positive control for the exclusion below: the SAME seed, minus the
  // ungrouped tab, must still count 1. Without this, a countOpenTabGroups that
  // always returned 0 would satisfy the exclusion test.
  test('a lone grouped tab counts 1 (control for the exclusion below)', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: 7 }] });
    expect(await countOpenTabGroups()).toBe(1);
  });

  test('ungrouped tabs (-1) are excluded, not counted as a group', async () => {
    handle = setupChromeFake({
      tabs: [{ groupId: 7 }, { groupId: -1 }, { groupId: -1 }],
    });
    expect(await countOpenTabGroups()).toBe(1);
  });

  // A tab whose groupId Chrome omitted entirely. Distinct from -1 and must not
  // become a group of its own: `undefined` is not a group id.
  test('a tab with no groupId at all is excluded', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: undefined }] });
    expect(await countOpenTabGroups()).toBe(0);
  });

  // Worst path. The count only decides whether to show an offer, so a failed
  // query must degrade to "do not offer" rather than reject into the mount
  // effect that calls it.
  test('zero, not a throw, when chrome.tabs.query rejects', async () => {
    handle = setupChromeFake();
    const tabs = chrome.tabs as unknown as { query: () => Promise<unknown> };
    tabs.query = () => Promise.reject(new Error('no tabs permission'));

    await expect(countOpenTabGroups()).resolves.toBe(0);
  });

  test('zero, not a throw, when the tabs API is missing entirely', async () => {
    handle = setupChromeFake();
    delete (globalThis as { chrome?: { tabs?: unknown } }).chrome!.tabs;

    await expect(countOpenTabGroups()).resolves.toBe(0);
  });
});
