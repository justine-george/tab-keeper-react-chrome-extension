import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import TabKeeperMark from '../../components/common/TabKeeperMark';
import FirstSavePop from '../../components/home/leftpane/FirstSavePop';
import WelcomeHero from '../../components/modals/WelcomeHero';
import { heroPx } from '../../components/modals/welcomeMotion';
import { noteFirstSave } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-907, his pick B: ground 15 of 128, body 6 with the cut corner sharp, shutter 3, label 4, slot 1.5.

// Walks a path of M/H/V/h/v/l/a commands and returns every point it reaches, arcs by their end points.
const outline = (d: string): Array<[number, number]> => {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  const points: Array<[number, number]> = [];
  let [x, y] = [0, 0];
  let command = '';
  for (let i = 0; i < tokens.length;) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (command === 'M') [x, y] = [n(), n()];
    else if (command === 'H') x = n();
    else if (command === 'V') y = n();
    else if (command === 'h') x += n();
    else if (command === 'v') y += n();
    else if (command === 'l') [x, y] = [x + n(), y + n()];
    else if (command === 'a') {
      i += 5;
      [x, y] = [x + n(), y + n()];
    } else if (command === 'z') continue;
    else throw new Error(`unhandled ${command}`);
    points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  return points;
};

const SQUARE_BODY = 'M15.2 12.6h12.4v3l5 1.3V13h66.6l14.5 14.5v84.3H15.2z';
const box = (points: Array<[number, number]>) => ({
  left: Math.min(...points.map((p) => p[0])),
  right: Math.max(...points.map((p) => p[0])),
  top: Math.min(...points.map((p) => p[1])),
  bottom: Math.max(...points.map((p) => p[1])),
});

const bodyOf = (svg: Element): string => {
  const d = svg.querySelector('path')?.getAttribute('d');
  if (!d) throw new Error('no body path');
  return d;
};

describe('the mark (KAN-907)', () => {
  const svg = () => {
    const el = render(<TabKeeperMark />).container.querySelector('svg');
    if (el === null) throw new Error('no mark');
    return el;
  };

  test('the ground rounds 15 of 128', () => {
    expect(svg().querySelector('rect')?.getAttribute('rx')).toBe('15');
  });

  test('the body keeps its old outline, three corners rounded 6 and the cut corner sharp', () => {
    const d = bodyOf(svg());
    expect(box(outline(d))).toEqual(box(outline(SQUARE_BODY)));
    expect(d.match(/a6 6 0 0 1/g)).toHaveLength(3);
    // The cut runs from the top edge straight into the right edge, no arc between.
    expect(d).toContain('h66.6l14.5 14.5v');
  });

  test('the shutter rounds 3, its slot 1.5, the label 4', () => {
    const shutter = [
      ...svg().querySelectorAll('[data-mark-part="shutter"] rect'),
    ];
    expect(shutter.map((r) => r.getAttribute('rx'))).toEqual(['3', '3', '1.5']);
    const label = svg().querySelector('rect[y="64.8"]');
    expect(label?.getAttribute('rx')).toBe('4');
  });
});

describe('the first-save pop disk (KAN-907)', () => {
  beforeEach(() => {
    Element.prototype.animate = vi.fn(
      () =>
        ({
          finished: new Promise(() => {}),
          cancel: () => {},
        }) as unknown as Animation
    );
  });
  afterEach(() => {
    // @ts-expect-error -- jsdom's Element has no animate; put that back.
    delete Element.prototype.animate;
  });

  test('is the mark floppy, rounded the same', async () => {
    const { store } = await renderWithProviders(<FirstSavePop />);
    act(() => {
      store.dispatch(noteFirstSave());
    });
    const disk = document.querySelector('[data-first-save-pop] svg');
    if (disk === null) throw new Error('no disk');
    const mark = render(<TabKeeperMark />).container.querySelector('svg');
    if (mark === null) throw new Error('no mark');

    expect(bodyOf(disk)).toBe(bodyOf(mark));
    const rx = (el: Element, y: string) =>
      el.querySelector(`rect[y="${y}"]`)?.getAttribute('rx');
    expect([rx(disk, '12.9'), rx(disk, '18.4'), rx(disk, '64.8')]).toEqual([
      '3',
      '1.5',
      '4',
    ]);
  });
});

describe('the welcome floppy (KAN-907)', () => {
  // The hero's floppy is FLOPPY px square for the mark's 98.5-unit body.
  const scaled = (units: number) => `${(units * heroPx(72)) / 98.5}px`;
  const radius = (part: string) => {
    const el = document.querySelector(`[data-hero-part="${part}"]`);
    if (el === null) throw new Error(`no ${part}`);
    return getComputedStyle(el).borderRadius;
  };

  test('rounds its body and parts like the mark, at its own scale', async () => {
    await renderWithProviders(<WelcomeHero frame="end" />);
    expect(radius('floppy')).toBe(scaled(6));
    expect(radius('shutter')).toBe(scaled(3));
    expect(radius('slot')).toBe(scaled(1.5));
    expect(radius('label')).toBe(scaled(4));
  });
});
