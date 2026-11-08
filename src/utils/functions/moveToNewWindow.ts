// KAN-949. Moves an open tab, split pair or group into a new window of its own, keeping the same tabs.
//
// windows.create({tabId}) makes the window from the first tab, so no New Tab is left anywhere. Measured
// (Chromium 156, ledger probes 1-2): that tab arrives unpinned, out of its group and out of its split,
// and the window takes focus. Each of those is put back here.
import { readPlace } from './openNowMoves';
import { addPinnedStub } from './pinnedTabKeeper';
import type { GroupLook, MovedTab, MovedTabs, TabPlace } from './openNowMoves';
import { isStillOneSplit } from './splitPairMove';
import type { SplitPair } from './splitPairMove';
import { createSplitApi, SPLIT_VIEW_ID_NONE } from './splitView';

// What is moved: one tab; a split's two tabs in strip order; or every tab of one group in strip order,
// with the look the new group gets.
export type NewWindowMove =
  | { kind: 'tab'; tabId: number }
  | { kind: 'pair'; pair: SplitPair }
  | { kind: 'group'; tabIds: [number, ...number[]]; look: GroupLook };

const NO_GROUP = -1;

async function succeeded(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}

async function readTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return (await chrome.tabs.get(tabId)) ?? null;
  } catch {
    return null;
  }
}

function tabIdsOf(move: NewWindowMove): [number, ...number[]] {
  if (move.kind === 'tab') return [move.tabId];
  if (move.kind === 'pair') return [move.pair.first, move.pair.second];
  return move.tabIds;
}

// Whether `tabIds` are, in order, every tab Chrome has in `head`'s group.
async function isTheWholeGroup(
  head: chrome.tabs.Tab,
  tabIds: readonly number[]
): Promise<boolean> {
  if (head.groupId === NO_GROUP) return false;
  let strip: chrome.tabs.Tab[];
  try {
    strip = await chrome.tabs.query({ windowId: head.windowId });
  } catch {
    return false;
  }
  const members = strip
    .filter((tab) => tab.groupId === head.groupId)
    .sort((a, b) => a.index - b.index)
    .map((tab) => tab.id);
  return (
    members.length === tabIds.length &&
    members.every((id, i) => id === tabIds[i])
  );
}

// Whether the move can start: every tab is there, a pair is still one split, a group is whole and has its
// look and the grant.
async function canStart(
  move: NewWindowMove,
  hasTabGroups: boolean
): Promise<boolean> {
  if (move.kind === 'pair') return isStillOneSplit(move.pair);
  if (move.kind === 'tab') return (await readTab(move.tabId)) !== null;
  if (!hasTabGroups || !chrome.tabGroups) return false;
  const head = await readTab(move.tabIds[0]);
  return head !== null && isTheWholeGroup(head, move.tabIds);
}

// The group's place before the window is made: its id, the split its first tab is in, and its front tab.
interface GroupBefore {
  groupId: number;
  partner: number | undefined;
  front: number | undefined;
}

// The rest of a group into `windowId`, behind its first tab, as one group with `look`. tabGroups.move keeps the
// group's id and any split inside it; the first tab then rejoins at the front. A one-tab group is gone once its
// tab left, so it is made again. The first tab's split is made again, and the front tab is brought to the front:
// tabGroups.move carries the old window's new front tab (probe 6a). The look is set last, as bringing a tab to
// the front expands its group.
async function bringGroup(
  tabIds: [number, ...number[]],
  look: GroupLook,
  windowId: number,
  { groupId, partner, front }: GroupBefore
): Promise<boolean> {
  const [first] = tabIds;
  let landedIn = groupId;
  if (tabIds.length > 1) {
    const moved =
      (await succeeded(() =>
        chrome.tabGroups.move(groupId, { windowId, index: -1 })
      )) &&
      (await succeeded(() => chrome.tabs.group({ groupId, tabIds: [first] })));
    if (!moved) return false;
  } else {
    try {
      landedIn = await chrome.tabs.group({
        tabIds: [first],
        createProperties: { windowId },
      });
    } catch {
      return false;
    }
  }
  if (!(await resplit(first, partner))) return false;
  if (
    front !== undefined &&
    !(await succeeded(() => chrome.tabs.update(front, { active: true })))
  ) {
    return false;
  }
  return succeeded(() =>
    chrome.tabGroups.update(landedIn, {
      title: look.title,
      color: look.color,
      collapsed: look.collapsed,
    })
  );
}

// Splits `first` and the tab after it again when they were one split before the window was made.
async function resplit(first: number, partner: number | undefined) {
  if (partner === undefined) return true;
  const createSplit = createSplitApi();
  return createSplit !== null && succeeded(() => createSplit([first, partner]));
}

// The tab the head's split shared, when it had one: the window ends that split.
async function splitPartnerOf(
  head: chrome.tabs.Tab
): Promise<number | undefined> {
  const id = head.splitViewId;
  if (id === undefined || id === SPLIT_VIEW_ID_NONE) return undefined;
  try {
    const strip = await chrome.tabs.query({ windowId: head.windowId });
    return strip.find((tab) => tab.id !== head.id && tab.splitViewId === id)
      ?.id;
  } catch {
    return undefined;
  }
}

// Never throws. Null when Chrome refused, or the move could not start (nothing moved then); a refusal part way
// leaves the tabs where Chrome has them. Otherwise the new window's id and each tab's place before and after.
// `pinTabKeeper` ("Pin Tab Keeper in new windows", KAN-949 Goal 3a): the window also gets the pinned Tab Keeper
// tab, first; `stubTabId` is its id, null when none was added (asked not to, an incognito window, or Chrome
// refused it, which costs only that tab).
export async function moveIntoNewWindow(
  move: NewWindowMove,
  hasTabGroups: boolean,
  pinTabKeeper: boolean
): Promise<{
  windowId: number;
  stubTabId: number | null;
  moved: MovedTabs;
} | null> {
  if (!(await canStart(move, hasTabGroups))) return null;
  const withLook = hasTabGroups && Boolean(chrome.tabGroups);
  const tabIds = tabIdsOf(move);
  const [first] = tabIds;
  const befores: { tabId: number; before: TabPlace }[] = [];
  for (const tabId of tabIds) {
    const before = await readPlace(tabId, withLook);
    if (before === null) return null;
    befores.push({ tabId, before });
  }
  // Copied out before the window is made: the object Chrome resolved with is not promised to stay as it was.
  const head = await readTab(first);
  if (head === null) return null;
  const { pinned } = head;
  // The profile the window is made in: its own window's (probe 3).
  let incognito: boolean;
  try {
    incognito = (await chrome.windows.get(head.windowId)).incognito;
  } catch {
    return null;
  }
  const group: GroupBefore | null =
    move.kind === 'group'
      ? {
          groupId: head.groupId,
          partner: await splitPartnerOf(head),
          front: await frontAmong(tabIds),
        }
      : null;

  let windowId: number;
  try {
    // Probe 3: without `incognito`, an incognito tab is refused as another profile's.
    const made = await chrome.windows.create({
      tabId: first,
      focused: true,
      incognito,
    });
    if (made?.id === undefined) return null;
    windowId = made.id;
  } catch {
    return null;
  }

  const broughtRest =
    move.kind === 'group'
      ? group !== null &&
        (await bringGroup(move.tabIds, move.look, windowId, group))
      : await bringTheRest(move, windowId, pinned);
  if (!broughtRest) return null;
  const stubTabId = pinTabKeeper ? await addPinnedStub(windowId) : null;

  const moved: MovedTab[] = [];
  for (const { tabId, before } of befores) {
    const after = await readPlace(tabId, withLook);
    if (after === null) return null;
    moved.push({ tabId, before, after });
  }
  return { windowId, stubTabId, moved };
}

// The tab of `tabIds` that is its window's front tab, if one is.
async function frontAmong(
  tabIds: readonly number[]
): Promise<number | undefined> {
  for (const tabId of tabIds) {
    if ((await readTab(tabId))?.active) return tabId;
  }
  return undefined;
}

// After the window is made from the first tab: a pinned tab pinned again; a pair's second tab brought, both
// pinned again if they were, and split again.
async function bringTheRest(
  move: Exclude<NewWindowMove, { kind: 'group' }>,
  windowId: number,
  pinned: boolean
): Promise<boolean> {
  if (move.kind === 'tab') {
    return (
      !pinned ||
      succeeded(() => chrome.tabs.update(move.tabId, { pinned: true }))
    );
  }
  const { first, second } = move.pair;
  if (
    !(await succeeded(() => chrome.tabs.move(second, { windowId, index: -1 })))
  ) {
    return false;
  }
  if (pinned) {
    for (const tabId of [first, second]) {
      if (
        !(await succeeded(() => chrome.tabs.update(tabId, { pinned: true })))
      ) {
        return false;
      }
    }
  }
  return resplit(first, second);
}
