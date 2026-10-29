import { rmSync } from 'node:fs';

import type { BrowserContext, Page, Worker } from '@playwright/test';

// KAN-766. Each worker keeps one browser and resets it between tests. On by
// default locally (KAN-771), off on CI, where every test gets a fresh profile;
// E2E_REUSE_BROWSER=1 or =0 picks either anywhere.
export function reusesBrowser(env: NodeJS.ProcessEnv): boolean {
  const pick = env.E2E_REUSE_BROWSER;
  if (pick === undefined) return !env.CI;
  if (pick === '1') return true;
  if (pick === '0') return false;
  throw new Error(`E2E_REUSE_BROWSER is 1 or 0, not "${pick}"`);
}

export const REUSE_BROWSER = reusesBrowser(process.env);

export interface LaunchedBrowser {
  context: BrowserContext;
  // Runs after the context closes: removes the profile and any scratch copy.
  removeFiles: () => void;
}

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Held extends LaunchedBrowser {
  // Every launch option, so a test with other options gets its own browser.
  key: string;
  // Where a fresh launch put its first window; a reset puts it back.
  bounds: Bounds;
}

type Disposable = { dispose: () => Promise<void> };

// Playwright's emitter has these at run time; its types leave them out.
interface ListenerRegistry {
  eventNames(): (string | symbol)[];
  listeners(event: string | symbol): unknown[];
  off(event: string | symbol, listener: unknown): unknown;
}

function isListenerRegistry(x: object): x is ListenerRegistry {
  return ['eventNames', 'listeners', 'off'].every(
    (name) => typeof Reflect.get(x, name) === 'function'
  );
}

// Every listener on the context now, so the ones a test adds can be told apart.
function listenersNow(
  context: BrowserContext
): Map<string | symbol, unknown[]> {
  if (!isListenerRegistry(context)) throw new Error('no listener registry');
  return new Map(
    context.eventNames().map((event) => [event, [...context.listeners(event)]])
  );
}

// A live worker, or none: one stopped or uninstalled by a test does not come back.
function liveWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers()[0];
}

// Over CDP: windows.update refuses a window less than half on screen, and
// headless Chromium's 800x600 screen holds half of a 1280x720 launch window.
async function windowBounds(page: Page): Promise<Bounds> {
  const cdp = await page.context().newCDPSession(page);
  const { bounds } = await cdp.send('Browser.getWindowForTarget');
  await cdp.detach();
  return {
    left: bounds.left ?? 0,
    top: bounds.top ?? 0,
    width: bounds.width ?? 0,
    height: bounds.height ?? 0,
  };
}

async function putWindowBack(page: Page, bounds: Bounds): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  // A minimized or maximized window takes no bounds until it is normal.
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'normal' },
  });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  await cdp.detach();
}

// Without developer mode an unpacked extension reloads disabled (incognito.ts).
async function turnOnDeveloperMode(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  await page.evaluate(async () => {
    const api: unknown = Reflect.get(chrome, 'developerPrivate');
    const update: unknown =
      typeof api === 'object' && api !== null
        ? Reflect.get(api, 'updateProfileConfiguration')
        : undefined;
    if (typeof update !== 'function') throw new Error('no developerPrivate');
    await Reflect.apply(update, api, [{ inDeveloperMode: true }]);
  });
  await page.close();
}

// What a test registers on the context outlives it; this undoes it.
class TestRegistrations {
  private readonly disposables: Disposable[] = [];
  private readonly listenersBefore: Map<string | symbol, unknown[]>;
  // Playwright cannot uninstall a clock, and page.clock is the context's.
  private clockUsed = false;

  constructor(private readonly context: BrowserContext) {
    this.listenersBefore = listenersNow(context);
    const track = <T extends Disposable>(made: T): T => {
      this.disposables.push(made);
      return made;
    };
    const addInitScript = context.addInitScript.bind(context);
    const exposeFunction = context.exposeFunction.bind(context);
    const exposeBinding = context.exposeBinding.bind(context);
    context.addInitScript = async (script, arg, options) =>
      track(await addInitScript(script, arg, options));
    context.exposeFunction = async (name, callback) =>
      track(await exposeFunction(name, callback));
    context.exposeBinding = async (name, binding) =>
      track(await exposeBinding(name, binding));

    const { clock } = context;
    const used = () => {
      this.clockUsed = true;
    };
    const install = clock.install.bind(clock);
    const pauseAt = clock.pauseAt.bind(clock);
    const setFixedTime = clock.setFixedTime.bind(clock);
    const setSystemTime = clock.setSystemTime.bind(clock);
    const fastForward = clock.fastForward.bind(clock);
    const runFor = clock.runFor.bind(clock);
    const resume = clock.resume.bind(clock);
    clock.install = (options) => (used(), install(options));
    clock.pauseAt = (time) => (used(), pauseAt(time));
    clock.setFixedTime = (time) => (used(), setFixedTime(time));
    clock.setSystemTime = (time) => (used(), setSystemTime(time));
    clock.fastForward = (ticks) => (used(), fastForward(ticks));
    clock.runFor = (ticks) => (used(), runFor(ticks));
    clock.resume = () => (used(), resume());
  }

  async undo(): Promise<void> {
    const { context } = this;
    // The patched methods are own properties; deleting them uncovers the prototype's.
    Reflect.deleteProperty(context, 'addInitScript');
    Reflect.deleteProperty(context, 'exposeFunction');
    Reflect.deleteProperty(context, 'exposeBinding');
    for (const name of [
      'install',
      'pauseAt',
      'setFixedTime',
      'setSystemTime',
      'fastForward',
      'runFor',
      'resume',
    ]) {
      Reflect.deleteProperty(context.clock, name);
    }
    if (this.clockUsed) throw new Error('the clock was installed');
    // Not removeAllListeners: Playwright's own close() waits on a listener.
    for (const [event, listeners] of listenersNow(context)) {
      const before = this.listenersBefore.get(event) ?? [];
      for (const listener of listeners) {
        if (!before.includes(listener) && isListenerRegistry(context)) {
          context.off(event, listener);
        }
      }
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    for (const made of this.disposables) await made.dispose();
    await context.clearPermissions();
    await context.clearCookies();
    await context.setOffline(false);
  }
}

// Back to what a fresh profile has: one window with one blank tab where the
// launch put it, empty storage, no optional permission, a newly started worker.
async function resetProfile(held: Held): Promise<void> {
  const { context } = held;
  const worker = liveWorker(context);
  if (!worker) throw new Error('no live service worker');
  if (
    await worker.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
  ) {
    throw new Error('incognito access was granted');
  }

  const keep: Page = await context.newPage();
  await Promise.all(
    context.pages().flatMap((page) => (page === keep ? [] : [page.close()]))
  );
  const left = await worker.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    const [win] = windows;
    if (windows.length !== 1 || win?.id === undefined) {
      return `${windows.length} windows`;
    }
    if (win.tabs?.length !== 1) return `${win.tabs?.length} tabs`;
    await chrome.windows.update(win.id, { focused: true });
    const optional: string[] =
      chrome.runtime.getManifest().optional_permissions ?? [];
    const { permissions = [] } = await chrome.permissions.getAll();
    await chrome.permissions.remove({
      permissions: permissions.filter((p) => optional.includes(p)),
    });
    await Promise.all([
      chrome.storage.local.clear(),
      chrome.storage.sync.clear(),
      chrome.storage.session.clear(),
    ]);
    return '';
  });
  if (left) throw new Error(`left behind: ${left}`);
  await putWindowBack(keep, held.bounds);

  // Page storage, which chrome.storage.clear does not reach. Not service_workers:
  // that would unregister the extension's own worker.
  const cdp = await context.newCDPSession(keep);
  await cdp.send('Storage.clearDataForOrigin', {
    origin: new URL(worker.url()).origin,
    storageTypes: 'local_storage,indexeddb,cache_storage,file_systems,websql',
  });
  await cdp.detach();

  // Cleared first, so onInstalled ('update' here) finds what an install finds.
  const started = context.waitForEvent('serviceworker', {
    predicate: (w) => w !== worker,
    timeout: 5_000,
  });
  // Deferred, so the evaluate returns before the worker it runs in stops.
  await worker.evaluate(() => {
    setTimeout(() => chrome.runtime.reload(), 0);
  });
  const fresh = await started;
  // KAN-861. That update records What's new's since-version; an install records none.
  await fresh.evaluate(async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { whatsNewSince } = await chrome.storage.local.get('whatsNewSince');
      if (whatsNewSince !== undefined) {
        await chrome.storage.local.remove('whatsNewSince');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the reload recorded no whatsNewSince');
  });
}

// One browser per worker. A test that fails, or one whose reset fails, gets
// its browser closed instead, and the next test launches a new one.
export class ReusedBrowser {
  private held: Held | undefined;
  private registrations: TestRegistrations | undefined;

  async take(
    key: string,
    launch: () => Promise<LaunchedBrowser>
  ): Promise<BrowserContext> {
    if (this.held?.key !== key) {
      await this.close();
      const launched = await launch();
      const [first] = launched.context.pages();
      if (!first) throw new Error('launched without a page');
      const bounds = await windowBounds(first);
      await turnOnDeveloperMode(launched.context);
      this.held = { ...launched, key, bounds };
    }
    this.registrations = new TestRegistrations(this.held.context);
    return this.held.context;
  }

  async giveBack(passed: boolean): Promise<void> {
    const { held, registrations } = this;
    this.registrations = undefined;
    if (!held) return;
    if (!passed) {
      await this.close();
      return;
    }
    try {
      await registrations?.undo();
      await resetProfile(held);
    } catch (error) {
      console.warn(
        `KAN-766 no reset, the next test launches: ${String(error)}`
      );
      await this.close();
    }
  }

  async close(): Promise<void> {
    const { held } = this;
    this.held = undefined;
    if (!held) return;
    await held.context.close();
    held.removeFiles();
  }
}

export function removeDirs(...dirs: string[]): () => void {
  return () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  };
}
