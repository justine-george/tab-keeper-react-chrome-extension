import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  setupChromeFake,
  type ChromeFakeHandle,
} from '../../setup/chrome.fake';
import {
  countOpenTabGroups,
  ungroupLiveGroup,
  updateLiveGroup,
} from '../../../utils/functions/liveTabGroups';

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
});

// KAN-568. Open now's rename and recolour write Chrome's own group.
describe('updateLiveGroup', () => {
  const seed = {
    windows: [{ id: 1, tabs: [{ title: 'G1', groupId: 50 }] }],
    tabGroups: [
      { id: 50, title: 'Research', color: 'blue' as const, windowId: 1 },
    ],
  };

  test('renames the live group', async () => {
    handle = setupChromeFake(seed);
    expect(await updateLiveGroup(50, { title: 'Reading' })).toBe(true);
    expect(await chrome.tabGroups.get(50)).toMatchObject({
      title: 'Reading',
      color: 'blue',
    });
  });

  test('recolours the live group', async () => {
    handle = setupChromeFake(seed);
    expect(await updateLiveGroup(50, { color: 'green' })).toBe(true);
    expect(await chrome.tabGroups.get(50)).toMatchObject({
      title: 'Research',
      color: 'green',
    });
  });

  // Worst paths: the group closed since the pane read it, or the grant was revoked mid-edit.
  test('resolves false, never throws, for a group that is gone', async () => {
    handle = setupChromeFake(seed);
    expect(await updateLiveGroup(51, { title: 'Reading' })).toBe(false);
  });

  test('resolves false, never throws, when chrome.tabGroups is absent', async () => {
    handle = setupChromeFake({ ...seed, tabGroupsApiAbsent: true });
    expect(await updateLiveGroup(50, { title: 'Reading' })).toBe(false);
  });
});

// KAN-696. Open now's Ungroup: the tabs stay, only the group goes.
describe('ungroupLiveGroup', () => {
  test('takes every listed tab out of its group', async () => {
    handle = setupChromeFake({
      tabs: [{ groupId: 7 }, { groupId: 7 }, { groupId: -1 }],
    });
    const ids = (await chrome.tabs.query({})).map((tab) => tab.id as number);
    expect(await ungroupLiveGroup(ids.slice(0, 2))).toBe(true);
    expect((await chrome.tabs.query({})).map((tab) => tab.groupId)).toEqual([
      -1, -1, -1,
    ]);
  });

  test('an empty list resolves false and calls nothing', async () => {
    handle = setupChromeFake();
    const spy = vi.spyOn(chrome.tabs, 'ungroup');
    expect(await ungroupLiveGroup([])).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test('a rejecting ungroup resolves false and never rejects', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: 7 }] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(chrome.tabs, 'ungroup').mockRejectedValue(new Error('gone'));
    expect(await ungroupLiveGroup([1])).toBe(false);
  });
});
