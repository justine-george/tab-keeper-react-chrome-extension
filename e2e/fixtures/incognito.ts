import type { BrowserContext, Worker } from '@playwright/test';
import { expect } from '@playwright/test';

// What chrome://extensions offers its own page, as much of it as this spec
// uses. Not in @types/chrome: developerPrivate is Chrome's private API behind
// the extensions page.
interface DeveloperPrivate {
  updateProfileConfiguration(update: {
    inDeveloperMode: boolean;
  }): Promise<void>;
  updateExtensionConfiguration(update: {
    extensionId: string;
    incognitoAccess: boolean;
  }): Promise<void>;
  getExtensionInfo(id: string): Promise<{ state: string }>;
}

// KAN-280 Part E Task 1 Q4's recipe: "Allow in Incognito" set from
// chrome://extensions, with developer mode on first (without it the unpacked
// copy reloads DISABLED). The extension reloads, which closes its pages and
// stops its worker; resolves to the worker that registers in its place
// (measured KAN-460 Part 3: it handles a restore).
export async function allowInIncognito(
  context: BrowserContext,
  extensionId: string
): Promise<Worker> {
  const before = new Set(context.serviceWorkers());
  const settings = await context.newPage();
  await settings.goto('chrome://extensions');
  const state = await settings.evaluate(async (id) => {
    const found: unknown = Reflect.get(chrome, 'developerPrivate');
    const isDeveloperPrivate = (x: unknown): x is DeveloperPrivate =>
      typeof x === 'object' &&
      x !== null &&
      typeof Reflect.get(x, 'updateProfileConfiguration') === 'function' &&
      typeof Reflect.get(x, 'updateExtensionConfiguration') === 'function' &&
      typeof Reflect.get(x, 'getExtensionInfo') === 'function';
    if (!isDeveloperPrivate(found)) return 'no developerPrivate';
    await found.updateProfileConfiguration({ inDeveloperMode: true });
    await new Promise((r) => setTimeout(r, 300));
    await found.updateExtensionConfiguration({
      extensionId: id,
      incognitoAccess: true,
    });
    for (let i = 0; i < 50; i++) {
      const info = await found.getExtensionInfo(id);
      if (info.state === 'ENABLED') return info.state;
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'never re-enabled';
  }, extensionId);
  expect(state).toBe('ENABLED');
  await settings.close();
  return (
    context.serviceWorkers().find((w) => !before.has(w)) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (w) => !before.has(w),
    }))
  );
}
