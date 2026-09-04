import { hasTabGroupsPermission } from './permissions';
import { countOpenTabGroups } from './liveTabGroups';
import { asPartialSettings, loadFromLocalStorage } from './local';
import { SettingsData } from '../../redux/slices/settingsDataStateSlice';

// KAN-74. Should the popup offer to turn on tab group support, and for how
// many groups?
//
// Returns the number of live tab groups to offer for, or null to stay quiet.
// A number rather than a boolean because the offer's copy names the count, and
// splitting "whether" from "how many" would let the two disagree.
//
// Lives outside App.tsx because it is a decision, not a rendering concern:
// here it can be tested against a chrome fake and a seeded localStorage
// without mounting the whole app (and its Firebase auth subscription) to find
// out whether a modal would open.
//
// The offer fires on EVERY popup open that passes these checks. There is no
// interval and no cap by design -- the escalating opt-out inside the modal is
// what bounds it. Note that nothing here consults a stored "granted" flag:
// hasTabGroupsPermission() is the only source of truth, so a user who granted
// and later revoked cannot be re-armed by a stale boolean.
export async function shouldOfferTabGroups(
  isRateAndReviewModalShowing: boolean
): Promise<number | null> {
  // One modal at a time. The rate request loses nothing by winning here: it is
  // interval-gated and rare, while this offer returns on the very next open.
  if (isRateAndReviewModalShowing) return null;

  const { isNeverAskAgainForTabGroups = false } =
    asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));
  if (isNeverAskAgainForTabGroups) return null;

  if (await hasTabGroupsPermission()) return null;

  // Last, because it is the only check that costs a chrome round trip. It
  // works WITHOUT the permission -- the premise of the whole feature, see
  // liveTabGroups.ts.
  const openGroups = await countOpenTabGroups();
  if (openGroups === 0) return null;

  return openGroups;
}
