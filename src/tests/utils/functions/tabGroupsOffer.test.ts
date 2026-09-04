import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  setupChromeFake,
  type ChromeFakeHandle,
} from '../../setup/chrome.fake';
import { shouldOfferTabGroups } from '../../../utils/functions/tabGroupsOffer';
import { SettingsData } from '../../../redux/slices/settingsDataStateSlice';

let handle: ChromeFakeHandle;
beforeEach(() => localStorage.clear());
afterEach(() => {
  handle?.restore();
  localStorage.clear();
});

const seedSettings = (settings: Partial<SettingsData>) =>
  localStorage.setItem('settingsData', JSON.stringify(settings));

// A profile with two tab groups open and no permission granted -- the state
// the whole feature exists to catch. Every suppression test below starts from
// exactly this seed and changes one thing, so a test that stops offering
// really is being suppressed by the thing it names.
const twoGroupsUngranted = {
  tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }],
};

describe('shouldOfferTabGroups', () => {
  test('offers, with the group count, when everything lines up', async () => {
    handle = setupChromeFake(twoGroupsUngranted);

    expect(await shouldOfferTabGroups(false)).toBe(2);
  });

  test('stays quiet when no tab groups are open', async () => {
    handle = setupChromeFake({ tabs: [{ groupId: -1 }] });

    expect(await shouldOfferTabGroups(false)).toBeNull();
  });

  // Nothing to offer: they already have it.
  test('stays quiet when the permission is already granted', async () => {
    handle = setupChromeFake({
      ...twoGroupsUngranted,
      grantedPermissions: ['tabGroups'],
    });

    expect(await shouldOfferTabGroups(false)).toBeNull();
  });

  test('stays quiet once the user has opted out for good', async () => {
    handle = setupChromeFake(twoGroupsUngranted);
    seedSettings({ isNeverAskAgainForTabGroups: true });

    expect(await shouldOfferTabGroups(false)).toBeNull();
  });

  test('stays quiet while the rate-and-review modal is showing', async () => {
    handle = setupChromeFake(twoGroupsUngranted);

    expect(await shouldOfferTabGroups(true)).toBeNull();
  });

  // "Not now" means later, and later means the very next open. A single
  // dismissal must suppress nothing -- only the permanent opt-out does.
  test('still offers after the user has dismissed it once', async () => {
    handle = setupChromeFake(twoGroupsUngranted);
    seedSettings({ isTabGroupsPromptAnsweredOnce: true });

    expect(await shouldOfferTabGroups(false)).toBe(2);
  });

  // A revoked permission is the most explicit "no" a user can give, and it
  // must not re-arm the offer past an opt-out that is already recorded. This
  // is the pairing that a stored "we asked already" mirror would get wrong.
  test('an opted-out user who revokes the permission is still not re-asked', async () => {
    handle = setupChromeFake({
      ...twoGroupsUngranted,
      grantedPermissions: ['tabGroups'],
    });
    seedSettings({ isNeverAskAgainForTabGroups: true });

    await chrome.permissions.remove({ permissions: ['tabGroups'] });
    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(false);

    expect(await shouldOfferTabGroups(false)).toBeNull();
  });

  // The control for the test above: the same revocation, without the opt-out,
  // DOES offer again. Without this, that test passes against a function that
  // never offers anything.
  test('a user who has not opted out is offered again after revoking', async () => {
    handle = setupChromeFake({
      ...twoGroupsUngranted,
      grantedPermissions: ['tabGroups'],
    });

    expect(await shouldOfferTabGroups(false)).toBeNull();

    await chrome.permissions.remove({ permissions: ['tabGroups'] });

    expect(await shouldOfferTabGroups(false)).toBe(2);
  });

  test('unreadable settings in localStorage do not suppress the offer', async () => {
    handle = setupChromeFake(twoGroupsUngranted);
    localStorage.setItem('settingsData', 'not json');

    expect(await shouldOfferTabGroups(false)).toBe(2);
  });
});
