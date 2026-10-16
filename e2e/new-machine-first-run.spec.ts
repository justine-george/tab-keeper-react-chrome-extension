import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  CLOUD,
  commitLanded,
  hasCloudConfig,
  launchProfile,
  seedOnce,
  workerOf,
  type Profile,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { POPUP, waitForFullView } from './fixtures/onboarding';
import {
  cardAt,
  cardButton,
  closeReplayNote,
  finishFullRun,
  pastCompactViewCard,
} from './fixtures/run';
import { saveRowSaveAll } from './fixtures/sessionActions';
import { isValidTabMasterContainer } from '../src/utils/functions/local';
import { SAMPLE_ID_PREFIX } from '../src/utils/functions/sampleSession';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-599. A new machine's first run: device A has synced its sessions; device
// B is a fresh install whose Chrome Sync has already brought A's id. B goes
// through the welcome, says yes to sync, and gets A's sessions; B's own save
// reaches A, and the run's example reaches neither. Needs a build with the
// Firebase config; it skips without one (CI, KAN-147).

const tab = (id: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
});
const windowOf = (id: string, ids: string[]) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: ids.length,
  title: id,
  tabs: ids.map(tab),
});

const A1 = buildSession({
  tabGroupId: 'A1',
  title: 'Work',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  lastModified: Date.UTC(2026, 8, 1, 9, 0, 0),
  windowCount: 2,
  tabCount: 3,
  windows: [windowOf('wa', ['a0', 'a1']), windowOf('wb', ['b0'])],
});
const A2 = buildSession({
  tabGroupId: 'A2',
  title: 'Lisbon trip',
  createdAt: Date.UTC(2026, 8, 1, 8, 0, 0),
  createdTime: '2026-09-01 08:00:00',
  lastModified: Date.UTC(2026, 8, 1, 8, 0, 0),
  windowCount: 1,
  tabCount: 1,
  windows: [windowOf('wc', ['c0'])],
});

// B's own page, so the run's save step has something to save.
const B_PAGE = 'https://b-machine.test/';
const B_TITLE = 'Notes from B';

const welcome = (page: Page) =>
  page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true });
const ask = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Sync your sessions across devices?',
    exact: true,
  });
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const autoSyncOn = (scope: ReturnType<Page['locator']> | Page) =>
  scope
    .getByRole('group', { name: 'Auto Sync' })
    .getByRole('button', { name: 'On', exact: true });

interface Saved {
  sessions: { id: string; title: string; tabs: string[][] }[];
}

// What a page has on disk: nothing yet reads as empty.
async function saved(page: Page): Promise<Saved> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  if (!isValidTabMasterContainer(parsed)) return { sessions: [] };
  return {
    sessions: parsed.tabGroups.map((g) => ({
      id: g.tabGroupId,
      title: g.title,
      tabs: g.windows.map((w) => w.tabs.map((t) => t.tabId)),
    })),
  };
}

const titles = async (page: Page) =>
  (await saved(page)).sessions.map((s) => s.title).sort();

const tabsOf = async (page: Page, id: string) =>
  (await saved(page)).sessions.find((s) => s.id === id)?.tabs;

// Device A: synced sessions in the cloud. Returns its page and its id.
async function deviceA(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker
): Promise<{ page: Page; token: string }> {
  await seedOnce(context, [A1, A2]);
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  const started = commitLanded(page);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  expect(await started, "device A's startup sync never wrote").toBe(true);
  const token = await serviceWorker.evaluate(async () => {
    const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
    return typeof tokenValue === 'string' ? tokenValue : null;
  });
  if (token === null) throw new Error('device A has no tokenValue');
  return { page, token };
}

interface NewMachine {
  profile: Profile;
  popup: Page;
  // Every cloud request B has made, by URL.
  cloud: string[];
  // Chrome Sync bringing A's id to B now.
  bring(token: string): Promise<void>;
  storedId(): Promise<unknown>;
}

// Device B: a fresh install, its popup open at the welcome. With a token, Chrome Sync brought A's id before the first open.
async function newMachine(token: string | null): Promise<NewMachine> {
  const profile = await launchProfile();
  try {
    const { context } = profile;
    const cloud: string[] = [];
    context.on('request', (r) => {
      if (CLOUD.test(r.url())) cloud.push(r.url());
    });
    await context.route(B_PAGE, (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<title>${B_TITLE}</title>`,
      })
    );
    const worker = await workerOf(context);
    const bring = async (t: string) => {
      await worker.evaluate(
        (id: string) => chrome.storage.sync.set({ tokenValue: id }),
        t
      );
    };
    const storedId = () =>
      worker.evaluate(
        async () => (await chrome.storage.sync.get(['tokenValue'])).tokenValue
      );
    if (token !== null) await bring(token);
    const own = await context.newPage();
    await own.goto(B_PAGE);
    const popup = await context.newPage();
    await popup.setViewportSize(POPUP);
    await popup.goto(
      `chrome-extension://${new URL(worker.url()).host}/index.html`
    );
    await expect(welcome(popup)).toBeVisible();
    return { profile, popup, cloud, bring, storedId };
  } catch (e) {
    await profile.close();
    throw e;
  }
}

// Show me here, the run's save, Skip, `beforeYes`; then Auto Sync on in Settings and Sync. Resolves when the yes's write lands.
async function saveInRunThenSync(
  popup: Page,
  beforeYes: () => Promise<void> = async () => {}
): Promise<boolean> {
  await welcome(popup)
    .getByRole('button', { name: 'Show me here', exact: true })
    .click();
  await expect(cardAt(popup, 1)).toBeVisible();
  await saveRowSaveAll(popup).click();
  await expect(cardAt(popup, 2)).toBeVisible();
  await cardButton(popup, 'Skip tutorial').click();
  await closeReplayNote(popup);
  expect(await titles(popup)).toEqual([B_TITLE]);
  await beforeYes();
  await popup.locator('[aria-label="Settings"]').click();
  await popup.locator('button[aria-label="Sync & Backup"]').click();
  await autoSyncOn(popup).click();
  await expect(ask(popup)).toBeVisible();
  const wrote = commitLanded(popup);
  await ask(popup).getByRole('button', { name: 'Sync', exact: true }).click();
  return wrote;
}

// A has nothing of B's but what B saved, and lost nothing of its own.
async function expectAHas(page: Page, expected: string[]): Promise<void> {
  const read = page.waitForResponse(/firestore\.googleapis\.com/, {
    timeout: 20_000,
  });
  await page.reload();
  await read;
  await expect.poll(() => titles(page)).toEqual(expected);
  expect(await tabsOf(page, 'A1')).toEqual([['a0', 'a1'], ['b0']]);
  expect(await tabsOf(page, 'A2')).toEqual([['c0']]);
}

test.describe("a new machine's first run picks up the other machine's sessions (KAN-599)", () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('Show me here, a save during the run, then Auto Sync on in Settings and Sync: A’s sessions arrive, and B’s save reaches A', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const a = await deviceA(context, extensionId, serviceWorker);
    const b = await newMachine(a.token);
    try {
      const { popup } = b;
      let bSave = '';
      const wrote = await saveInRunThenSync(popup, async () => {
        bSave = (await saved(popup)).sessions[0].id;
        // Nothing leaves B before the yes.
        expect(b.cloud).toEqual([]);
      });

      await expect
        .poll(() => titles(popup))
        .toEqual(['Lisbon trip', B_TITLE, 'Work']);
      expect(await tabsOf(popup, 'A1')).toEqual([['a0', 'a1'], ['b0']]);
      expect(await tabsOf(popup, 'A2')).toEqual([['c0']]);
      expect(wrote, "B's save never reached the cloud").toBe(true);

      await expectAHas(a.page, ['Lisbon trip', B_TITLE, 'Work']);
      expect((await saved(a.page)).sessions.map((s) => s.id)).toContain(bSave);
    } finally {
      await b.profile.close();
    }
  });

  // The race: Chrome Sync brings A's id after B's first open. B used to mint its own at that open and keep it.
  test('A’s id arriving after the first open, before the yes: B mints none, and the yes picks up A’s sessions on that open', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const a = await deviceA(context, extensionId, serviceWorker);
    const b = await newMachine(null);
    try {
      const { popup } = b;
      const wrote = await saveInRunThenSync(popup, async () => {
        expect(await b.storedId()).toBeUndefined();
        await b.bring(a.token);
      });
      await expect
        .poll(() => titles(popup))
        .toEqual(['Lisbon trip', B_TITLE, 'Work']);
      expect(wrote, "B's save never reached the cloud").toBe(true);
      expect(await b.storedId()).toBe(a.token);
      await expectAHas(a.page, ['Lisbon trip', B_TITLE, 'Work']);
    } finally {
      await b.profile.close();
    }
  });

  test('A’s id arriving after B has synced under its own: the open page follows it, and B’s save reaches A', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const a = await deviceA(context, extensionId, serviceWorker);
    const b = await newMachine(null);
    try {
      const { popup } = b;
      expect(await saveInRunThenSync(popup)).toBe(true);
      const own = await b.storedId();
      expect(typeof own === 'string' && own !== a.token).toBe(true);
      expect(await titles(popup)).toEqual([B_TITLE]);

      // Auto Sync is on: following the id syncs with A's doc, no reopen.
      const wrote = commitLanded(popup);
      await b.bring(a.token);
      await expect
        .poll(() => titles(popup))
        .toEqual(['Lisbon trip', B_TITLE, 'Work']);
      expect(await wrote, "B's save never reached A's doc").toBe(true);
      await expectAHas(a.page, ['Lisbon trip', B_TITLE, 'Work']);
    } finally {
      await b.profile.close();
    }
  });

  test('Get started, the example, then Auto Sync on in setup and Sync: A’s sessions arrive, and the example reaches neither', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const a = await deviceA(context, extensionId, serviceWorker);
    const b = await newMachine(a.token);
    try {
      await welcome(b.popup)
        .getByRole('button', { name: 'Get started', exact: true })
        .click();
      const full = await waitForFullView(b.profile.context);
      await pastCompactViewCard(full);
      // The example is the run's session, and the run's end removes it.
      await finishFullRun(full);
      await expect(setup(full)).toBeVisible();
      expect(await titles(full)).toEqual([]);
      expect(b.cloud).toEqual([]);

      for (let n = 0; n < 4; n++) {
        await setup(full)
          .getByRole('button', { name: 'Next', exact: true })
          .click();
      }
      await expect(
        setup(full).getByRole('heading', { name: 'Sync across your devices?' })
      ).toBeVisible();
      await autoSyncOn(setup(full)).click();
      await expect(ask(full)).toBeVisible();
      await ask(full)
        .getByRole('button', { name: 'Sync', exact: true })
        .click();
      await expect(ask(full)).toHaveCount(0);

      await expect.poll(() => titles(full)).toEqual(['Lisbon trip', 'Work']);
      expect(await tabsOf(full, 'A1')).toEqual([['a0', 'a1'], ['b0']]);

      await setup(full)
        .getByRole('button', { name: 'Done', exact: true })
        .click();
      await expect(guide(full)).toBeVisible();
      await guide(full)
        .getByRole('button', { name: 'Skip', exact: true })
        .click();
      await expect(full.locator('dialog[open]')).toHaveCount(0);
      await expect(
        full
          .locator('[data-pane="sessions"]')
          .getByRole('button', { name: 'Work', exact: true })
      ).toBeVisible();

      await expectAHas(a.page, ['Lisbon trip', 'Work']);
      const onA = await saved(a.page);
      expect(
        onA.sessions.filter((s) => s.id.startsWith(SAMPLE_ID_PREFIX))
      ).toEqual([]);
    } finally {
      await b.profile.close();
    }
  });
});
