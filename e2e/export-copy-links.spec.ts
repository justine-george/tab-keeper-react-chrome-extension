import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserContext } from '@playwright/test';

import type { tabContainerData } from '../src/redux/slices/tabContainerDataStateSlice';
import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-195. The clipboard carries HTML and plain text and the target picks one;
// only a real paste shows which. A contenteditable stands in for Gmail, Docs
// and Notion; a textarea takes plain text only.

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
  extensionId: string,
  session: tabContainerData = SESSION
) {
  await seedSessions(context, {
    ...buildContainer([session]),
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

// KAN-202. The clean-ups must reach the saved file, not just the clipboard.
test('the saved file carries neither a notification count nor a suspended wrapper', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-copy',
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-copy`
  );
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as HTML' }).click(),
  ]);
  const path = join(
    mkdtempSync(join(tmpdir(), 'export-tidy-')),
    download.suggestedFilename()
  );
  await download.saveAs(path);
  const file = readFileSync(path, 'utf8');

  expect(file).toContain('>Nozomi timetable</a>');
  expect(file).not.toContain('(3) Nozomi');
  expect(file).toContain('chrome://extensions/');
  expect(file).not.toContain('chrome-extension://');
  // CONTROL: the rest of the file is untouched.
  expect(file).toContain('https://haruka.example/');
});

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
  // Neither the suspended nor the javascript: tab may arrive as a link.
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
      '1 Window · 4 Tabs',
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

// KAN-394. A window with no stored name is "Window 1", never "Window 1 · ".
const UNNAMED = buildSession({
  ...SESSION,
  windows: [{ ...SESSION.windows[0], title: '' }],
});

test('an unnamed window reads "Window 1" in the saved file and in both copies', async ({
  context,
  extensionId,
}) => {
  const target = await copyFromExportPage(context, extensionId, UNNAMED);

  await target.locator('#rich').click();
  await target.keyboard.press(PASTE);
  const bold = await target.evaluate(() =>
    [...document.querySelectorAll('#rich b')].map((b) => b.textContent)
  );
  expect(bold).toEqual(['Window 1', 'Flights']);

  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);
  const plain = await target.locator('#plain').inputValue();
  expect(plain.split('\n')).toContain('WINDOW 1 (4 Tabs)');
  expect(plain).not.toContain('·  ');
  expect(plain).not.toMatch(/WINDOW 1 ·/);

  const page = context.pages().find((p) => p.url().includes('export.html'));
  if (!page) throw new Error('the export page is gone');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as HTML' }).click(),
  ]);
  const path = join(
    mkdtempSync(join(tmpdir(), 'export-unnamed-')),
    download.suggestedFilename()
  );
  await download.saveAs(path);
  const file = readFileSync(path, 'utf8');

  expect(file).toMatch(/<h2>Window 1 <span>\(4 Tabs\)<\/span><\/h2>/);
  expect(file).not.toContain('Window 1 ·');
});
