import { describe, expect, test } from 'vitest';

import {
  CompactViewArt,
  FullViewArt,
} from '../../components/modals/defaultViewArt';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-628. Setup's two pictures point at Tab Keeper the same way: a dashed outline
// around its floppy, in the toolbar for the compact view, on its tab for the full view.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const boxOf = (el: Element): Box => ({
  x: Number(el.getAttribute('x')),
  y: Number(el.getAttribute('y')),
  width: Number(el.getAttribute('width')),
  height: Number(el.getAttribute('height')),
});
const encloses = (outer: Box, inner: Box): boolean =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

// A floppy drawn in the picture: the header mark, inside its foreignObject.
const floppiesIn = (root: ParentNode): Element[] =>
  [...root.querySelectorAll('foreignObject')].filter(
    (f) => f.querySelector('[data-mark-part]') !== null
  );

async function draw(art: 'compact' | 'full'): Promise<SVGSVGElement> {
  const { container } = await renderWithProviders(
    art === 'compact' ? <CompactViewArt /> : <FullViewArt />
  );
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('no picture');
  return svg;
}

describe('setup’s view pictures (KAN-628)', () => {
  test.each(['compact', 'full'] as const)(
    'the %s picture outlines Tab Keeper’s floppy with one dashed box',
    async (art) => {
      const svg = await draw(art);
      const dashed = [...svg.querySelectorAll('[stroke-dasharray]')];
      expect(dashed).toHaveLength(1);
      const outlined = floppiesIn(svg).filter((f) =>
        encloses(boxOf(dashed[0]), boxOf(f))
      );
      expect(outlined).toHaveLength(1);
    }
  );

  test('the full view: two tabs in the strip, Tab Keeper’s first and outlined', async () => {
    const svg = await draw('full');
    const tabs = [...svg.querySelectorAll('[data-art-part="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(floppiesIn(tabs[0])).toHaveLength(1);
    expect(floppiesIn(tabs[1])).toHaveLength(0);
  });

  test('the full view’s page is the real one: saved sessions under the floppy, and Open now’s tabs', async () => {
    const svg = await draw('full');
    const sessions = svg.querySelector('[data-art-part="sessions"]');
    const openNow = svg.querySelector('[data-art-part="open-now"]');
    if (sessions === null || openNow === null) throw new Error('no panes');
    expect(floppiesIn(sessions)).toHaveLength(1);
    // Each open tab: a favicon dot and its title.
    expect(openNow.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3);
  });
});

// KAN-905. The drawings are rounded as the app is; the browser around them is
// Chrome's and stays square.
describe('setup’s view pictures are rounded like the app (KAN-905)', () => {
  const rx = (el: Element | null | undefined) => el?.getAttribute('rx');
  // A band clipped to a rounded box: its clip-path names a clipPath whose rect has `r`.
  const clippedAt = (svg: SVGSVGElement, band: Element): string | null => {
    const id = /url\(#(.+)\)/.exec(band.getAttribute('clip-path') ?? '')?.[1];
    if (id === undefined) return null;
    const clip = [...svg.querySelectorAll('clipPath')].find((c) => c.id === id);
    return clip?.querySelector('rect')?.getAttribute('rx') ?? null;
  };

  test('the compact view: a pill address bar, the icon’s outline at 4, the popup at 6 with its header inside the curve', async () => {
    const svg = await draw('compact');
    const rects = [...svg.querySelectorAll('rect')];
    const toolbar = rects[0];
    expect(rx(toolbar)).toBeNull();
    expect(rx(rects[1])).toBe('7');
    expect(rx(svg.querySelector('[stroke-dasharray]'))).toBe('4');
    const popup = svg.querySelector('[data-art-part="popup"]');
    if (popup === null) throw new Error('no popup');
    expect(rx(popup.querySelector('[data-art-part="frame"]'))).toBe('6');
    const header = popup.querySelector('[data-art-part="header"]');
    if (header === null) throw new Error('no header');
    expect(clippedAt(svg, header)).toBe('6');
  });

  test('the full view: panes at 5, the search field at 4, the selected row set in at 3, Open now’s header inside the curve', async () => {
    const svg = await draw('full');
    const sessions = svg.querySelector('[data-art-part="sessions"]');
    const openNow = svg.querySelector('[data-art-part="open-now"]');
    if (sessions === null || openNow === null) throw new Error('no panes');
    expect(rx(sessions.querySelector('[data-art-part="frame"]'))).toBe('5');
    expect(rx(openNow.querySelector('[data-art-part="frame"]'))).toBe('5');
    expect(rx(sessions.querySelector('[data-art-part="search"]'))).toBe('4');
    const row = sessions.querySelector('[data-art-part="selected"]');
    const frame = sessions.querySelector('[data-art-part="frame"]');
    if (row === null || frame === null) throw new Error('no selected row');
    expect(rx(row)).toBe('3');
    const [f, r] = [boxOf(frame), boxOf(row)];
    expect(r.x - f.x).toBeGreaterThanOrEqual(2);
    expect(f.x + f.width - (r.x + r.width)).toBeGreaterThanOrEqual(2);
    const header = openNow.querySelector('[data-art-part="header"]');
    if (header === null) throw new Error('no header');
    expect(clippedAt(svg, header)).toBe('5');
  });

  test('its lines of “text” are round-ended', async () => {
    const svg = await draw('full');
    const lines = [...svg.querySelectorAll('rect')].filter(
      (r) => Number(r.getAttribute('height')) <= 3
    );
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines)
      expect(Number(line.getAttribute('rx'))).toBe(
        Number(line.getAttribute('height')) / 2
      );
  });
});
