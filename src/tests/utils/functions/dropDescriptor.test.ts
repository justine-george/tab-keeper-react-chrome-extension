// @vitest-environment jsdom
//
// This file is `.ts`, which the `unit` project (vitest.config.ts) runs under
// `environment: 'node'` -- no `document`. windowAt hit-tests real DOM rects,
// the same as bandAt beside it, so this one file needs jsdom; the per-file
// docblock override is the intended escape hatch rather than moving the whole
// `unit` project to jsdom or renaming the file to `.tsx`.
import { describe, expect, test } from 'vitest';

import { windowAt } from '../../../components/home/rightpane/rowDrag/dropRules';

const container = (boxes: { id: string; top: number; bottom: number }[]) => {
  const el = document.createElement('div');
  for (const b of boxes) {
    const w = document.createElement('div');
    w.setAttribute('data-drop-window-id', b.id);
    w.getBoundingClientRect = () =>
      ({ top: b.top, bottom: b.bottom, left: 0, right: 100 }) as DOMRect;
    el.appendChild(w);
  }
  return el;
};

describe('windowAt', () => {
  test('names the window whose box contains the pointer', () => {
    const el = container([
      { id: 'wA', top: 0, bottom: 100 },
      { id: 'wB', top: 100, bottom: 200 },
    ]);
    expect(windowAt(el, 50, 50)).toBe('wA');
    expect(windowAt(el, 50, 150)).toBe('wB');
  });

  test('names nothing in the gap outside every window', () => {
    const el = container([{ id: 'wA', top: 0, bottom: 100 }]);
    expect(windowAt(el, 50, 500)).toBeUndefined();
  });

  test('a null container names nothing', () => {
    expect(windowAt(null, 0, 0)).toBeUndefined();
  });
});
