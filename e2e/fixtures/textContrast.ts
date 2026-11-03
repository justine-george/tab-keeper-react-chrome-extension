import type { Locator } from '@playwright/test';

import { expect } from './extension';
import { contrast, rgbToHex } from './pixels';

export interface TextContrast {
  text: string;
  color: string;
  ground: string;
  ratio: number;
}

// KAN-7. Each visible text run under `root`: its computed colour against the
// first opaque fill behind it, up the ancestors. A translucent fill on the way
// throws: its blend is what is painted, and only pixels can measure that.
export async function textContrasts(root: Locator): Promise<TextContrast[]> {
  const rows = await root.evaluate((el) => {
    const groundOf = (start: Element): string => {
      for (
        let node: Element | null = start;
        node !== null;
        node = node.parentElement
      ) {
        const fill = getComputedStyle(node).backgroundColor;
        const parts = fill.match(/[\d.]+/g) ?? [];
        const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
        if (alpha === 1) return fill;
        if (alpha > 0) {
          throw new Error(
            `translucent fill ${fill} behind "${start.textContent}"`
          );
        }
      }
      return 'rgb(255, 255, 255)';
    };
    const found: { text: string; color: string; ground: string }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (text === '' || parent === null) continue;
      // A ligature glyph's text is its name, not words.
      if (parent.closest('.material-symbols-outlined') !== null) continue;
      const box = parent.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      found.push({
        text,
        color: getComputedStyle(parent).color,
        ground: groundOf(parent),
      });
    }
    return found;
  });
  return rows.map((row) => {
    const color = rgbToHex(row.color);
    const ground = rgbToHex(row.ground);
    return { text: row.text, color, ground, ratio: contrast(color, ground) };
  });
}

export async function expectReadable(
  root: Locator,
  label: string
): Promise<void> {
  const rows = await textContrasts(root);
  console.log(
    `[contrast] ${label}: ${rows
      .map((r) => `${r.text.slice(0, 28)} ${r.ratio.toFixed(2)}`)
      .join(' | ')}`
  );
  expect(rows.length, `${label}: no text measured`).toBeGreaterThan(0);
  expect(
    rows
      .filter((r) => r.ratio < 4.5)
      .map(
        (r) => `${r.text}: ${r.color} on ${r.ground} = ${r.ratio.toFixed(2)}:1`
      ),
    `${label}: under 4.5:1`
  ).toEqual([]);
}
