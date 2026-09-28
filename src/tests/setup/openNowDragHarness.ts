import { fireEvent } from '@testing-library/react';

import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';

// The Open now drag tests' shared harness (KAN-280 Part E Task 6c, reused by
// KAN-330). jsdom has no layout, so each window block, row and group title row
// is given the box a browser would draw, 32px a row:
//
//   W1 block  0..H1    header 0..32, then its rows from 32
//   (gap 8)
//   W2 block  ...      header, then its rows

export const ROW = 32;
export const GAP = 8;

export const box = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 300,
  height,
  width: 300,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

export const url = (name: string) => `https://${name}.test/`;

export async function snapshot(hasTabGroups: boolean): Promise<OpenWindow[]> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups =
    hasTabGroups && chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

export function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

// Gives every drawn part of `windows` its box, top to bottom, and returns
// where each row and title row sits. A group is its title row, then its
// tabs; its item row spans all of that.
export function layOut(
  windows: readonly OpenWindow[],
  folded: ReadonlySet<number> = new Set()
) {
  const top = new Map<string, number>();
  let y = 0;
  for (const window of windows) {
    const start = y;
    y += ROW; // the window's own row
    top.set(`window:${window.id}`, start);
    // A folded window draws its own row alone.
    const drawn = folded.has(window.id) ? [] : window.tabs;
    const seen = new Set<number>();
    for (const tab of drawn) {
      if (tab.groupId !== null && !seen.has(tab.groupId)) {
        seen.add(tab.groupId);
        const members = window.tabs.filter((t) => t.groupId === tab.groupId);
        const groupTop = y;
        const height = ROW * (members.length + 1);
        find(
          `[data-drag-row-id="group:${tab.groupId}"]`
        ).getBoundingClientRect = () => box(groupTop, height);
        find(`[data-fixed-row-id="${tab.groupId}"]`).getBoundingClientRect =
          () => box(groupTop, ROW);
        top.set(`group:${tab.groupId}`, groupTop);
        y += ROW;
      }
      const rowTop = y;
      find(`[data-drag-row-id="${tab.id}"]`).getBoundingClientRect = () =>
        box(rowTop, ROW);
      if (tab.groupId === null) {
        find(`[data-drag-row-id="tab:${tab.id}"]`).getBoundingClientRect = () =>
          box(rowTop, ROW);
      }
      top.set(String(tab.id), rowTop);
      y += ROW;
      const last = window.tabs.filter((t) => t.groupId === tab.groupId).pop();
      if (tab.groupId !== null && last === tab) {
        find(
          `[data-fixed-row-id="${tab.groupId}:tail"]`
        ).getBoundingClientRect = () => box(y, 0);
      }
    }
    const height = y - start;
    find(`[data-drop-window-id="${window.id}"]`).getBoundingClientRect = () =>
      box(start, height);
    y += GAP;
  }
  return top;
}

// Presses `el` at y, crosses the activation distance, holds at `to`, and
// releases there.
export function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { clientX: 10, clientY: from, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: from + 8 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: to });
  fireEvent.pointerUp(document, { clientX: 10, clientY: to });
}

export const tabRow = (id: number) => find(`[data-drag-row-id="${id}"]`);
