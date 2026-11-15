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

// KAN-822. A folded group draws its title row only: its new tabs count as listed, its band joins a run only when all are new.
describe('the arrival fill with a folded group', () => {
  const tab = (
    id: number,
    groupId: number | null
  ): OpenWindow['tabs'][number] => ({
    id,
    windowId: 2,
    title: '',
    url: '',
    favIconUrl: '',
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    groupId,
    index: id,
  });
  // Window 2: tabs in Chrome's order; group 7 folded, group 8 open.
  const windowOf = (tabs: OpenWindow['tabs']): OpenWindow => ({
    id: 2,
    isThisWindow: false,
    tabs,
    groups: [
      { id: 7, title: 'Folded', color: 'blue', collapsed: true },
      { id: 8, title: 'Open', color: 'red', collapsed: false },
    ],
    bounds: null,
    state: 'normal',
    incognito: false,
  });

  // Drawn as Open now draws it: loose rows, each band at its first tab, a folded band its title row only.
  function GroupedList({ openWindow }: { openWindow: OpenWindow }) {
    const paneRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    useArrival(paneRef, scrollerRef, [openWindow]);
    const seen = new Set<number>();
    return (
      <div ref={paneRef}>
        <div ref={scrollerRef}>
          <div data-open-window-id={openWindow.id}>
            {openWindow.tabs.map((t) => {
              if (t.groupId === null)
                return <div key={t.id} data-open-tab-id={t.id} />;
              if (seen.has(t.groupId)) return null;
              seen.add(t.groupId);
              const groupId = t.groupId;
              const folded = openWindow.groups.some(
                (g) => g.id === groupId && g.collapsed
              );
              return (
                <div
                  key={`g${groupId}`}
                  data-band-id={groupId}
                  data-group-folded={folded ? '' : undefined}
                >
                  <div data-group-drag-handle />
                  {!folded &&
                    openWindow.tabs
                      .filter((m) => m.groupId === groupId)
                      .map((m) => <div key={m.id} data-open-tab-id={m.id} />)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Each drawn line (tab row or title row) 32px tall from y 0, in order; a band spans its own lines.
  function layOut(container: HTMLElement) {
    const lines = [
      ...container.querySelectorAll(
        '[data-open-tab-id], [data-group-drag-handle]'
      ),
    ];
    lines.forEach((line, i) => {
      line.getBoundingClientRect = () =>
        new DOMRect(10, i * ROW_PX, 300, ROW_PX);
    });
    container.querySelectorAll('[data-band-id]').forEach((band) => {
      const own = lines.filter((line) => band.contains(line));
      const first = lines.indexOf(own[0]);
      band.getBoundingClientRect = () =>
        new DOMRect(10, first * ROW_PX, 300, own.length * ROW_PX);
    });
    const block = container.querySelector('[data-open-window-id]');
    if (block === null) throw new Error('no block');
    block.getBoundingClientRect = () =>
      new DOMRect(0, 0, 320, lines.length * ROW_PX);
  }
  const spans = (container: HTMLElement) =>
    fills(container).map((fill) =>
      fill instanceof HTMLElement
        ? { top: fill.style.top, height: fill.style.height }
        : null
    );

  test('a new tab in a folded group beside old ones: the loose new row still fills, the band does not', () => {
    // Drawn: 10, band 7 (11, 12 inside), 13.
    const { container } = render(
      <GroupedList
        openWindow={windowOf([
          tab(10, null),
          tab(11, 7),
          tab(12, 7),
          tab(13, null),
        ])}
      />
    );
    layOut(container);

    act(() => announceArrival(2, [12, 13]));

    expect(spans(container)).toEqual([
      { top: `${2 * ROW_PX}px`, height: `${ROW_PX}px` },
    ]);
  });

  test('a folded group all of whose tabs are new: its band joins the run beside it', () => {
    // Drawn: 10, band 7 (11, 12 inside), 13.
    const { container } = render(
      <GroupedList
        openWindow={windowOf([
          tab(10, null),
          tab(11, 7),
          tab(12, 7),
          tab(13, null),
        ])}
      />
    );
    layOut(container);

    act(() => announceArrival(2, [11, 12, 13]));

    expect(spans(container)).toEqual([
      { top: `${ROW_PX}px`, height: `${2 * ROW_PX}px` },
    ]);
  });

  test('an old row between a new folded band and a new row: a fill on each, in drawn order', () => {
    // Drawn: band 7 (11, 12 inside), 10, 13.
    const { container } = render(
      <GroupedList
        openWindow={windowOf([
          tab(11, 7),
          tab(12, 7),
          tab(10, null),
          tab(13, null),
        ])}
      />
    );
    layOut(container);

    act(() => announceArrival(2, [11, 12, 13]));

    expect(spans(container)).toEqual([
      { top: '0px', height: `${ROW_PX}px` },
      { top: `${2 * ROW_PX}px`, height: `${ROW_PX}px` },
    ]);
  });

  test('every new tab in a folded group beside old ones: the arrival ends with no fill', () => {
    const { container } = render(
      <GroupedList
        openWindow={windowOf([tab(10, null), tab(11, 7), tab(12, 7)])}
      />
    );
    layOut(container);

    act(() => announceArrival(2, [12]));

    expect(fills(container)).toHaveLength(0);
    // Not waiting on a row that never draws: nothing is left to run.
    expect(vi.getTimerCount()).toBe(0);
  });

  // The open band's rule is unchanged: a new tab in it waits for its row.
  test('a new tab in an open group not drawn yet: it waits for its row', () => {
    const drawnWithout = windowOf([tab(10, null), tab(14, 8)]);
    const { container, rerender } = render(
      <GroupedList openWindow={drawnWithout} />
    );
    act(() => announceArrival(2, [15]));
    expect(fills(container)).toHaveLength(0);

    rerender(
      <GroupedList
        openWindow={windowOf([tab(10, null), tab(14, 8), tab(15, 8)])}
      />
    );

    expect(fills(container)).toHaveLength(1);
  });
});
