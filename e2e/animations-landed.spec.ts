import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { documentLanded, elementLanded } from './fixtures/landed';

// KAN-763. A hover or focus change cancels a running transition and starts its
// replacement. `finished` on the cancelled one rejects with AbortError, and the
// replacement is still moving: the wait must ride out both.

const PAGE = `
  <div id="outer"><div id="box"><span id="inner"></span></div></div>
  <div id="beside"></div>`;

// Starts a 2s fade on `id`, kept on window so a later call can cancel it.
const start = (page: Page, id: string, name: string, ms = 2000) =>
  page.evaluate(
    ([id, name, ms]) => {
      const a = document
        .getElementById(id)!
        .animate({ opacity: [0, 1] }, { duration: Number(ms) });
      Object.assign(window, { [name]: a });
    },
    [id, name, String(ms)]
  );

// Once the wait first reads getAnimations, cancels `name` and starts `next` on
// the same element, as a retarget does. Hooked so the swap lands mid-wait.
const retargetOnLook = (page: Page, id: string, name: string, next = '') =>
  page.evaluate(
    ([id, name, next]) => {
      const w = window as unknown as Record<string, unknown>;
      const swap = () => {
        (w[name] as Animation).cancel();
        if (next === '') return;
        w[next] = document
          .getElementById(id)!
          .animate({ opacity: [1, 0] }, { duration: 1500 });
      };
      const look = () => {
        if (w.looked === true) return;
        w.looked = true;
        setTimeout(swap, 50);
      };
      const onDocument = Document.prototype.getAnimations;
      Document.prototype.getAnimations = function (this: Document) {
        look();
        return onDocument.call(this);
      };
      const onElement = Element.prototype.getAnimations;
      Element.prototype.getAnimations = function (
        this: Element,
        options?: GetAnimationsOptions
      ) {
        look();
        return onElement.call(this, options);
      };
    },
    [id, name, next]
  );

const looked = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, unknown>).looked);

const playState = (page: Page, name: string) =>
  page.evaluate(
    (name) => (window as unknown as Record<string, Animation>)[name].playState,
    name
  );

test.beforeEach(async ({ page }) => {
  await page.setContent(PAGE);
});

test('the page wait outlasts a cancelled animation and its replacement', async ({
  page,
}) => {
  await start(page, 'box', 'first');
  await retargetOnLook(page, 'box', 'first', 'second');
  await documentLanded(page);
  expect(await looked(page)).toBe(true);
  expect(await playState(page, 'first')).toBe('idle');
  expect(await playState(page, 'second')).toBe('finished');
});

test('the subtree wait outlasts a cancelled animation and its replacement', async ({
  page,
}) => {
  await start(page, 'inner', 'first');
  await retargetOnLook(page, 'inner', 'first', 'second');
  await elementLanded(page.locator('#box'), 'subtree');
  expect(await looked(page)).toBe(true);
  expect(await playState(page, 'second')).toBe('finished');
});

test('the ancestors wait outlasts a cancelled animation and its replacement', async ({
  page,
}) => {
  await start(page, 'outer', 'first');
  await retargetOnLook(page, 'outer', 'first', 'second');
  await elementLanded(page.locator('#box'), 'ancestors');
  expect(await looked(page)).toBe(true);
  expect(await playState(page, 'second')).toBe('finished');
});

test('a cancel with nothing after it ends the wait', async ({ page }) => {
  await start(page, 'box', 'first', 60_000);
  await retargetOnLook(page, 'box', 'first');
  await documentLanded(page);
  expect(await looked(page)).toBe(true);
  expect(await playState(page, 'first')).toBe('idle');
});

test('each element wait leaves animations out of its reach alone', async ({
  page,
}) => {
  // CONTROL: the 60s fades outside each reach are running when it ends.
  await start(page, 'beside', 'beside', 60_000);
  await start(page, 'outer', 'outer', 60_000);
  await start(page, 'inner', 'inner', 300);
  await elementLanded(page.locator('#box'), 'subtree');
  expect(await playState(page, 'inner')).toBe('finished');
  expect(await playState(page, 'outer')).toBe('running');
  await page.evaluate(() =>
    (window as unknown as Record<string, Animation>).outer.cancel()
  );
  await start(page, 'outer', 'outer', 300);
  await elementLanded(page.locator('#box'), 'ancestors');
  expect(await playState(page, 'outer')).toBe('finished');
  expect(await playState(page, 'beside')).toBe('running');
});
