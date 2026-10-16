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
