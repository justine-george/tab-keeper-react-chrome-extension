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

export const FULL_VIEW = 'tk:index.html?view=tab';

export async function tabIdOf(page: Page): Promise<number> {
  const id = await page.evaluate(
    async () => (await chrome.tabs.getCurrent())?.id
  );
  if (id === undefined) throw new Error('the page is not in a tab');
  return id;
}

const asLogged = (url: string) =>
  url.replace(/^chrome-extension:\/\/[^/]+\//, 'tk:');

// The tabs the test itself opened, each with the address it opened it at, and those it closed.
export class TestTabs {
  readonly opened = new Map<number, string>();
  readonly closed = new Set<number>();
  private readonly ids = new Map<Page, number>();

  async add(page: Page): Promise<void> {
    const id = await tabIdOf(page);
    this.ids.set(page, id);
    this.opened.set(id, asLogged(page.url()));
  }

  async close(page: Page): Promise<void> {
    const id = this.ids.get(page);
    if (id === undefined) throw new Error('not a page the test opened');
    this.closed.add(id);
    await page.close();
  }
}

// What the run may do beyond nothing: open one full view of its own (Get started, ⤢), and pin it once (Pin this tab).
export interface RunMay {
  fullView: boolean;
  pin: boolean;
}

// Every entry neither the run nor the test may cause, read in order.
export function notTheRunsOwn(
  log: readonly string[],
  tests: TestTabs,
  may: RunMay
): string[] {
  const reached = new Set<number>();
  let runFullView: number | null = null;
  let pins = 0;
  return log.filter((entry) => {
    const tab = /^(created|loading|removed) (\d+) ?(.*)$/.exec(entry);
    const pinned = /^pinned true (\d+) (.*)$/.exec(entry);
    if (tab !== null) {
      const [, kind, idText, url] = tab;
      const id = Number(idText);
      const testUrl = tests.opened.get(id);
      if (testUrl !== undefined) {
        // Opened blank, then sent to its address; reloaded there; closed by the test.
        if (kind === 'removed') return !tests.closed.has(id);
        if (url === testUrl) {
          reached.add(id);
          return false;
        }
        return !(url === 'about:blank' || url === '') || reached.has(id);
      }
      if (kind === 'created' && url === FULL_VIEW) {
        if (!may.fullView || runFullView !== null) return true;
        runFullView = id;
        return false;
      }
      return !(kind === 'loading' && id === runFullView && url === FULL_VIEW);
    }
    if (pinned !== null) {
      const ok = may.pin && Number(pinned[1]) === runFullView && pins === 0;
      pins += 1;
      return !ok;
    }
    return true;
  });
}

// CONTROL entries that are not the row's Open: anything but a new window, and the new tabs and what happens to them.
export function notTheOpen(entries: readonly string[]): string[] {
  const idOf = (entry: string) =>
    /^(?:created|loading|removed|moved|attached|detached|pinned \w+) (\d+)/.exec(
      entry
    )?.[1];
  const made = new Set(
    entries.flatMap((e) => (e.startsWith('created ') ? (idOf(e) ?? []) : []))
  );
  return entries.filter((entry) => {
    if (/^window created \d+$/.test(entry)) return false;
    const id = idOf(entry);
    return id === undefined || !made.has(id);
  });
}
