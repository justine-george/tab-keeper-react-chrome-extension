// KAN-490 diagnostic (branch diag-kan-490, never merged): a record of each Open compact view press.
import type { PopupApi } from './openInPopup';

export const TRACE_KEY = 'diag.openInPopup';
const KEEP = 20;

type Step = [ms: number, what: string, detail?: string];

// The worker's age at load: a press that arrives within a second of it woke a cold worker.
const loadedAt = Date.now();

const popupCount = async (): Promise<number> =>
  (
    await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.POPUP],
    })
  ).length;

export function tracedPress(api: PopupApi): {
  api: PopupApi;
  finish: (fromTabId: number | undefined) => Promise<void>;
} {
  const start = Date.now();
  const steps: Step[] = [[0, 'press', `worker age ${start - loadedAt}ms`]];
  let checks: Promise<void> = Promise.resolve();
  const at = () => Date.now() - start;
  const note = (what: string, detail?: string) =>
    steps.push([at(), what, detail]);
  const watch = <T>(
    name: string,
    run: () => Promise<T>,
    show?: (v: T) => string
  ) => {
    note(`${name} call`);
    return run().then(
      (v) => {
        note(`${name} ok`, show?.(v));
        return v;
      },
      (e: unknown) => {
        note(`${name} err`, String(e));
        throw e;
      }
    );
  };
  const traced: PopupApi = {
    getURL: (p) => api.getURL(p),
    getTab: (id) =>
      watch(
        'getTab',
        () => api.getTab(id),
        (t) => JSON.stringify(t)
      ),
    normalTabIds: () =>
      watch(
        'normalTabIds',
        () => api.normalTabIds(),
        (ids) => `${ids.length} tabs`
      ),
    removeTab: (id) => watch('removeTab', () => api.removeTab(id)),
    windowExists: (id) =>
      watch('windowExists', () => api.windowExists(id), String),
    getPopup: () =>
      watch(
        'getPopup',
        () => api.getPopup(),
        (p) => p || "''"
      ),
    setPopup: (p) =>
      watch(
        'setPopup',
        () => api.setPopup(p),
        () => p || "''"
      ),
    openPopup: async (windowId) => {
      const result = await watch('openPopup', () => api.openPopup(windowId));
      // What Chrome said is one thing; whether a popup exists is the question. Read beside the press, not in its way.
      checks = (async () => {
        let waited = 0;
        for (const wait of [0, 100, 300, 1000]) {
          await new Promise((r) => setTimeout(r, wait - waited));
          waited = wait;
          note(`popups after ${wait}ms`, String(await popupCount()));
        }
      })();
      return result;
    },
    createTab: (props) => watch('createTab', () => api.createTab(props)),
  };
  const finish = async (fromTabId: number | undefined) => {
    note('done', `from tab ${fromTabId ?? 'none'}`);
    await checks;
    try {
      const stored = (await chrome.storage.local.get(TRACE_KEY))[TRACE_KEY];
      const list = Array.isArray(stored) ? stored : [];
      list.push({ at: new Date(start).toISOString(), steps });
      await chrome.storage.local.set({ [TRACE_KEY]: list.slice(-KEEP) });
    } catch (error) {
      console.warn('Could not store the trace:', error);
    }
  };
  return { api: traced, finish };
}
