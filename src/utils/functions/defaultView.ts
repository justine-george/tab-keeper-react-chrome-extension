// KAN-7 §7. What a click on the toolbar icon opens. Worker-safe, like popOut.ts:
// no window, no redux, chrome types only.
import { OPEN_IN_TAB_MESSAGE, openOrFocusTabView, type TabApi } from './popOut';

export type DefaultView = 'compact' | 'full';

// The worker's copy, in chrome.storage.local: it cannot read the page's localStorage.
export const DEFAULT_VIEW_KEY = 'defaultView';

export function asDefaultView(value: unknown): DefaultView {
  return value === 'full' ? 'full' : 'compact';
}

// '' removes the popup, so a click reaches action.onClicked instead.
export function popupFor(view: DefaultView): string {
  return view === 'full' ? '' : 'index.html';
}

export interface ActionApi {
  setPopup(details: { popup: string }): Promise<void>;
}

// Never rejects: a refusal is logged, and the next browser start applies it again.
export async function applyDefaultView(
  api: ActionApi,
  view: DefaultView
): Promise<boolean> {
  try {
    await api.setPopup({ popup: popupFor(view) });
    return true;
  } catch (error) {
    console.warn('Could not apply the default view:', error);
    return false;
  }
}

export interface DefaultViewStore {
  read(): Promise<unknown>;
}

// The worker at every start: what the page last chose, else compact.
export async function reapplyDefaultView(
  store: DefaultViewStore,
  api: ActionApi
): Promise<DefaultView> {
  let stored: unknown;
  try {
    stored = await store.read();
  } catch (error) {
    console.warn('Could not read the default view:', error);
  }
  const view = asDefaultView(stored);
  await applyDefaultView(api, view);
  return view;
}

// action.onClicked fires only while the popup is '' (Default view = Full).
export function openFullViewFromToolbar(
  api: TabApi,
  tab: Pick<chrome.tabs.Tab, 'windowId'>
): Promise<void> {
  return openOrFocusTabView(api, {
    type: OPEN_IN_TAB_MESSAGE,
    windowId: tab.windowId,
  });
}
