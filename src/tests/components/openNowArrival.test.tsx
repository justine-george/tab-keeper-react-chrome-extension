import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useArrival } from '../../components/home/opennow/useArrival';
import { announceArrival } from '../../utils/functions/arrival';
import type { OpenWindow } from '../../utils/functions/openNow';

// KAN-892 D. When the fill behind a dropped window's new rows shows, and when
// it doesn't. jsdom lays nothing out and has no Web Animations: the fill's box
// and the scroll are the e2e spec's (saved-window-into-open-window); here the
// fill shows HOLD + FADE (900ms) with no animation, as under Reduce motion.

// Each render stands for one Open now re-read: a new `windows` array.
const reRead = (): OpenWindow[] => [];

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
});
