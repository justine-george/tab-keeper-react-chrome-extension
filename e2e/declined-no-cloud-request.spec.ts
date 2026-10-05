import type { BrowserContext, Page, Route } from '@playwright/test';

import { CLOUD, countCloudRequests, hasCloudConfig } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { POPUP, storedSettings } from './fixtures/onboarding';

// KAN-419. A user who declined sync sends nothing to Google, though an earlier sync left a stored Firebase user.

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

// The client never checks the signature; it reads the payload's times.
function fakeIdToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ iat: now, exp: now + 3600, auth_time: now, sub: 'e2e-anon' }),
    'sig',
  ].join('.');
}

const CORS = { 'access-control-allow-origin': '*' };

// Answers sign-up and lookup so the real SDK stores a user; aborts the rest.
function answerSignIn(route: Route) {
  const url = route.request().url();
  if (url.includes('accounts:signUp')) {
    return route.fulfill({
      headers: CORS,
      json: {
        idToken: fakeIdToken(),
        refreshToken: 'e2e-refresh',
        expiresIn: '3600',
        localId: 'e2e-anon',
      },
    });
  }
  if (url.includes('accounts:lookup')) {
    return route.fulfill({
      headers: CORS,
      json: { users: [{ localId: 'e2e-anon' }] },
    });
  }
  return route.abort();
}

// The uid Firebase stored in this profile; never creates the database itself.
function storedUid(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb');
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const rows = db
            .transaction('firebaseLocalStorage')
            .objectStore('firebaseLocalStorage')
            .getAll();
          rows.onsuccess = () => {
            db.close();
            const user = rows.result.find((row) =>
              String(row.fbase_key).startsWith('firebase:authUser:')
            );
            resolve(user ? String(user.value.uid) : null);
          };
        };
      })
  );
}

// Waits for the network to go quiet, then for the app.
async function open(
  context: BrowserContext,
  extensionId: string,
  path = 'index.html'
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/${path}`, {
    waitUntil: 'networkidle',
  });
  if (path === 'index.html') {
    await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  }
  return page;
}

// A synced 1.8.0 user: Auto Sync on, a stored Firebase user, a past sync, no consent answer.
async function stageSyncedUser(
  context: BrowserContext,
  extensionId: string
): Promise<void> {
  await context.route(CLOUD, answerSignIn);
  const page = await open(context, extensionId);
  await expect.poll(() => storedUid(page)).toBe('e2e-anon');
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...settings,
        cloudConsent: '',
        lastSyncedTime: Date.now(),
      })
    );
  });
  await page.close();
  await context.unroute(CLOUD, answerSignIn);
}

// The ticket's path: the "currently synced" dialog, answered.
async function answerTheDialog(
  page: Page,
  answer: 'Turn off sync' | 'Keep sync on'
): Promise<void> {
  const dialog = page.getByRole('dialog', {
    name: 'Your sessions are currently synced',
    exact: true,
  });
  await dialog.getByRole('button', { name: answer, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await storedSettings(page)).cloudConsent).toBe(
    answer === 'Turn off sync' ? 'declined' : 'granted'
  );
}

test.describe('a declined user and Firebase (KAN-419)', () => {
  test.beforeEach(() => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  });

  test('declining, then two opens and the export page, send nothing to Google', async ({
    context,
    extensionId,
  }) => {
    await stageSyncedUser(context, extensionId);
    const hits = await countCloudRequests(context);

    await answerTheDialog(await open(context, extensionId), 'Turn off sync');
    const again = await open(context, extensionId);
    await open(context, extensionId);
    await open(context, extensionId, 'export.html');

    expect(await storedUid(again)).toBe('e2e-anon');
    expect(hits).toEqual([]);
  });

  test('CONTROL: the same counter, at the same barrier, sees a synced user reach Google', async ({
    context,
    extensionId,
  }) => {
    await stageSyncedUser(context, extensionId);
    const hits = await countCloudRequests(context);

    await answerTheDialog(await open(context, extensionId), 'Keep sync on');
    await open(context, extensionId);
    await open(context, extensionId);

    expect(hits.some((url) => url.includes('accounts:lookup'))).toBe(true);
  });

  test('after declining, Sync now and a yes start a sync as the stored user', async ({
    context,
    extensionId,
  }) => {
    await stageSyncedUser(context, extensionId);
    await answerTheDialog(await open(context, extensionId), 'Turn off sync');
    const hits = await countCloudRequests(context);

    const page = await open(context, extensionId);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page
      .getByRole('dialog', {
        name: 'Sync your sessions across devices?',
        exact: true,
      })
      .getByRole('button', { name: 'Sync', exact: true })
      .click();

    await expect
      .poll(() => hits.some((url) => url.includes('documents:batchGet')))
      .toBe(true);
    expect(hits.some((url) => url.includes('accounts:signUp'))).toBe(false);
    expect(await storedUid(page)).toBe('e2e-anon');
  });
});

test.describe('a declined user turns sync back on, against the dev cloud (KAN-419)', () => {
  test.use({ cloud: true });

  test('the sync completes as the same Firebase user, with no new sign-up', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const first = await open(context, extensionId);
    await expect
      .poll(async () => typeof (await storedSettings(first)).lastSyncedTime, {
        timeout: 15_000,
      })
      .toBe('number');
    const uid = await storedUid(first);
    expect(uid).not.toBeNull();
    await first.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
      localStorage.setItem(
        'settingsData',
        JSON.stringify({ ...settings, cloudConsent: '' })
      );
    });
    await first.close();

    const requests: string[] = [];
    context.on('request', (request) => {
      if (CLOUD.test(request.url())) requests.push(request.url());
    });
    await answerTheDialog(await open(context, extensionId), 'Turn off sync');
    const page = await open(context, extensionId);
    expect(requests).toEqual([]);

    const before = Number((await storedSettings(page)).lastSyncedTime);
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page
      .getByRole('dialog', {
        name: 'Sync your sessions across devices?',
        exact: true,
      })
      .getByRole('button', { name: 'Sync', exact: true })
      .click();

    await expect
      .poll(async () => Number((await storedSettings(page)).lastSyncedTime), {
        timeout: 15_000,
      })
      .toBeGreaterThan(before);
    expect(await storedUid(page)).toBe(uid);
    expect(requests.filter((url) => url.includes('accounts:signUp'))).toEqual(
      []
    );
  });
});
