import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';
import { TAB_GROUP_COLOR_HEX } from '../src/utils/functions/tabGroups';

// KAN-568 (picks 1-A, 2-U1). Open now renames and recolours Chrome's own group, as the saved band does its copy.
const VIEW_TAB = 'index.html?view=tab';
const TAB_VIEWPORT = { width: 1280, height: 800 };

async function openKyoto(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
    const groupId = await chrome.tabs.group({
      tabIds: [first, second],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(groupId, { title: 'Kyoto', color: 'blue' });
    return { windowId: win?.id ?? -1, groupId };
  }, ['Temples', 'Gardens', 'Loose'].map(standIn));
}

const liveGroup = (worker: Worker, groupId: number) =>
  worker.evaluate(async (groupId) => {
    const { title, color } = await chrome.tabGroups.get(groupId);
    return { title, color };
  }, groupId);

const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`[data-open-window-id="${windowId}"]`);

// Every distinct text of the band's title row and colour of its strip, one entry per change, frame by frame.
async function startRecording(page: Page, windowId: number) {
  await page.evaluate((windowId) => {
    const seen: string[] = [];
    const block = `[data-open-window-id="${windowId}"]`;
    const sample = () => {
      const row = document.querySelector(`${block} [data-group-drag-handle]`);
      const field = row?.querySelector('input');
      const strip = document.querySelector(`${block} [data-group-color-strip]`);
      // The name button's text, not the row's: the row ends in the group's strip (KAN-696).
      const name = row?.querySelector('[aria-label^="Rename group"]');
      const picture = `${field ? 'field:' + field.value : (name?.textContent ?? '')}|${
        strip ? getComputedStyle(strip).backgroundColor : ''
      }`;
      if (seen[seen.length - 1] !== picture) seen.push(picture);
      (window as unknown as { kan568: string[] }).kan568 = seen;
      requestAnimationFrame(sample);
    };
    sample();
  }, windowId);
}
const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { kan568: string[] }).kan568);

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('the name renames the Chrome group, Enter commits, and the band shows it', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  const { windowId, groupId } = await openKyoto(serviceWorker);
  const block = windowBlock(page, windowId);
  await block.getByRole('button', { name: 'Rename group: Kyoto' }).click();
  const field = block.getByRole('textbox', { name: 'Rename group: Kyoto' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Kyoto');
  await field.fill('Temples and gardens');
  await startRecording(page, windowId);
  await field.press('Enter');

  await expect
    .poll(() => liveGroup(serviceWorker, groupId))
    .toEqual({ title: 'Temples and gardens', color: 'blue' });
  await expect(
    block.getByRole('button', { name: 'Rename group: Temples and gardens' })
  ).toBeFocused();
  await page.waitForTimeout(300);
  // Measured before the stand-in: the old name showed between the field and the new name.
  const frames = await recorded(page);
  console.log('[KAN-568 rename frames]', JSON.stringify(frames));
  expect(frames.map((frame) => frame.split('|')[0])).toEqual([
    'field:Temples and gardens',
    'Temples and gardens',
  ]);
});

test('the strip opens the picker, and a swatch recolours the Chrome group', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  const { windowId, groupId } = await openKyoto(serviceWorker);
  const block = windowBlock(page, windowId);
  await block
    .getByRole('button', { name: 'Change group color: Kyoto' })
    .click();
  await startRecording(page, windowId);
  await page.getByRole('menuitemradio', { name: 'Green' }).click();

  await expect
    .poll(() => liveGroup(serviceWorker, groupId))
    .toEqual({ title: 'Kyoto', color: 'green' });
  await expect(block.locator('[data-group-color-strip]')).toHaveCSS(
    'background-color',
    rgb(TAB_GROUP_COLOR_HEX.green)
  );
  await page.waitForTimeout(300);
  const frames = await recorded(page);
  console.log('[KAN-568 recolour frames]', JSON.stringify(frames));
  expect(frames.map((frame) => frame.split('|')[1])).toEqual([
    rgb(TAB_GROUP_COLOR_HEX.blue),
    rgb(TAB_GROUP_COLOR_HEX.green),
  ]);
});

// Worst paths: Esc writes nothing, and a drag by the name row never opens the field.
test('Esc cancels without writing, and a drag by the name row opens no field', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  const { windowId, groupId } = await openKyoto(serviceWorker);
  const block = windowBlock(page, windowId);
  await block.getByRole('button', { name: 'Rename group: Kyoto' }).click();
  await block.getByRole('textbox').fill('Typo');
  await block.getByRole('textbox').press('Escape');
  await expect(block.getByRole('textbox')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await liveGroup(serviceWorker, groupId)).toEqual({
    title: 'Kyoto',
    color: 'blue',
  });

  const name = block.getByRole('button', { name: 'Rename group: Kyoto' });
  const box = await name.boundingBox();
  if (box === null) throw new Error('the name has no box');
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('[data-drag-held]') !== null)
    )
    .toBe(true);
  await page.mouse.move(x, y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(block.getByRole('textbox')).toHaveCount(0);
  // CONTROL: the same name, clicked, does open it.
  await name.click();
  await expect(block.getByRole('textbox')).toHaveCount(1);
});
