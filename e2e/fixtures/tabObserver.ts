import type { Page, Worker } from '@playwright/test';

// §14: every tab and window change Chrome reports from now on; the run may cause only its own pin and its own full view.
export async function watchTabs(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const log: string[] = [];
    Reflect.set(globalThis, '__tabLog', log);
    const page = (url: string | undefined) =>
      (url ?? '').replace(/^chrome-extension:\/\/[^/]+\//, 'tk:');
    chrome.tabs.onCreated.addListener((tab) =>
      log.push(`created ${tab.id} ${page(tab.pendingUrl ?? tab.url)}`)
    );
    chrome.tabs.onRemoved.addListener((id) => log.push(`removed ${id}`));
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
      if (change.url !== undefined || change.status === 'loading')
        log.push(`loading ${id} ${page(tab.url)}`);
      if (change.pinned !== undefined)
        log.push(`pinned ${change.pinned} ${id} ${page(tab.url)}`);
    });
    chrome.tabs.onMoved.addListener((id) => log.push(`moved ${id}`));
    chrome.tabs.onAttached.addListener((id) => log.push(`attached ${id}`));
    chrome.tabs.onDetached.addListener((id) => log.push(`detached ${id}`));
    chrome.windows.onCreated.addListener((w) =>
      log.push(`window created ${w.id}`)
    );
    chrome.windows.onRemoved.addListener((id) =>
      log.push(`window removed ${id}`)
    );
  });
}

export const tabLog = (worker: Worker): Promise<string[]> =>
  worker.evaluate(() => {
    const log: unknown = Reflect.get(globalThis, '__tabLog');
    return Array.isArray(log) ? log.map(String) : [];
  });

// The tab a page the test opened lives in: the harness's stand-in for the popup, or a full view it opened.
export async function tabIdOf(page: Page): Promise<number> {
  const id = await page.evaluate(
    async () => (await chrome.tabs.getCurrent())?.id
  );
  if (id === undefined) throw new Error('the page is not in a tab');
  return id;
}

const FULL_VIEW = 'tk:index.html?view=tab';

// The run's own changes: Get started's or ⤢'s full view opening, and Pin this tab on it; and the test's own pages loading.
export function isRunsOwn(
  entry: string,
  testsOwn: readonly number[] = []
): boolean {
  const opened = /^(created|loading) (\d+) (.*)$/.exec(entry);
  if (opened !== null) {
    return opened[3] === FULL_VIEW || testsOwn.includes(Number(opened[2]));
  }
  return /^pinned true \d+ (.*)$/.exec(entry)?.[1] === FULL_VIEW;
}
