import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';

// What Chromium's own accessibility tree gives a screen reader.
async function chromeAx(page: Page, name: string | RegExp) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodes } = await cdp.send('Accessibility.queryAXTree', {
    nodeId: root.nodeId,
    role: 'button',
  });
  await cdp.detach();
  return nodes
    .map((n) => ({
      name: String(n.name?.value ?? ''),
      description: String(n.description?.value ?? ''),
      expanded: n.properties?.find((p) => p.name === 'expanded')?.value.value,
    }))
    .filter((n) =>
      typeof name === 'string' ? n.name === name : name.test(n.name)
    );
}

async function openHome(
  context: Parameters<typeof seedSessions>[0],
  id: string
) {
  await seedSessions(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${id}/index.html`);
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

test('header and search icons are named once, not described by their own name (KAN-345)', async ({
  context,
  extensionId,
}) => {
  const page = await openHome(context, extensionId);
  const expectNamedOnce = async (name: string) => {
    // PREMISE: the tooltip is the name, which is what made Chrome repeat it.
    await expect(
      page.getByRole('button', { name, exact: true })
    ).toHaveAttribute('title', name);
    const [ax] = await chromeAx(page, name);
    expect({ name: ax.name, description: ax.description }).toEqual({
      name,
      description: '',
    });
  };
  for (const name of ['Undo', 'Settings', 'Sort sessions']) {
    await expectNamedOnce(name);
  }
  // CONTROL: a tooltip that adds something is still read as the description.
  const [open] = await chromeAx(page, 'Open');
  expect(open.description).toBe('Open session, keeping current windows');
  // The saved search is a row, not a header button (KAN-385): its icon is Clear search.
  await page
    .getByRole('textbox', { name: 'Search saved tabs', exact: true })
    .fill('a');
  await expectNamedOnce('Clear search');
});

test("a saved window's chevron names its window and says whether it is open (KAN-303)", async ({
  context,
  extensionId,
}) => {
  const page = await openHome(context, extensionId);
  // The seed selects no session.
  // At its left: the row's actions sit over its middle.
  await page
    .getByRole('button', { name: 'Research', exact: true })
    .click({ position: { x: 10, y: 10 } });
  await page.getByRole('button', { name: /^Collapse(: |$)/ }).waitFor();
  expect(await chromeAx(page, /^(Collapse|Expand)(: |$)/)).toEqual([
    { name: 'Collapse: Morning reading', description: '', expanded: true },
  ]);
  await page.getByRole('button', { name: 'Collapse: Morning reading' }).click();
  expect(await chromeAx(page, /^(Collapse|Expand)(: |$)/)).toEqual([
    { name: 'Expand: Morning reading', description: '', expanded: false },
  ]);
});
