import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useArrival } from '../../components/home/opennow/useArrival';
import { announceArrival } from '../../utils/functions/arrival';
import type { OpenWindow } from '../../utils/functions/openNow';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-892 D. When the fill behind a dropped window's new rows shows, and when
// it doesn't. jsdom lays nothing out and has no Web Animations: the fill's box
// and the scroll are the e2e spec's (saved-window-into-open-window); here the
// fill shows HOLD + FADE (900ms) with no animation, as under Reduce motion.

// Each render stands for one Open now re-read: a new `windows` array.
const reRead = (): OpenWindow[] => [];
const ROW_PX = 32;

function List({
  drawn,
  windows,
}: {
  drawn: Record<number, number[]>;
  windows: OpenWindow[];
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useArrival(paneRef, scrollerRef, windows);
  return (
    <div ref={paneRef}>
      <div ref={scrollerRef}>
        {Object.entries(drawn).map(([windowId, tabIds]) => (
          <div key={windowId} data-open-window-id={windowId}>
            {tabIds.map((id) => (
              <div key={id} data-open-tab-id={id} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const fills = (container: HTMLElement) => [
  ...container.querySelectorAll('[data-arrival]'),
];
const fillWindow = (fill: Element | undefined) =>
  fill?.parentElement?.getAttribute('data-open-window-id');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the arrival fill', () => {
  test('rows already listed: one fill in their window, gone after 900ms', () => {
    const { container } = render(
      <List drawn={{ 1: [10], 2: [20, 21, 22] }} windows={reRead()} />
    );

    act(() => announceArrival(2, [21, 22]));

    expect(fills(container)).toHaveLength(1);
    expect(fillWindow(fills(container)[0])).toBe('2');
    act(() => vi.advanceTimersByTime(899));
    expect(fills(container)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(fills(container)).toHaveLength(0);
  });

  // Review Focus 5.
  test('rows Open now has not listed yet: it waits for the re-read that lists them', () => {
    const { container, rerender } = render(
      <List drawn={{ 2: [20] }} windows={reRead()} />
    );

    act(() => announceArrival(2, [21, 22]));
    expect(fills(container)).toHaveLength(0);
    // One of the two listed: still waiting.
    rerender(<List drawn={{ 2: [20, 21] }} windows={reRead()} />);
    expect(fills(container)).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1500));
    rerender(<List drawn={{ 2: [20, 21, 22] }} windows={reRead()} />);

    expect(fills(container)).toHaveLength(1);
    expect(fillWindow(fills(container)[0])).toBe('2');
  });

  test('rows not listed within 2s: nothing shows, then or later', () => {
    const { container, rerender } = render(
      <List drawn={{ 2: [20] }} windows={reRead()} />
    );

    act(() => announceArrival(2, [21]));
    act(() => vi.advanceTimersByTime(2000));
    rerender(<List drawn={{ 2: [20, 21] }} windows={reRead()} />);

    expect(fills(container)).toHaveLength(0);
  });

  test('a second arrival replaces the first: one fill, the second one', () => {
    const { container } = render(
      <List drawn={{ 1: [10, 11], 2: [20, 21] }} windows={reRead()} />
    );

    act(() => announceArrival(1, [11]));
    act(() => vi.advanceTimersByTime(300));
    act(() => announceArrival(2, [21]));

    expect(fills(container)).toHaveLength(1);
    expect(fillWindow(fills(container)[0])).toBe('2');
    // Its own 900ms, not what was left of the first's.
    act(() => vi.advanceTimersByTime(800));
    expect(fills(container)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(100));
    expect(fills(container)).toHaveLength(0);
  });

  test('another window listing the same ids is not the one that took them', () => {
    const { container } = render(
      <List drawn={{ 1: [21], 2: [20] }} windows={reRead()} />
    );

    act(() => announceArrival(2, [21]));

    expect(fills(container)).toHaveLength(0);
  });

  // R17. Pinned saved tabs join the pinned run at the top, the rest the end:
  // one fill per run, so the old rows between them are not shown as new.
  test('new rows in two runs: a fill on each, the old rows between in neither, both gone together', () => {
    const { container } = render(
      <List drawn={{ 2: [25, 20, 21, 26, 27] }} windows={reRead()} />
    );
    // Each row 32px tall from y 0, in the order drawn; the block at 0.
    const rows = [...container.querySelectorAll('[data-open-tab-id]')];
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        new DOMRect(10, i * ROW_PX, 300, ROW_PX);
    });
    const block = container.querySelector('[data-open-window-id="2"]');
    if (block === null) throw new Error('no block');
    block.getBoundingClientRect = () => new DOMRect(0, 0, 320, 5 * ROW_PX);

    act(() => announceArrival(2, [25, 26, 27]));

    const spans = fills(container).map((fill) =>
      fill instanceof HTMLElement
        ? { top: fill.style.top, height: fill.style.height }
        : null
    );
    expect(spans).toEqual([
      { top: '0px', height: `${ROW_PX}px` },
      { top: `${3 * ROW_PX}px`, height: `${2 * ROW_PX}px` },
    ]);
    act(() => vi.advanceTimersByTime(899));
    expect(fills(container)).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(fills(container)).toHaveLength(0);
  });

  test('Open now closed mid-fill: the fill goes with it, and nothing runs after', () => {
    const { container, unmount } = render(
      <List drawn={{ 2: [20, 21] }} windows={reRead()} />
    );
    act(() => announceArrival(2, [21]));
    expect(fills(container)).toHaveLength(1);

    unmount();

    expect(() => act(() => vi.advanceTimersByTime(2000))).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  // The parked guard (ledger, Final): the target window closed mid-fill. Its
  // rows, out of the page, measure 0x0 at the viewport's top; aimed at them,
  // the list would glide up. It stays where the fill put it.
  for (const reduced of [true, false]) {
    test(`the target window closed mid-fill: the list stays put${reduced ? ' (Reduce motion)' : ''}`, () => {
      const matchMedia = window.matchMedia;
      window.matchMedia = (query: string) =>
        new FakeMediaQueryList(query, reduced && query.includes('reduce'));
      try {
        const { container, rerender } = render(
          <List drawn={{ 1: [10], 2: [20, 21] }} windows={reRead()} />
        );
        // The list: 100px tall at y 200, 1000px of content, from the top.
        const scroller = container.querySelector(
          '[data-open-window-id]'
        )?.parentElement;
        if (!scroller) throw new Error('no scroller');
        let top = 0;
        Object.defineProperty(scroller, 'scrollTop', {
          get: () => top,
          set: (v: number) => {
            top = v;
          },
          configurable: true,
        });
        Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
        Object.defineProperty(scroller, 'clientHeight', { value: 100 });
        scroller.getBoundingClientRect = () => new DOMRect(0, 200, 320, 100);
        // Window 2's rows drawn below the fold while in the page; 0x0 out of it.
        container
          .querySelectorAll('[data-open-window-id="2"] [data-open-tab-id]')
          .forEach((row, i) => {
            row.getBoundingClientRect = () =>
              row.isConnected
                ? new DOMRect(10, 500 + i * ROW_PX - top, 300, ROW_PX)
                : new DOMRect(0, 0, 0, 0);
          });

        act(() => announceArrival(2, [21]));
        if (!reduced) act(() => vi.advanceTimersByTime(100));
        const mid = top;
        // PREMISE: the list moved toward the new row.
        expect(mid).toBeGreaterThan(0);

        // Window 2 closes; Open now re-reads without it.
        rerender(<List drawn={{ 1: [10] }} windows={reRead()} />);
        act(() => vi.advanceTimersByTime(1000));
        expect(top).toBeGreaterThanOrEqual(mid);
      } finally {
        window.matchMedia = matchMedia;
      }
    });
  }
});
