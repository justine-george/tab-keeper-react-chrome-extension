import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LANDING_SLIDE,
  landingTops,
  slideLanding,
} from '../../components/home/rightpane/rowDrag/landingSlides';
import { settleSlides } from '../../components/home/rightpane/rowDrag/settleSlides';

// KAN-836. A drop into a window below its own closes the source's room when
// the move is drawn, and every block below moves up a row. Window blocks
// carry no transition (KAN-184), so they glide here instead: from where the
// drop showed them, and the dropped row with its block from where it was let
// go. jsdom lays nothing out, so every top below is stubbed.

const at = (el: HTMLElement, top: number) => {
  el.getBoundingClientRect = () => new DOMRect(0, top, 200, 32);
};

const animated = (el: HTMLElement) => {
  const animate = vi.fn();
  el.animate = animate;
  return animate;
};

const block = (root: HTMLElement, id: string) => {
  const el = document.createElement('div');
  el.setAttribute('data-drop-window-id', id);
  root.append(el);
  return el;
};

// Windows w1..w3, a row in w2.
const list = () => {
  const root = document.createElement('div');
  const w1 = block(root, 'w1');
  const w2 = block(root, 'w2');
  const w3 = block(root, 'w3');
  const row = document.createElement('div');
  w2.append(row);
  return { root, blocks: [w1, w2, w3] as const, row };
};

const reduceMotion = (on: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: on });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('slideLanding', () => {
  it('glides every block that moved from where the drop showed it, and leaves the rest', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    const [w1, w2, w3] = blocks;
    at(w1, 0);
    at(w2, 120);
    at(w3, 260);
    at(row, 130);
    const before = landingTops(root, row);
    // The source's room closed: w2 and w3 up a row.
    at(w2, 88);
    at(w3, 228);
    at(row, 98);
    const [a1, a2, a3] = blocks.map(animated);
    animated(row);

    slideLanding(root, before, row);

    expect(a1).not.toHaveBeenCalled();
    for (const a of [a2, a3]) {
      expect(a).toHaveBeenCalledWith(
        [{ transform: 'translateY(32px)' }, { transform: 'none' }],
        { duration: 200, easing: 'ease', id: LANDING_SLIDE }
      );
    }
  });

  it('glides the dropped row only by what its block does not carry', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    const [w1, w2, w3] = blocks;
    at(w1, 0);
    at(w2, 120);
    at(w3, 260);
    // Let go 10px above where it lands in w2.
    at(row, 120);
    const before = landingTops(root, row);
    at(w2, 88);
    at(w3, 228);
    at(row, 98);
    blocks.forEach(animated);
    const r = animated(row);

    slideLanding(root, before, row);

    // 120 -> 98 is 22; w2 carries 32 of it, so the row goes -10 on its own.
    expect(r).toHaveBeenCalledWith(
      [{ transform: 'translateY(-10px)' }, { transform: 'none' }],
      { duration: 200, easing: 'ease', id: LANDING_SLIDE }
    );
  });

  it('CONTROL: no block moved (a drop within a window): nothing glides, not even the dropped row', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
    at(row, 104);
    const animations = [...blocks, row].map(animated);

    slideLanding(root, before, row);

    for (const a of animations) expect(a).not.toHaveBeenCalled();
  });

  it('a scroll while the drop waits for its move glides nothing', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    at(root, 0);
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
    // Scrolled 40px: the list and everything in it, 40px up, nothing moved in it.
    at(root, -40);
    blocks.forEach((b, i) => at(b, i * 100 - 40));
    at(row, 70);
    const animations = [...blocks, row].map(animated);

    slideLanding(root, before, row);

    for (const a of animations) expect(a).not.toHaveBeenCalled();
  });

  it('a window the drop made glides with the block above it', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    const [w1, w2, w3] = blocks;
    at(w1, 0);
    at(w2, 120);
    at(w3, 260);
    at(row, 10);
    const before = landingTops(root, row);
    // The dropped row's room in w1 closed, and a new window holds it below w3.
    const made = block(root, 'w4');
    at(w2, 88);
    at(w3, 228);
    at(made, 300);
    const [, , a3, a4] = [...blocks, made].map(animated);

    slideLanding(root, before, row);

    for (const a of [a3, a4]) {
      expect(a).toHaveBeenCalledWith(
        [{ transform: 'translateY(32px)' }, { transform: 'none' }],
        expect.anything()
      );
    }
  });

  it('with Reduce motion on, nothing glides', () => {
    reduceMotion(true);
    const { root, blocks, row } = list();
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
    at(blocks[1], 68);
    at(blocks[2], 168);
    at(row, 78);
    const animations = [...blocks, row].map(animated);

    slideLanding(root, before, row);

    for (const a of animations) expect(a).not.toHaveBeenCalled();
  });

  it('measures every block before it starts any glide', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
    // Each block reads 32px up -- unless a glide has started, which moves it.
    let started = false;
    const glides = blocks.slice(1).map((b) => {
      const top = b.getBoundingClientRect().top - 32;
      b.getBoundingClientRect = () =>
        new DOMRect(0, started ? top + 32 : top, 200, 32);
      const animate = animated(b);
      animate.mockImplementation(() => {
        started = true;
      });
      return animate;
    });
    at(row, 78);
    animated(row);

    slideLanding(root, before, row);

    for (const animate of glides) {
      expect(animate).toHaveBeenCalledWith(
        [{ transform: 'translateY(32px)' }, { transform: 'none' }],
        expect.anything()
      );
    }
  });
});

describe('settleSlides finishes a landing glide (KAN-836)', () => {
  it('so a drag that starts during one measures the blocks at rest', () => {
    const glide = { id: LANDING_SLIDE, playState: 'running', finish: vi.fn() };
    const other = { id: 'other', playState: 'running', finish: vi.fn() };
    settleSlides({ getAnimations: () => [glide, other] });
    expect(glide.finish).toHaveBeenCalledTimes(1);
    expect(other.finish).not.toHaveBeenCalled();
  });
});
