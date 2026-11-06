// KAN-486. Moves a live Chrome split as one, by the route that keeps it best. The measured rules are in the spec's tables.
import { createSplitApi, SPLIT_VIEW_ID_NONE } from './splitView';

// chrome.tabGroups.TAB_GROUP_ID_NONE, spelled out: chrome.tabGroups is absent without the grant.
const NO_GROUP = -1;

// A split's two tabs, in strip order.
export interface SplitPair {
  first: number;
  second: number;
}

export interface PairTarget {
  windowId: number;
  // `first`'s final index there, counted without the pair.
  index: number;
  groupId: number; // -1 for none
  pinned: boolean;
}

interface PairTabs {
  first: chrome.tabs.Tab;
  second: chrome.tabs.Tab;
}

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

async function readPair(pair: SplitPair): Promise<PairTabs | null> {
  const first = await readTab(pair.first);
  const second = await readTab(pair.second);
  return first === null || second === null ? null : { first, second };
}

function sharesOneSplit({ first, second }: PairTabs): boolean {
  const id = first.splitViewId;
  return (
    id !== undefined && id !== SPLIT_VIEW_ID_NONE && id === second.splitViewId
  );
}

// True when both tabs report the same split id.
export async function isStillOneSplit(pair: SplitPair): Promise<boolean> {
  const tabs = await readPair(pair);
  return tabs !== null && sharesOneSplit(tabs);
}

// Whether the target slot lies strictly inside its group's run, the pair left out. Null when Chrome won't list the window.
async function isInsideRun(
  pair: SplitPair,
  to: PairTarget
): Promise<boolean | null> {
  if (to.groupId === NO_GROUP) return false;
  let strip: chrome.tabs.Tab[];
  try {
    strip = await chrome.tabs.query({ windowId: to.windowId });
  } catch {
    return null;
  }
  const others = strip
    .filter((tab) => tab.id !== pair.first && tab.id !== pair.second)
    .sort((a, b) => a.index - b.index);
  return (
    others[to.index - 1]?.groupId === to.groupId &&
    others[to.index]?.groupId === to.groupId
  );
}

async function frontTabOf(windowId: number): Promise<number | undefined> {
  try {
    const [front] = await chrome.tabs.query({ windowId, active: true });
    return front?.id;
  } catch {
    return undefined;
  }
}

// The pair in a temporary group to `to`'s slot, which keeps the split and its divider. The group never outlives the call.
async function travelGrouped(
  pair: SplitPair,
  to: PairTarget
): Promise<boolean> {
  const tabs = await readPair(pair);
  if (tabs === null) return false;
  const { windowId, index } = tabs.first;
  const across = windowId !== to.windowId;
  if (!across && index === to.index) return true;
  const tabIds: [number, number] = [pair.first, pair.second];
  // tabGroups.move carries the front tab into the destination, so its old one is put back after.
  const handBack =
    across && (tabs.first.active || tabs.second.active)
      ? await frontTabOf(to.windowId)
      : undefined;
  let temporary: number;
  try {
    // createProperties.windowId, or Chrome makes the group in the CURRENT window and moves the tabs there.
    temporary = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId },
    });
  } catch {
    return false;
  }
  const moved = await succeeded(() =>
    chrome.tabGroups.move(
      temporary,
      across ? { windowId: to.windowId, index: to.index } : { index: to.index }
    )
  );
  if (moved && handBack !== undefined) {
    await succeeded(() => chrome.tabs.update(handBack, { active: true }));
  }
  // Runs after a refused move too: a temporary group left behind is worse than a lost split.
  const ungrouped = await succeeded(() => chrome.tabs.ungroup(tabIds));
  return moved && ungrouped;
}

async function byGroupRoute(
  pair: SplitPair,
  from: chrome.tabs.Tab,
  to: PairTarget
): Promise<boolean> {
  const tabIds: [number, number] = [pair.first, pair.second];
  if (
    from.groupId !== NO_GROUP &&
    !(await succeeded(() => chrome.tabs.ungroup(tabIds)))
  ) {
    return false;
  }
  if (!(await travelGrouped(pair, to))) return false;
  if (to.groupId === NO_GROUP) return true;
  return succeeded(() => chrome.tabs.group({ groupId: to.groupId, tabIds }));
}

// Into the target window: to the slot, the later half first so the first lands before it, or into the run.
async function arrive(
  pair: SplitPair,
  to: PairTarget,
  inside: boolean
): Promise<boolean> {
  if (inside) {
    return succeeded(() =>
      chrome.tabs.group({
        groupId: to.groupId,
        tabIds: [pair.first, pair.second],
      })
    );
  }
  const { windowId, index } = to;
  return (
    (await succeeded(() =>
      chrome.tabs.move(pair.second, { windowId, index })
    )) &&
    (await succeeded(() => chrome.tabs.move(pair.first, { windowId, index })))
  );
}

// Pinning takes a tab to the run's end and unpinning to the start of the rest, so the order here keeps the halves in order.
async function setPin(pair: SplitPair, pinned: boolean): Promise<boolean> {
  const tabs = await readPair(pair);
  if (tabs === null) return false;
  if (tabs.first.pinned === pinned) return true;
  const order = pinned ? [pair.first, pair.second] : [pair.second, pair.first];
  for (const tabId of order) {
    if (!(await succeeded(() => chrome.tabs.update(tabId, { pinned })))) {
      return false;
    }
  }
  return true;
}

// Going later the later half moves first, going earlier the first half, or the pair ends up apart.
async function place(pair: SplitPair, index: number): Promise<boolean> {
  const tabs = await readPair(pair);
  if (tabs === null) return false;
  const firstLand = { tabId: pair.first, index };
  const secondLand = { tabId: pair.second, index: index + 1 };
  const order =
    tabs.first.index < index
      ? [secondLand, firstLand]
      : [firstLand, secondLand];
  for (const land of order) {
    const tab = await readTab(land.tabId);
    if (tab === null) return false;
    if (tab.index === land.index) continue;
    const { tabId } = land;
    const moved = await succeeded(() =>
      chrome.tabs.move(tabId, { index: land.index })
    );
    if (!moved) return false;
  }
  return true;
}

async function setGroup(pair: SplitPair, groupId: number): Promise<boolean> {
  const tabs = await readPair(pair);
  if (tabs === null) return false;
  if (tabs.first.groupId === groupId && tabs.second.groupId === groupId) {
    return true;
  }
  const tabIds: [number, number] = [pair.first, pair.second];
  return succeeded(() =>
    groupId === NO_GROUP
      ? chrome.tabs.ungroup(tabIds)
      : chrome.tabs.group({ groupId, tabIds })
  );
}

// tabs.move ends a split, so this route splits the tabs again, and the divider resets to even.
async function byPlainRoute(
  pair: SplitPair,
  from: chrome.tabs.Tab,
  to: PairTarget,
  inside: boolean
): Promise<boolean> {
  if (from.windowId !== to.windowId && !(await arrive(pair, to, inside))) {
    return false;
  }
  if (!(await setPin(pair, to.pinned))) return false;
  if (!(await place(pair, to.index))) return false;
  if (!(await setGroup(pair, to.groupId))) return false;
  if (await isStillOneSplit(pair)) return true;
  const createSplit = createSplitApi();
  return (
    createSplit !== null &&
    succeeded(() => createSplit([pair.first, pair.second]))
  );
}

// True once both tabs are one split at the target. Never throws. A refusal leaves the tabs where Chrome has them.
export async function carryPair(
  pair: SplitPair,
  to: PairTarget
): Promise<boolean> {
  const tabs = await readPair(pair);
  if (tabs === null || !sharesOneSplit(tabs)) return false;
  const from = tabs.first;
  const inPlace =
    from.windowId === to.windowId &&
    from.index === to.index &&
    from.groupId === to.groupId &&
    from.pinned === to.pinned;
  if (inPlace) return true;
  const inside = await isInsideRun(pair, to);
  if (inside === null) return false;
  // A group holds no pinned tab, and tabGroups.move refuses a slot inside a run.
  const canGroup =
    Boolean(chrome.tabGroups) && !from.pinned && !to.pinned && !inside;
  const carried = canGroup
    ? await byGroupRoute(pair, from, to)
    : await byPlainRoute(pair, from, to, inside);
  return carried && (await isStillOneSplit(pair));
}
