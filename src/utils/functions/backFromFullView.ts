// KAN-509. Under Default view Full, the full view's Back: the tab KAN-507 would go back to, with no popup.
// The page asks; the worker acts. planBack is shared, so the button's disabled state and the press agree.
// Worker-safe, like openInPopup.ts: no window, no redux, chrome types only.
import { tabToReturnTo, type FullViewTabRef } from './fullViewOrigin';
import { chromePopupApi, type PopupApi } from './openInPopup';

export const RETURN_FROM_FULL_VIEW_MESSAGE = 'returnFromFullView';

export interface ReturnFromFullViewRequest {
  type: typeof RETURN_FROM_FULL_VIEW_MESSAGE;
}

export function isReturnFromFullViewRequest(
  message: unknown
): message is ReturnFromFullViewRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === RETURN_FROM_FULL_VIEW_MESSAGE
  );
}

// The page's half: its tab may close, so it waits for nothing.
export function requestReturn(): void {
  const request: ReturnFromFullViewRequest = {
    type: RETURN_FROM_FULL_VIEW_MESSAGE,
  };
  chrome.runtime.sendMessage(request).catch((error: unknown) => {
    console.warn('Could not ask to go back:', error);
  });
}

// What a press would do. A switch closes the full view it leaves unless it is pinned.
export type BackPlan =
  | { kind: 'switch'; tabId: number; closes: boolean }
  | { kind: 'close' }
  | { kind: 'none' };

// KAN-578: whether the press closes the full view, so the page can warn first.
export function backCloses(plan: BackPlan): boolean {
  return plan.kind === 'close' || (plan.kind === 'switch' && plan.closes);
}

export interface BackFacts {
  fullView: FullViewTabRef & { pinned: boolean };
  origin: number | undefined;
  recent: readonly number[];
  // Normal tabs in the full view's window, in tab order, and in every window.
  windowTabIds: readonly number[];
  openTabIds: readonly number[];
}

// A recorded tab to switch to; else, beside other tabs, close an unpinned full view or
// leave a pinned one for its neighbour (KAN-580: so a Pin from the card has somewhere to go).
export function planBack(facts: BackFacts): BackPlan {
  const { fullView } = facts;
  const others = facts.openTabIds.filter((id) => id !== fullView.tabId);
  const target = tabToReturnTo(facts.origin, facts.recent, others);
  if (target !== undefined)
    return { kind: 'switch', tabId: target, closes: !fullView.pinned };
  if (!fullView.pinned)
    return facts.windowTabIds.some((id) => id !== fullView.tabId)
      ? { kind: 'close' }
      : { kind: 'none' };
  const neighbour = neighbourOf(fullView.tabId, facts.windowTabIds);
  return neighbour === undefined
    ? { kind: 'none' }
    : { kind: 'switch', tabId: neighbour, closes: false };
}

// The tab to its right, else to its left.
function neighbourOf(
  tabId: number,
  tabIds: readonly number[]
): number | undefined {
  const at = tabIds.indexOf(tabId);
  if (at === -1) return undefined;
  return tabIds[at + 1] ?? tabIds[at - 1];
}

export type BackApi = Pick<
  PopupApi,
  | 'getTab'
  | 'normalTabIds'
  | 'originOf'
  | 'recentTabsIn'
  | 'activate'
  | 'removeTab'
> & {
  tabIdsInWindow(windowId: number): Promise<number[]>;
};

export const chromeBackApi: BackApi = {
  getTab: (tabId) => chromePopupApi.getTab(tabId),
  normalTabIds: () => chromePopupApi.normalTabIds(),
  originOf: (fullView) => chromePopupApi.originOf(fullView),
  recentTabsIn: (windowId) => chromePopupApi.recentTabsIn(windowId),
  activate: (tabId) => chromePopupApi.activate(tabId),
  removeTab: (tabId) => chromePopupApi.removeTab(tabId),
  tabIdsInWindow: async (windowId) =>
    (await chrome.tabs.query({ windowId })).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id]
    ),
};

// Never rejects: the page waits for no answer, so every failure is logged.
export async function returnFromFullView(
  api: BackApi,
  fromTabId: number | undefined
): Promise<void> {
  if (fromTabId === undefined) return;
  try {
    const tab = await api.getTab(fromTabId);
    const fullView = { tabId: fromTabId, windowId: tab.windowId };
    const [openTabIds, windowTabIds] = await Promise.all([
      api.normalTabIds(),
      api.tabIdsInWindow(tab.windowId),
    ]);
    let origin: number | undefined;
    let recent: readonly number[] = [];
    try {
      origin = await api.originOf(fullView);
      recent = await api.recentTabsIn(tab.windowId);
    } catch (error) {
      console.warn('Could not read where to go back to:', error);
    }
    const plan = planBack({
      fullView: { ...fullView, pinned: tab.pinned },
      origin,
      recent,
      windowTabIds,
      openTabIds,
    });
    if (plan.kind === 'none') return;
    if (plan.kind === 'switch') await api.activate(plan.tabId);
    if (backCloses(plan)) await api.removeTab(fromTabId);
  } catch (error) {
    console.warn('Could not go back from the full view:', error);
  }
}
