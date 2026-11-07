// KAN-942. A click on either half of a saved pair: the split if it's open, the clicked half if both are open apart, else both, split.
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { openPairCopy } from './openCopies';
import { resolveTabUrl } from './local';
import { switchToOpenTab, thisWindowFirst, toOpenWindows } from './openNow';
import type { OpenTab, OpenWindow } from './openNow';
import { findOpenCopy, hasOpenCopy } from './openSavedTab';
import { openSplitPartners } from './splitPartners';

// The tab of `clicked`'s address in a live split with `partner`'s, Tab Keeper's own window first.
function halfInOpenSplit(
  clicked: string,
  partner: string,
  windows: readonly OpenWindow[]
): OpenTab | undefined {
  const [address, partnerAddress] = [
    resolveTabUrl(clicked),
    resolveTabUrl(partner),
  ];
  for (const window of thisWindowFirst(windows)) {
    const partners = openSplitPartners(window.tabs);
    const half = window.tabs.find((tab) => {
      const other = partners.get(tab.id);
      return (
        other !== undefined &&
        resolveTabUrl(tab.url) === address &&
        resolveTabUrl(other.url) === partnerAddress
      );
    });
    if (half !== undefined) return half;
  }
  return undefined;
}

// Whether a plain click on a half would switch, not open: only with both halves open.
export function pairClickSwitches(
  clicked: string,
  partner: string,
  addresses: ReadonlySet<string>
): boolean {
  return hasOpenCopy(clicked, addresses) && hasOpenCopy(partner, addresses);
}

// False when a half isn't open, the windows can't be read, or the tab closed before the switch: the caller then opens both.
export async function switchToOpenPair(
  clicked: string,
  partner: string
): Promise<boolean> {
  try {
    const [all, self] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      // The window Tab Keeper is in: the tab view's own, or the one behind the popup.
      chrome.windows.getCurrent().catch(() => undefined),
    ]);
    const windows = toOpenWindows(all, null, self?.id ?? null);
    const copy = findOpenCopy(clicked, windows);
    if (copy === undefined || findOpenCopy(partner, windows) === undefined) {
      return false;
    }
    await switchToOpenTab(halfInOpenSplit(clicked, partner, windows) ?? copy);
    return true;
  } catch {
    return false;
  }
}

// Both beside the active tab, split. `active` brings `clicked` forward, last: in the popup that closes the page.
export async function openPairBesideActive(
  first: tabData,
  second: tabData,
  clicked: tabData,
  active: boolean
): Promise<void> {
  const [current] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!current) return;
  const [firstId, secondId] = await openPairCopy(first, second, {
    windowId: current.windowId,
    index: current.index + 1,
    pinned: false,
  });
  const forward =
    (clicked === first ? firstId : secondId) ?? firstId ?? secondId;
  if (!active || forward === undefined) return;
  await chrome.tabs
    .update(forward, { active: true })
    .catch((error: unknown) => {
      console.warn('Could not bring a saved pair forward:', error);
    });
}
