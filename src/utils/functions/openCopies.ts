// KAN-815. A saved tab or group dropped into a live window in Open now opens
// a copy there, in the background: every tab is created inactive, so nothing
// is focused or switched to. Runs in the page; the full view never dies on a
// background create. Neither function throws: a tab Chrome refuses is
// skipped, and a refused group step costs the group, never the tabs.
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { rememberCopyLook } from './copyLooks';
import { resolveTabUrl } from './local';
import { belowPinnedRun } from './openNowMoves';
import type { GroupCopySlot, TabCopySlot } from './openNowMoves';
import { splitPairs } from './savedPairs';
import { createSplitApi } from './splitView';
import {
  applyTabGroups,
  createRestoredTab,
  placeholderIcon,
  placeholderUrl,
  realPageIndexes,
  splitRestoredPairs,
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
  rememberCopyLook(id, { title: tab.title, favIconUrl: tab.favicon });
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

// Beside a tab just opened, where Chrome really put it; its asked-for slot's neighbor once it can't be read.
async function indexBeside(id: number, slot: number): Promise<number> {
  try {
    return (await chrome.tabs.get(id)).index + 1;
  } catch {
    return slot + 1;
  }
}

// KAN-942. A saved pair at a slot: both tabs at their real pages, then the split, last, as a restore does: a move ends one.
// Before Chrome 155, or refused, two tabs. Ids in saved order, undefined where Chrome refused.
export async function openPairCopy(
  first: tabData,
  second: tabData,
  slot: TabCopySlot
): Promise<[number | undefined, number | undefined]> {
  const firstId = await openTabCopy(first, slot);
  const index =
    firstId === undefined ? slot.index : await indexBeside(firstId, slot.index);
  const secondId = await openTabCopy(second, { ...slot, index });
  const createSplit = createSplitApi();
  if (createSplit !== null) {
    await splitRestoredPairs(createSplit, [[0, 1]], [firstId, secondId]);
  }
  return [firstId, secondId];
}

// A group: its first tab real, the rest KAN-250 placeholders (a page no swap
// loads opens real, as Open does, and so does a pair's half: KAN-942), never
// pinned, below the pinned run, then one Chrome group with the saved look,
// shown, then its pairs split. Created one at a time: in a live window a
// refused tab would leave the next index past a stranger. Ids in saved order,
// undefined where Chrome refused.
export async function openGroupCopy(
  tabs: readonly tabData[],
  group: TabGroupSpec,
  slot: GroupCopySlot,
  goToURLText: string
): Promise<(number | undefined)[]> {
  const createSplit = createSplitApi();
  const pairs = createSplit === null ? [] : splitPairs(tabs);
  const loadsPage = realPageIndexes(tabs, pairs);
  const urls = await Promise.all(
    tabs.map(async (tab, i) => {
      const url = resolveTabUrl(tab.url);
      return i === 0 || loadsPage.has(i)
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
    if (id === undefined) continue;
    rememberCopyLook(id, { title: tab.title, favIconUrl: tab.favicon });
    index += 1;
  }
  const members = ids.filter((id): id is number => id !== undefined);
  await applyTabGroups(
    slot.windowId,
    [group],
    new Map([[group.groupId, members]])
  );
  if (createSplit !== null) await splitRestoredPairs(createSplit, pairs, ids);
  return ids;
}
