import type { BrowserContext } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-195. Copy all links puts two versions on the clipboard, and the app it
// is pasted into picks one. The unit tests hold the strings; only a browser
// can say what a PASTE of them becomes. So this copies from the export page
// and pastes, with the keyboard, into the two kinds of target people use:
//
// - an editable rich area, which is what Gmail, Google Docs and Notion are
//   inside Chrome: it must receive real links, bold windows, a nested group;
// - a textarea, which takes plain text only: it must receive the plain layout.

const SESSION = buildSession({
  tabGroupId: 'session-copy',
  title: 'Weekend in Kyoto',
  isSelected: true,
  windowCount: 1,
  tabCount: 4,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Trip planning',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: '(3) Nozomi timetable',
          url: 'https://jr.example/nozomi',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Haruka',
          url: 'https://haruka.example/',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-3',
          favicon: '',
          title: 'Extensions',
          url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Extensions&url=chrome%3A%2F%2Fextensions%2F&time=1',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't-4',
          favicon: '',
          title: 'Trap',
          url: 'javascript:alert(1)',
        },
      ],
      chromeTabGroups: [{ groupId: 'g-1', title: 'Flights', color: 'blue' }],
    },
  ],
});

const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

async function copyFromExportPage(
  context: BrowserContext,
  extensionId: string
) {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-copy',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-copy`
  );
  await page.getByRole('button', { name: 'Copy all links' }).click();
  await expect(page.getByText('Links copied')).toBeVisible();

  // The paste targets live on an ordinary page, as another site's would.
  const target = await context.newPage();
  await target.goto(
    'data:text/html,<div id="rich" contenteditable="true"></div><textarea id="plain" rows="20" cols="80"></textarea>'
  );
  return target;
}

test('pasted into a rich editor, the copy arrives as a document of real links', async ({
  context,
  extensionId,
}) => {
  const target = await copyFromExportPage(context, extensionId);

  await target.locator('#rich').click();
  await target.keyboard.press(PASTE);

  const pasted = await target.evaluate(() => {
    const rich = document.getElementById('rich')!;
    return {
      links: [...rich.querySelectorAll('a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]),
      bold: [...rich.querySelectorAll('b')].map((b) => b.textContent),
      nestedLists: rich.querySelectorAll('ul ul').length,
      text: rich.textContent ?? '',
    };
  });

  expect(pasted.links).toEqual([
    ['Nozomi timetable', 'https://jr.example/nozomi'],
    ['Haruka', 'https://haruka.example/'],
  ]);
  expect(pasted.bold).toEqual(['Window 1 · Trip planning', 'Flights']);
  expect(pasted.nestedLists).toBe(1);
  // The suspended tab arrives unwrapped, as text; the javascript: tab arrives
  // as text and never as a link.
  expect(pasted.text).toContain('Extensions (chrome://extensions/)');
  expect(pasted.text).toContain('Trap (javascript:alert(1))');
  expect(pasted.text).not.toContain('chrome-extension://');
});

test('pasted into a plain text box, the copy arrives in the plain layout', async ({
  context,
  extensionId,
}) => {
  const target = await copyFromExportPage(context, extensionId);

  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);

  expect(await target.locator('#plain').inputValue()).toBe(
    [
      'Weekend in Kyoto',
      '1 Window - 4 Tabs',
      '',
      'WINDOW 1 · Trip planning (4 Tabs)',
      '- Nozomi timetable',
      '  https://jr.example/nozomi',
      '',
      '  Flights (2 Tabs)',
      '    - Haruka',
      '      https://haruka.example/',
      '    - Extensions',
      '      chrome://extensions/',
      '',
      '- Trap',
      '  javascript:alert(1)',
    ].join('\n')
  );
});
