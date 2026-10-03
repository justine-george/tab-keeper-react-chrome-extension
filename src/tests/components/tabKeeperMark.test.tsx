import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import TabKeeperMark from '../../components/common/TabKeeperMark';
import HeroContainerLeft from '../../components/home/leftpane/HeroContainerLeft';
import { renderWithProviders } from '../setup/renderWithProviders';

const BAKED = [
  '#99bf9d',
  '#253038',
  '#445562',
  '#222636',
  '#f4eae2',
  '#20292e',
  '#d09263',
];

const markOf = (container: HTMLElement): SVGSVGElement => {
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('no mark rendered');
  return svg;
};

const pathIdOf = (svg: SVGSVGElement): string => {
  const path = svg.querySelector('path[id]');
  if (path === null) throw new Error('mark has no id path');
  return path.id;
};

describe('TabKeeperMark', () => {
  test('is decorative: hidden from assistive tech, not focusable, unnamed', () => {
    const svg = markOf(render(<TabKeeperMark />).container);

    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('title')).toBeNull();
  });

  test('every fill is the desaturated table, and nothing is unbaked', () => {
    const svg = markOf(render(<TabKeeperMark />).container);

    const fills = new Set(
      [...svg.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill'))
    );
    expect(fills).toEqual(new Set(BAKED));
  });

  test('two marks keep their own path ids, and each <use> points at its own', () => {
    const { container } = render(
      <>
        <TabKeeperMark />
        <TabKeeperMark />
      </>
    );
    const [a, b] = [...container.querySelectorAll('svg')];

    expect(pathIdOf(a)).not.toBe(pathIdOf(b));
    for (const svg of [a, b]) {
      const hrefs = [...svg.querySelectorAll('use')].map((u) =>
        u.getAttribute('href')
      );
      expect(hrefs).toEqual([`#${pathIdOf(svg)}`, `#${pathIdOf(svg)}`]);
    }
  });

  test('the shutter is addressable', () => {
    const svg = markOf(render(<TabKeeperMark />).container);

    expect(svg.querySelectorAll('[data-mark-part="shutter"]')).toHaveLength(1);
  });
});

describe('the home header', () => {
  test('holds the mark, and the title beside it is not a button', async () => {
    const { container } = await renderWithProviders(<HeroContainerLeft />);

    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Tab Keeper' })).toBeNull();
    expect(screen.getByText('Tab Keeper')).toBeTruthy();
  });
});
