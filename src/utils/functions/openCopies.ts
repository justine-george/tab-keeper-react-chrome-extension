// KAN-815. A saved tab or group dropped into a live window in Open now opens
// a copy there, in the background: every tab is created inactive, so nothing
// is focused or switched to. Runs in the page; the full view never dies on a
// background create. Neither function throws: a tab Chrome refuses is
// skipped, and a refused group step costs the group, never the tabs.
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { resolveTabUrl, restoreRoute } from './local';
import { belowPinnedRun } from './openNowMoves';
import type { GroupCopySlot, TabCopySlot } from './openNowMoves';
import {
  applyTabGroups,
  createRestoredTab,
  placeholderIcon,
  placeholderUrl,
} from './windows';
import type { TabGroupSpec } from './windows';

// chrome.tabGroups.TAB_GROUP_ID_NONE, spelled out: the namespace is absent without the grant.
const NO_GROUP = -1;

// The saved tab with the pin the slot decided. `delete`, as pinned is never false.
function withPin(tab: tabData, pinned: boolean): tabData {
  const copy = { ...tab };
  if (pinned) copy.pinned = true;
  else delete copy.pinned;
  return copy;
}

// One tab, at its real page (like ⌘-click). It ends in the band's group, or in
// none: Chrome joins a tab created strictly inside a run (Review Focus 1).
// Without the grant there are no bands, and Chrome's join stands, as an Open
// now move's does (E4). Undefined when Chrome refused the tab.
export async function openTabCopy(
  tab: tabData,
  slot: TabCopySlot
): Promise<number | undefined> {
  const id = await createRestoredTab(
    slot.windowId,
    withPin(tab, slot.pinned),
    resolveTabUrl(tab.url),
    slot.index
  );
  if (id === undefined) return undefined;
  try {
    if (slot.groupId !== undefined) {
      await chrome.tabs.group({ groupId: slot.groupId, tabIds: [id] });
    } else if (
      chrome.tabGroups &&
      (await chrome.tabs.get(id)).groupId !== NO_GROUP
    ) {
      await chrome.tabs.ungroup(id);
    }
  } catch (error) {
    console.warn('Could not set a copied tab’s group:', error);
  }
  return id;
}

// A group: its first tab real, the rest KAN-250 placeholders (a page no swap
// loads opens real, as Open does), never pinned, below the pinned run, then
// one Chrome group with the saved look, shown. Created one at a time: in a
// live window a refused tab would leave the next index past a stranger.
// Ids in saved order, undefined where Chrome refused.
export async function openGroupCopy(
  tabs: readonly tabData[],
  group: TabGroupSpec,
  slot: GroupCopySlot,
  goToURLText: string
): Promise<(number | undefined)[]> {
  const urls = await Promise.all(
    tabs.map(async (tab, i) => {
      const url = resolveTabUrl(tab.url);
      return i === 0 || restoreRoute(url, chrome.runtime.id) === 'open'
        ? url
        : placeholderUrl(tab, await placeholderIcon(tab), goToURLText);
    })
  );
  const start = await belowPinnedRun(slot.windowId, {
    inPlace: false,
    slot: slot.index,
  });
  if (start === null || start.inPlace) return tabs.map(() => undefined);

  const ids: (number | undefined)[] = [];
  let index = start.slot;
  for (const [i, tab] of tabs.entries()) {
    const id = await createRestoredTab(
      slot.windowId,
      withPin(tab, false),
      urls[i],
      index
    );
    ids.push(id);
    if (id !== undefined) index += 1;
  }
  const members = ids.filter((id): id is number => id !== undefined);
  await applyTabGroups(
    slot.windowId,
    [group],
    new Map([[group.groupId, members]])
  );
  return ids;
}
