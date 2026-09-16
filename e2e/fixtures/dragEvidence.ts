import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

// KAN-191 / KAN-196 / KAN-200. Three drag assertions that have each failed
// exactly once on CI and never locally.
//
// They were investigated before this was written, and the investigation is the
// reason it exists. Five mechanisms were proposed and every one was disproved
// by measurement on a real build (2026-09-15):
//
//   a late reflow after open() moving the window        w2 held y=332 for 16 runs
//   a read taken right after the pick-up being stale    control on a row with
//                                                       96px of travel: the
//                                                       one-shot read already
//                                                       had the settled value,
//                                                       10/10, incl. 20x CPU
//                                                       throttle
//   scrollTop clamped by the compression                scrollTop 535, max 589
//                                                       -- no clamp
//   pointerup beating the last pointermove's render     main thread blocked
//                                                       0/250/600ms: preview
//                                                       and commit agreed 15/15
//   an ancestor block's transition dragging the slot    the block carries
//                                                       transform with NO
//                                                       transition, by design
//                                                       (WindowEntryContainer)
//
// The suite is green 360/360 over ten repeats of all three specs. So the next
// occurrence is on CI, months of runs apart, and a bare "expected 426, received
// 429" costs another investigation that ends where this one did.
//
// This records what the assertion depends on, per frame, and prints it ONLY
// when the assertion fails. The one question it is built to answer is the one
// no CI failure so far can: WAS THE NUMBER STILL MOVING? A series that
// converges on the expected value names a settle race; a series that sat flat
// on the wrong value names a real disagreement, and those need opposite fixes.

/** One frame's worth of everything a drag assertion reads. */
export interface GeometryFrame {
  /** Milliseconds since the recorder started. */
  t: number;
  /** The scrolling pane's offset -- every viewport top below is relative to it. */
  scrollTop: number;
  /** Caller-named selectors to their `getBoundingClientRect().top`. */
  tops: Record<string, number>;
  /** Every row carrying a non-zero commanded `translateY`, by drag row id. */
  shifts: Record<string, number>;
}

interface EvidenceWindow extends Window {
  __dragEvidence?: GeometryFrame[];
  __dragEvidenceStop?: boolean;
}

// Installs a per-frame recorder for the given selectors.
//
// Change-only: a frame is kept just when something in it differs from the one
// before, so a drag that rests for 300ms costs one entry rather than eighteen.
// That matters for more than log size -- this runs inside the page being
// measured, and a recorder that allocates every frame is a recorder that
// changes what it is recording.
export async function startGeometryEvidence(
  page: Page,
  selectors: Record<string, string>
): Promise<void> {
  await page.evaluate((selectors) => {
    const w = window as EvidenceWindow;
    w.__dragEvidence = [];
    w.__dragEvidenceStop = false;
    const frames = w.__dragEvidence;
    const t0 = performance.now();

    // The pane is found the same way every spec finds it: walk up from a
    // window row until something actually scrolls. Duplicated there for
    // historical reasons; done once here so the evidence cannot disagree with
    // the test about which element it is.
    const paneOf = (): HTMLElement | null => {
      let el =
        document.querySelector<HTMLElement>('[data-drag-row-id="w1"]')
          ?.parentElement ?? null;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      return el;
    };
    const pane = paneOf();
    const round = (n: number) => Math.round(n * 100) / 100;
    const translateY = (el: HTMLElement) =>
      Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

    const step = () => {
      const tops: Record<string, number> = {};
      for (const [name, selector] of Object.entries(selectors)) {
        const el = document.querySelector(selector);
        if (el) tops[name] = round(el.getBoundingClientRect().top);
      }
      const shifts: Record<string, number> = {};
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-drag-row-id]'
      )) {
        const n = translateY(el);
        if (n !== 0) shifts[el.dataset.dragRowId!] = round(n);
      }
      const frame: GeometryFrame = {
        t: Math.round(performance.now() - t0),
        scrollTop: pane ? round(pane.scrollTop) : -1,
        tops,
        shifts,
      };
      // Everything but `t`: the timestamp always differs, so comparing it
      // would keep every frame and defeat the point.
      const shape = (f: GeometryFrame) =>
        JSON.stringify([f.scrollTop, f.tops, f.shifts]);
      const last = frames[frames.length - 1];
      if (!last || shape(last) !== shape(frame)) frames.push(frame);
      if (!w.__dragEvidenceStop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, selectors);
}

/** Every frame recorded so far. Leaves the recorder running. */
export async function readGeometryEvidence(
  page: Page
): Promise<GeometryFrame[]> {
  return page.evaluate(() => (window as EvidenceWindow).__dragEvidence ?? []);
}

// Stops the recorder. Safe to call when one was never started, and safe after
// the page has gone -- a recorder that cannot be stopped is not a failure worth
// reporting, and must never replace one that is.
async function stopGeometryEvidence(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      (window as EvidenceWindow).__dragEvidenceStop = true;
    })
    .catch(() => {});
}

// Runs an assertion and, if it fails, prints and attaches the recorded frames
// before letting the failure through. The recorder is STOPPED either way: it
// samples every frame inside the page it is measuring, so leaving it running
// for the rest of the test would have it observing a drag it is also costing
// frames. Recording therefore spans exactly `startGeometryEvidence` to here.
//
// Printed as well as attached on purpose. The attachment rides in the trace,
// which is where a local investigation would look; the print goes to the
// GitHub Actions log, which is the only artefact a green-on-re-run flake
// reliably leaves behind. This repo has already paid once for evidence that
// existed only in a place nobody was looking (KAN-146's dot-reporter hang).
//
// `extra` gathers whatever else the failing assertion needs -- the committed
// store order, a recorded preview index -- at failure time, so a passing run
// pays nothing for it.
//
// EVERY step of the gathering is guarded, and that is the whole contract of
// this function rather than defensive habit. All of it runs after an assertion
// has ALREADY failed, against a page that may be closing, and `test.info()`
// throws outright when no test is running. An unguarded step would replace a
// real failure -- "expected 426, received 429" -- with a diagnostic's own
// error, losing the very thing it was gathered to explain. A gatherer that can
// eat the failure is worse than no gatherer. Whatever breaks, `failure` is what
// comes out; the report simply loses the part that broke.
export async function withGeometryEvidence<T>(
  page: Page,
  label: string,
  assertion: () => Promise<T>,
  extra?: () => Promise<unknown>
): Promise<T> {
  try {
    const result = await assertion();
    await stopGeometryEvidence(page);
    return result;
  } catch (failure) {
    const frames = await readGeometryEvidence(page).catch(() => []);
    await stopGeometryEvidence(page);
    const detail = extra
      ? await extra().catch((error: unknown) => ({
          // Named so a half-gathered report cannot be mistaken for a complete
          // one -- an absent `detail` and an unreadable one are different facts.
          unavailable: String(error),
        }))
      : undefined;
    const report = JSON.stringify(
      { label, frames, ...(detail !== undefined ? { detail } : {}) },
      null,
      2
    );
    console.log(`\n=== drag evidence: ${label} ===\n${report}\n`);
    try {
      // `test.info()` throws SYNCHRONOUSLY outside a running test, so this
      // needs a try rather than a .catch on the returned promise.
      await test.info().attach(`drag-evidence-${label}`, {
        body: report,
        contentType: 'application/json',
      });
    } catch {
      // The console line above already carries the evidence.
    }
    throw failure;
  }
}
