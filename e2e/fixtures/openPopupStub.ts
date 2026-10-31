import type { Worker } from '@playwright/test';

// Copied from open-in-popup.spec.ts (KAN-437): the headless harness has no
// popup to see, so the worker's chrome.action.openPopup records each call.

export interface OpenPopupCall {
  args: unknown[];
  // The popup set when it was called.
  popup: string;
  // Every tab's address when it was called, so a test can say what had closed first.
  openUrls: string[];
}

export async function stubOpenPopup(
  worker: Worker,
  refuse: boolean
): Promise<void> {
  await worker.evaluate((refuseIt) => {
    const calls: OpenPopupCall[] = [];
    Reflect.set(globalThis, 'openPopupCalls', calls);
    chrome.action.openPopup = async (...args: unknown[]) => {
      const tabs = await chrome.tabs.query({});
      calls.push({
        args,
        popup: await chrome.action.getPopup({}),
        openUrls: tabs.map((t) => t.url || t.pendingUrl || ''),
      });
      if (refuseIt) throw new Error('Failed to open popup.');
    };
  }, refuse);
}

// Unknown, as recorded: compare it with toEqual and asymmetric matchers.
export const openPopupCalls = (worker: Worker): Promise<unknown> =>
  worker.evaluate((): unknown => Reflect.get(globalThis, 'openPopupCalls'));
