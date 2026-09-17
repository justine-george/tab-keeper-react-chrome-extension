import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-209. Copy all links, straight from the session's menu in the popup.
//
// The component tests drive a FAKE clipboard -- jsdom has no ClipboardItem, so
// they stub one and read back what they were handed. That proves the strings
// are built correctly and proves nothing at all about whether the popup may
// write to the clipboard: the manifest asks for `tabs, storage, favicon` and
// no `clipboardWrite`, and a refused write is caught and falls back silently by
// design.
//
// So this copies from the real popup and PASTES, with the keyboard, into the
// two kinds of target people use -- the same shape as export-copy-links.spec.ts,
// which covers the export page's button. What is new here is the source: the
// popup, which is a different document with different permissions from the
// export tab.

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

  // Scoped to the right pane: since KAN-208 the save row's menu carries
  // the same name, so a locator on the name alone matches two controls
  // and strict mode refuses it.
  const trigger = sessionHeaderMenu(popup);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await popup.getByRole('menuitem', { name: 'Copy all links' }).click();

  // The toast is the only thing the popup says about a clipboard write, so it
  // is also the barrier: it appears after the write resolves.
  await expect(popup.getByText('Links copied')).toBeVisible();

  // The paste targets live on an ordinary page, as another site's would.
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

  // Real anchors, not text that looks like a URL. This is the whole point of
  // the rich half, and the half a plain-text-only fallback would lose.
  expect(rich.links).toEqual([
    { href: 'https://inari.example/en/', text: 'Fushimi Inari' },
    { href: 'https://bus.example/kyoto', text: 'Kyoto bus map' },
  ]);
  expect(rich.text).toContain('Weekend in Kyoto');

  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);
  const plain = await target.locator('#plain').inputValue();

  // The plain layout carries the address on its own line under the title, so a
  // target that takes no HTML still gets something usable.
  expect(plain).toContain('- Fushimi Inari\n  https://inari.example/en/');
  expect(plain).toContain('Weekend in Kyoto');
});
