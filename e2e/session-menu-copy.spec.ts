import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-209. The component tests use a fake clipboard; only a real paste proves
// the popup may write (no `clipboardWrite` permission, and a refused write
// falls back silently). export-copy-links.spec.ts covers the export page.

const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

const SESSION = buildSession({
  tabGroupId: 'session-menu-copy',
  title: 'Weekend in Kyoto',
  isSelected: true,
  windowCount: 1,
  tabCount: 2,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Trip planning',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: 'Fushimi Inari',
          url: 'https://inari.example/en/',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Kyoto bus map',
          url: 'https://bus.example/kyoto',
        },
      ],
    },
  ],
});

test('copying from the session menu reaches the real clipboard, rich and plain', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-menu-copy',
  });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 790, height: 550 });
  await popup.goto(`chrome-extension://${extensionId}/index.html`);

  const trigger = sessionHeaderMenu(popup);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await popup.getByRole('menuitem', { name: 'Copy all links' }).click();

  // Barrier: the toast appears after the write resolves.
  await expect(popup.getByText('Links copied')).toBeVisible();

  const target = await context.newPage();
  await target.goto(
    'data:text/html,<div id="rich" contenteditable="true"></div><textarea id="plain" rows="20" cols="80"></textarea>'
  );

  await target.locator('#rich').click();
  await target.keyboard.press(PASTE);
  const rich = await target.evaluate(() => {
    const el = document.getElementById('rich')!;
    return {
      links: [...el.querySelectorAll('a')].map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent,
      })),
      text: el.textContent ?? '',
    };
  });

  // Real anchors: what a plain-text-only fallback would lose.
  expect(rich.links).toEqual([
    { href: 'https://inari.example/en/', text: 'Fushimi Inari' },
    { href: 'https://bus.example/kyoto', text: 'Kyoto bus map' },
  ]);
  expect(rich.text).toContain('Weekend in Kyoto');

  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);
  const plain = await target.locator('#plain').inputValue();

  expect(plain).toContain('- Fushimi Inari\n  https://inari.example/en/');
  expect(plain).toContain('Weekend in Kyoto');
});
