import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LANDING_SLIDE,
  landingTops,
  slideLanding,
} from '../../components/home/rightpane/rowDrag/landingSlides';
import { settleSlides } from '../../components/home/rightpane/rowDrag/settleSlides';
import { EASE } from '../../styles/scale';

// KAN-836. A drop into a window below its own closes the source's room when
// the move is drawn, and every block below moves up a row. Window blocks
// carry no transition (KAN-184), so they glide here instead: from where the
// drop showed them. jsdom lays nothing out, so every top below is stubbed.
// KAN-822. The dropped row glides into its slot from where it was let go, within a window too.

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
        { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE }
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

    // 120 -> 98 is 22; w2 carries 32 of it, so the row goes -10 on its own, on its block's curve so the two add up (KAN-958).
    expect(r).toHaveBeenCalledWith(
      [{ transform: 'translateY(-10px)' }, { transform: 'none' }],
      { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE }
    );
  });

  // KAN-822. A drop within a window: no block moved, but the dropped row still glides from where it was let go.
  it('no block moved (a drop within a window): the blocks stay, the dropped row glides into its slot', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
    at(row, 104);
    const blockGlides = blocks.map(animated);
    const r = animated(row);

    slideLanding(root, before, row);

    for (const a of blockGlides) expect(a).not.toHaveBeenCalled();
    expect(r).toHaveBeenCalledWith(
      [{ transform: 'translateY(6px)' }, { transform: 'none' }],
      { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE }
    );
  });

  // KAN-957. A row in no window block (a session) glides from where it was let go too.
  it('a session row glides into its slot (KAN-957)', () => {
    reduceMotion(false);
    const root = document.createElement('div');
    const row = document.createElement('div');
    root.append(row);
    at(row, 110);
    const before = landingTops(root, row);
    at(row, 80);
    const r = animated(row);

    slideLanding(root, before, row);

    expect(r).toHaveBeenCalledWith(
      [{ transform: 'translateY(30px)' }, { transform: 'none' }],
      { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE }
    );
  });

  it('a row let go on its slot glides nothing', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    blocks.forEach((b, i) => at(b, i * 100));
    at(row, 110);
    const before = landingTops(root, row);
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

  // KAN-956. A new FIRST window has no block above it: it glides with the block below, so the two never overlap.
  it('a window the drop made first glides with the block below it', () => {
    reduceMotion(false);
    const { root, blocks, row } = list();
    const [w1, w2, w3] = blocks;
    at(w1, 0);
    at(w2, 120);
    at(w3, 260);
    at(row, 10);
    const before = landingTops(root, row);
    // A new window above w1 holds the dropped row: w1 down 72, the rest down 40 (w1 is a row shorter).
    const made = block(root, 'new');
    root.prepend(made);
    at(made, 0);
    at(w1, 72);
    at(w2, 160);
    at(w3, 300);
    const [a1, a2, a3, aMade] = [...blocks, made].map(animated);

    slideLanding(root, before, row);

    for (const [a, by] of [
      [aMade, -72],
      [a1, -72],
      [a2, -40],
      [a3, -40],
    ] as const)
      expect(a).toHaveBeenCalledWith(
        [{ transform: `translateY(${by}px)` }, { transform: 'none' }],
        { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE }
      );
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

// KAN-822 (KAN-959). Emptied gs at 68, folded gf 140, a1 176, w2 drawn a row low at 252: pruning gs eases them all up 72.
describe('slideLanding when the drop closes a room held open (KAN-959)', () => {
  const heldRoomList = () => {
    const root = document.createElement('div');
    const w1 = block(root, 'w1');
    const w2 = block(root, 'w2');
    const band = (id: string) => {
      const el = document.createElement('div');
      el.setAttribute('data-band-id', id);
      w1.append(el);
      return el;
    };
    const rowIn = (parent: HTMLElement) => {
      const el = document.createElement('div');
      parent.append(el);
      return el;
    };
    const gs = band('gs');
    const gf = band('gf');
    const f0 = rowIn(gf);
    const a1 = rowIn(w1);
    const s0 = rowIn(gs);
    return { root, w1, w2, gs, gf, f0, a1, s0 };
  };
  const glidesBy = (by: number) => [
    [{ transform: `translateY(${by}px)` }, { transform: 'none' }],
    { duration: 200, easing: EASE.OUT, id: LANDING_SLIDE },
  ];

  it('glides the bands and rows of its window, and the blocks below, up from where they were drawn, easing out', () => {
    reduceMotion(false);
    const { root, w1, w2, gs, gf, a1, s0 } = heldRoomList();
    at(w1, 0);
    at(w2, 252);
    at(gs, 68);
    at(gf, 140);
    at(a1, 176);
    at(s0, 190);
    const rows = new Map([
      ['a1', a1],
      ['s0', s0],
    ]);
    const before = landingTops(root, s0, { windowId: 'w1', rows });
    // Pruned: gs is gone, s0 is loose after a1.
    gs.remove();
    at(w2, 180);
    at(gf, 68);
    at(a1, 104);
    at(s0, 136);
    const [b1, b2, g, a, s] = [w1, w2, gf, a1, s0].map(animated);

    slideLanding(root, before, s0, rows);

    expect(b1).not.toHaveBeenCalled();
    expect(b2).toHaveBeenCalledWith(...glidesBy(72));
    expect(g).toHaveBeenCalledWith(...glidesBy(72));
    expect(a).toHaveBeenCalledWith(...glidesBy(72));
    expect(s).toHaveBeenCalledWith(...glidesBy(54));
  });

  it('a member of a gliding band, the dropped row too, glides only by what its band does not carry', () => {
    reduceMotion(false);
    const { root, w1, w2, gs, gf, f0, s0 } = heldRoomList();
    at(w1, 0);
    at(w2, 316);
    at(gs, 68);
    at(gf, 140);
    at(f0, 204);
    at(s0, 190);
    const rows = new Map([
      ['f0', f0],
      ['s0', s0],
    ]);
    const before = landingTops(root, s0, { windowId: 'w1', rows });
    // s0 joined gf at its head: gf 68, s0 100, f0 132.
    gs.remove();
    gf.prepend(s0);
    at(w2, 244);
    at(gf, 68);
    at(s0, 100);
    at(f0, 132);
    const [g, f, s] = [gf, f0, s0].map(animated);

    slideLanding(root, before, s0, rows);

    expect(g).toHaveBeenCalledWith(...glidesBy(72));
    expect(f).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledWith(...glidesBy(18));
  });

  it('a join on a folded group in the last window draws no row and moves no block: its window still glides up', () => {
    reduceMotion(false);
    const { root, w1, w2, gs, gf, a1, s0 } = heldRoomList();
    w2.remove();
    at(w1, 0);
    at(gs, 68);
    at(gf, 140);
    at(a1, 176);
    const rows = new Map([['a1', a1]]);
    const before = landingTops(root, undefined, { windowId: 'w1', rows });
    // s0 joined the folded gf, so it draws no row; gs is gone.
    gs.remove();
    s0.remove();
    at(gf, 68);
    at(a1, 104);
    const [b1, g, a] = [w1, gf, a1].map(animated);

    slideLanding(root, before, undefined, rows);

    expect(b1).not.toHaveBeenCalled();
    expect(g).toHaveBeenCalledWith(...glidesBy(72));
    expect(a).toHaveBeenCalledWith(...glidesBy(72));
  });

  it('with no room held open, the rows of the window stay put (KAN-835)', () => {
    reduceMotion(false);
    const { root, w1, w2, gf, a1, s0 } = heldRoomList();
    at(w1, 0);
    at(w2, 220);
    at(gf, 140);
    at(a1, 176);
    at(s0, 190);
    const before = landingTops(root, s0);
    at(gf, 100);
    at(a1, 136);
    at(s0, 170);
    const [g, a] = [gf, a1].map(animated);
    animated(s0);

    slideLanding(root, before, s0, new Map([['a1', a1]]));

    expect(g).not.toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
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
