import type { BrowserContext, Page } from '@playwright/test';

export interface ToolbarStub {
  // getUserSettings' isOnToolbar; 'absent' leaves getUserSettings undefined (before Chrome 91).
  pinned: boolean | 'absent';
  // false leaves onUserSettingsChanged undefined (before Chrome 130).
  event?: boolean;
}

type Listener = (change: { isOnToolbar?: boolean }) => void;

// KAN-7. Playwright cannot pin: every page's chrome.action toolbar members are replaced (Task 1, Q3).
export async function stubToolbarPin(
  context: BrowserContext,
  stub: ToolbarStub
): Promise<void> {
  await context.addInitScript(
    ({ pinned, event }: { pinned: boolean | 'absent'; event: boolean }) => {
      const action = (globalThis as { chrome?: { action?: object } }).chrome
        ?.action;
      if (!action) return;
      const state = { isOnToolbar: pinned === true };
      const listeners = new Set<Listener>();
      Object.defineProperty(action, 'getUserSettings', {
        value:
          pinned === 'absent' ? undefined : () => Promise.resolve({ ...state }),
        configurable: true,
      });
      Object.defineProperty(action, 'onUserSettingsChanged', {
        value: event
          ? {
              addListener: (l: Listener) => void listeners.add(l),
              removeListener: (l: Listener) => void listeners.delete(l),
              hasListener: (l: Listener) => listeners.has(l),
            }
          : undefined,
        configurable: true,
      });
      Object.defineProperty(globalThis, '__tabKeeperSetPin', {
        value: (next: boolean) => {
          state.isOnToolbar = next;
          listeners.forEach((listener) => listener({ isOnToolbar: next }));
        },
        configurable: true,
      });
    },
    { pinned: stub.pinned, event: stub.event ?? true }
  );
}

// The user pinning, or unpinning, in Chrome's puzzle menu.
export async function setPin(page: Page, pinned: boolean): Promise<void> {
  await page.evaluate((next) => {
    const set: unknown = Reflect.get(globalThis, '__tabKeeperSetPin');
    if (typeof set !== 'function')
      throw new Error('stubToolbarPin was not installed');
    set(next);
  }, pinned);
}
