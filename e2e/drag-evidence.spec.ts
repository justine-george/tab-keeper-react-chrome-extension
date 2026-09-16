// The evidence gatherer the three drag flakes are instrumented with
// (KAN-191 / KAN-196 / KAN-200), tested against a real page.
//
// It exists to explain a failure, so the one thing it must never do is replace
// one. Every step of the gathering runs AFTER an assertion has already failed,
// against a page that may be closing -- so the interesting cases here are the
// broken ones, not the happy one.

import { test, expect } from './fixtures/extension';
import {
  startGeometryEvidence,
  withGeometryEvidence,
} from './fixtures/dragEvidence';

const POPUP = (extensionId: string) =>
  `chrome-extension://${extensionId}/index.html`;

test.describe('the drag evidence gatherer', () => {
  test("returns the assertion's value and leaves nothing running", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(POPUP(extensionId));
    await startGeometryEvidence(page, { body: 'body' });

    const value = await withGeometryEvidence(page, 'passing', async () => 42);

    expect(value).toBe(42);
    // The recorder samples every frame inside the page it measures, so a
    // passing assertion must leave it stopped rather than costing the rest of
    // the test frames.
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __dragEvidenceStop?: boolean })
            .__dragEvidenceStop
      )
    ).toBe(true);
  });

  test('rethrows the ORIGINAL failure, with the frames it recorded', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(POPUP(extensionId));
    await startGeometryEvidence(page, { body: 'body' });

    const original = new Error('expected 426, received 429');

    // Not merely "an error": the SAME error object. A gatherer that wrapped or
    // re-created it would still fail the test and still tell nobody which
    // number was wrong.
    await expect(
      withGeometryEvidence(
        page,
        'failing',
        () => Promise.reject(original),
        async () => ({ someNumber: 1 })
      )
    ).rejects.toBe(original);
  });

  test('WORST PATH: survives an extra() that throws and a closed page', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(POPUP(extensionId));
    await startGeometryEvidence(page, { body: 'body' });

    const original = new Error('the failure that must survive');
    await page.close();

    // Every input is now broken at once: the page is gone, so reading the
    // frames and stopping the recorder both fail, and extra() throws on top.
    // This is the shape a failure late in a drag test actually has.
    await expect(
      withGeometryEvidence(
        page,
        'worst-path',
        () => Promise.reject(original),
        () => Promise.reject(new Error('extra blew up'))
      )
    ).rejects.toBe(original);
  });

  test('gathers nothing rather than throwing when no recorder was started', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(POPUP(extensionId));

    const original = new Error('no recorder here');
    // startGeometryEvidence was never called: a test can be instrumented at the
    // assertion without being instrumented at the top, and that must degrade to
    // an empty frame list rather than to a different error.
    await expect(
      withGeometryEvidence(page, 'no-recorder', () => Promise.reject(original))
    ).rejects.toBe(original);
  });
});
