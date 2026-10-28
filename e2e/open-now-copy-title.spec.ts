import { createServer } from 'node:http';
import type { Page, Worker } from '@playwright/test';

import { expect } from './fixtures/extension';
import { grantedTest as test } from './fixtures/grantedExtension';
import { S1, S2, openTabView } from './fixtures/betweenSessions';
import { carryTo, dataUrl, topOf } from './fixtures/liveWindows';
import { groupHandle, pickUp, tabHandle } from './fixtures/sessionDrag';

// KAN-851. A saved tab or group let go in Currently open opens a copy, which
// Chrome has no title for until its page loads. Its row reads the saved title
// from the first frame it is drawn until Chrome has the page's own: never
// blank, never the address. Measured per frame.

// Pages that answer late, so the frames before Chrome has a title are seen.
const LATE_MS = 800;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const body =
    request.url === '/untitled'
      ? '<p>No title here</p>'
      : `<title>Page ${request.url?.slice(1)}</title>`;
  setTimeout(() => response.end(body), LATE_MS);
});
test.beforeAll(
  () =>
    new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
);
// A browser kept open across tests (KAN-766) holds its sockets; close() waits on them.
test.afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((closed) => server.close(() => closed()));
});
const at = (path: string) => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the page server is not listening on a port');
  }
  return `http://127.0.0.1:${address.port}${path}`;
};

// S1 with a1, al0 and al1 at the late server, under titles of their own.
function seeded() {
  const s1 = S1();
  const tabs = s1.windows[0]?.tabs ?? [];
  const late = (id: string, path: string, title: string) => {
    const tab = tabs.find((t) => t.tabId === id);
    if (tab === undefined) throw new Error(`S1 holds no ${id}`);
    tab.url = at(path);
    tab.title = title;
  };
  late('a1', '/kiyomizu', 'Kyoto temple guide');
  late('al0', '/fushimi', 'Fushimi Inari notes');
  late('al1', '/arashiyama', 'Arashiyama walk');
  return s1;
}

// A live window A B C D, the carry let go on C's top half.
async function carryIntoOpenWindow(
  page: Page,
  worker: Worker,
  handle: ReturnType<typeof tabHandle>
) {
  const made = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    return (win?.tabs ?? []).map((t) => t.id ?? -1);
  }, ['A', 'B', 'C', 'D'].map(dataUrl));
  const row = (id: number | undefined) =>
    page.locator(`[data-pane="open-now"] [data-open-tab-id="${id}"]`);
  await expect(row(made[3])).toBeVisible();
  await pickUp(page, handle);
  await carryTo(page, await topOf(row(made[2])));
  await page.waitForTimeout(350);
  return made;
}

type Titles = Record<string, string>;

declare global {
  interface Window {
    __copyTitles?: Titles[] | null;
  }
}

// From the release on, every frame's title of each Open now row not drawn
// before it, keyed by tab id, for `ms`. The phantom is drawn before it too.
async function recordCopyTitles(page: Page, ms: number) {
  await page.evaluate(
    ({ ms }) => {
      window.__copyTitles = null;
      const known = [
        ...document.querySelectorAll(
          '[data-pane="open-now"] [data-open-tab-id]'
        ),
      ].map((el) => el.getAttribute('data-open-tab-id'));
      const read = (): Record<string, string> =>
        Object.fromEntries(
          [
            ...document.querySelectorAll(
              '[data-pane="open-now"] [data-open-tab-id]'
            ),
          ]
            .map(
              (el) => [el.getAttribute('data-open-tab-id') ?? '', el] as const
            )
            .filter(([id]) => !known.includes(id))
            .map(([id, el]) => [
              id,
              el.querySelector(':scope > button')?.getAttribute('aria-label') ??
                '',
            ])
        );
      window.addEventListener(
        'pointerup',
        () => {
          const out: Record<string, string>[] = [];
          const start = performance.now();
          const tick = () => {
            out.push(read());
            if (performance.now() - start < ms) requestAnimationFrame(tick);
            else window.__copyTitles = out;
          };
          requestAnimationFrame(tick);
        },
        { capture: true, once: true }
      );
    },
    { ms }
  );
}

async function copyTitles(page: Page): Promise<Titles[]> {
  await expect
    .poll(() => page.evaluate(() => window.__copyTitles != null), {
      message: 'no titles were recorded',
      timeout: LATE_MS + 5000,
    })
    .toBe(true);
  return page.evaluate(() => window.__copyTitles ?? []);
}

// Chrome's own title for each copy once loaded, keyed by tab id.
const loadedTitles = (worker: Worker, ids: string[]) =>
  worker.evaluate(
    async (ids) =>
      Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => [
            id,
            (await chrome.tabs.get(Number(id))).title ?? '',
          ])
        )
      ),
    ids
  );

// Each copy's distinct titles in the order its row showed them.
function shown(frames: Titles[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const frame of frames)
    for (const [id, title] of Object.entries(frame)) {
      const seen = (out[id] ??= []);
      if (seen[seen.length - 1] !== title) seen.push(title);
    }
  return out;
}

const SWITCH = 'Switch to tab: ';

test.describe('a copy opened in Currently open (KAN-851)', () => {
  test('a saved tab: its saved title, then the page’s', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId, false, [
      seeded(),
      S2(),
    ]);
    await carryIntoOpenWindow(page, worker, tabHandle(page, 'a1'));
    await recordCopyTitles(page, LATE_MS + 1500);
    await page.mouse.up();

    const byTab = shown(await copyTitles(page));
    const ids = Object.keys(byTab);
    expect(ids).toHaveLength(1);
    // PREMISE: Chrome loaded the page and took its title.
    expect(await loadedTitles(worker, ids)).toEqual({
      [ids[0]]: 'Page kiyomizu',
    });
    expect(byTab[ids[0]]).toEqual([
      SWITCH + 'Kyoto temple guide',
      SWITCH + 'Page kiyomizu',
    ]);
  });

  test('a saved group: each tab its saved title, then its page’s', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId, false, [
      seeded(),
      S2(),
    ]);
    await carryIntoOpenWindow(page, worker, groupHandle(page, 'alpha'));
    await recordCopyTitles(page, LATE_MS + 1500);
    await page.mouse.up();

    const byTab = shown(await copyTitles(page));
    const ids = Object.keys(byTab);
    expect(ids).toHaveLength(2);
    const loaded = await loadedTitles(worker, ids);
    const saved = ['Fushimi Inari notes', 'Arashiyama walk'];
    for (const [i, id] of ids.entries()) {
      // A group's later tabs open as placeholders (KAN-250): its own title, or the page's.
      expect(byTab[id]).toEqual(
        [...new Set([saved[i], loaded[id]])].map((t) => SWITCH + t)
      );
    }
  });

  test('a page with no title: what Chrome shows once it has loaded', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const s1 = seeded();
    const a1 = s1.windows[0]?.tabs.find((t) => t.tabId === 'a1');
    if (a1 === undefined) throw new Error('S1 holds no a1');
    a1.url = at('/untitled');
    const page = await openTabView(context, extensionId, false, [s1, S2()]);
    await carryIntoOpenWindow(page, worker, tabHandle(page, 'a1'));
    await recordCopyTitles(page, LATE_MS + 1500);
    await page.mouse.up();

    const byTab = shown(await copyTitles(page));
    const ids = Object.keys(byTab);
    expect(ids).toHaveLength(1);
    const chromeTitle = (await loadedTitles(worker, ids))[ids[0]];
    // PREMISE: Chrome's title for it is its own, not the saved one.
    expect(chromeTitle).not.toBe('Kyoto temple guide');
    expect(byTab[ids[0]]).toEqual([
      SWITCH + 'Kyoto temple guide',
      SWITCH + chromeTitle,
    ]);
  });
});
