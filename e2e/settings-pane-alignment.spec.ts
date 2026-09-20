import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession, seedSessions } from './fixtures/seed';

// KAN-239. The settings page's two panes each hold a framed box below their
// header -- the category list on the left, the details on the right -- and
// their top edges disagreed by 4px. The home page's two boxes (the session
// list and the selected session's details) share both edges, which is what
// made the settings page look wrong beside it.
//
// The two tops were computed from different constants: the left box sat
// 6px under a 56px header row, the right box 8px under a 50px card that
// itself starts 8px down. Nothing related them. This pins that they agree,
// and the home page is the control: the same assertion, already true there.

/** The framed box that contains `inner`: the nearest ancestor with a border. */
async function framedBoxAround(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node && getComputedStyle(node).borderTopWidth === '0px') {
        node = node.parentElement;
      }
      if (!node) throw new Error(`no framed ancestor for ${el.outerHTML}`);
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
}

test.describe('the two panes share a rhythm', () => {
  test('on the settings page, the category list and the details box share their top and bottom edges', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    // The Display row's own frame is the category list; the Themes label's
    // is the details box.
    const left = await framedBoxAround(page, 'button[aria-label="Display"]');
    const right = await framedBoxAround(page, 'text=Themes');

    expect(left.top).toBe(right.top);
    expect(left.bottom).toBe(right.bottom);
  });

  test('CONTROL: on the home page, the session list and the details box already do', async ({
    context,
    extensionId,
  }) => {
    const session = buildSession({ isSelected: true });
    await seedSessions(context, {
      lastModified: 1,
      selectedTabGroupId: session.tabGroupId,
      tabGroups: [session],
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

    const left = await framedBoxAround(page, `[aria-label="${session.title}"]`);
    const right = await framedBoxAround(
      page,
      `text=${session.windows[0].tabs[0].title}`
    );

    expect(left.top).toBe(right.top);
    expect(left.bottom).toBe(right.bottom);
  });
});
