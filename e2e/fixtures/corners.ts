import type { BrowserContext, Locator, Worker } from '@playwright/test';

import {
  RUN_FINISHED,
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './seed';

// KAN-721. The approved C2 mock run's seed (docs/superpowers/mocks/kan-721-r3).

const DAY = 86_400_000;

const tab = (id: string, title: string, chromeGroupId?: string) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

const win = (
  id: string,
  tabs: ReturnType<typeof tab>[],
  extra: Record<string, unknown> = {}
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: id,
  tabs,
  ...extra,
});

/** The mock run's seed: three sessions, Porto with two Chrome groups. */
export async function seedCorners(
  context: BrowserContext,
  theme = 'Chalk',
  portoCreatedAt = new Date(2026, 9, 29, 10, 10).getTime()
): Promise<void> {
  const porto = [
    tab('p1', 'Porto itinerary'),
    tab('p2', 'Livraria Lello', 'S'),
    tab('p3', 'Ribeira walk', 'S'),
    tab('p4', 'Francesinha', 'E'),
  ];
  const reading = [tab('r1', 'Article: tab hoarding'), tab('r2', 'Long read')];
  const work = [
    tab('k1', 'Roadmap'),
    tab('k2', 'Standup notes'),
    tab('k3', 'Calendar'),
  ];
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 'porto',
        title: 'Porto weekend',
        createdAt: portoCreatedAt,
        windowCount: 1,
        tabCount: 4,
        windows: [
          win('w1', porto, {
            chromeTabGroups: [
              { groupId: 'S', title: 'Sights', color: 'blue' },
              { groupId: 'E', title: 'Eat', color: 'red' },
            ],
          }),
        ],
      }),
      buildSession({
        tabGroupId: 'reading',
        title: 'Reading list',
        createdAt: new Date(2026, 9, 26, 10, 10).getTime(),
        windowCount: 1,
        tabCount: 2,
        windows: [win('w2', reading)],
      }),
      buildSession({
        tabGroupId: 'work',
        title: 'Work',
        createdAt: new Date(2026, 9, 22, 10, 10).getTime(),
        windowCount: 1,
        tabCount: 3,
        windows: [win('w3', work)],
      }),
    ])
  );
  await seedSettings(context, {
    theme,
    firstRun: RUN_FINISHED,
    setupState: 'done',
    isFullViewEndingSeen: true,
    isPopupEndingSeen: true,
    extensionInstalledTime: Date.now() - 30 * DAY,
  });
}

/** Two live windows, each with a Chrome group, for Open now. */
export async function liveWindows(worker: Worker): Promise<void> {
  for (const { titles, grouped, title, color } of [
    {
      titles: ['Lisbon guide', 'Tram 28', 'Pasteis', 'Market'],
      grouped: [2, 3],
      title: 'Food',
      color: 'orange' as const,
    },
    {
      titles: ['Work email', 'Calendar', 'Standup', 'Roadmap'],
      grouped: [1, 2],
      title: 'Work',
      color: 'purple' as const,
    },
  ]) {
    await worker.evaluate(
      async ({ urls, grouped, title, color }) => {
        const w = await chrome.windows.create({ focused: false, url: urls });
        if (w?.id === undefined) return;
        const ids = grouped.map((i) => w.tabs?.[i]?.id ?? -1);
        const g = await chrome.tabs.group({
          tabIds: ids as [number, ...number[]],
          createProperties: { windowId: w.id },
        });
        await chrome.tabGroups.update(g, { title, color });
      },
      {
        urls: titles.map(
          (t) => `data:text/html,<title>${encodeURIComponent(t)}</title>`
        ),
        grouped,
        title,
        color,
      }
    );
  }
}

/** Computed border-radius, as Chrome serialises it. */
export const radius = (loc: Locator): Promise<string> =>
  loc.evaluate((e) => getComputedStyle(e).borderRadius);
