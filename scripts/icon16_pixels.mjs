// KAN-907. icon16.png is pixelled by hand: drawn down from the mark, its edges go soft at 16px.
// One letter per pixel, in the 128 drawing's layout: ground rounded 2px, body corners softened one pixel, the cut corner stepped over two.
export const ICON16_GRID = [
  '.agggggggggggga.',
  'agggggggggggggga',
  'ggrbcccccddIrggg',
  'ggbbcccccddIbrgg',
  'ggbbcccccddIbbsg',
  'ggbbcccccddIbbsg',
  'ggbbbbbbbbbbbbsg',
  'ggbbbbbbbbbbbbsg',
  'ggbbccccccccbbsg',
  'ggbbcddddddcbbsg',
  'ggbbccccccccbbsg',
  'ggbbcoooooocbbsg',
  'ggbbcoooooocbdsg',
  'ggrbccccccccbrtg',
  'ggtsssssssssstgg',
  '.agggggggggggga.',
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

// fill: the icon palette's colours for ground, body, shadow, cream, dark, slot edge, orange.
export function icon16Pixels(fill) {
  const g = hex(fill.ground);
  const b = hex(fill.body);
  const c = hex(fill.cream);
  const d = hex(fill.dark);
  const s = mix(g, hex(fill.shadow), 0.15);
  const colour = {
    '.': [...g, 0],
    a: [...g, 140],
    g: [...g, 255],
    b: [...b, 255],
    r: [...mix(g, b, 0.8), 255],
    c: [...c, 255],
    d: [...d, 255],
    I: [...mix(b, d, 0.5), 255],
    o: [...hex(fill.orange), 255],
    s: [...s, 255],
    t: [...mix(g, s, 0.5), 255],
  };
  return ICON16_GRID.map((row) =>
    [...row].map((ch) => {
      const px = colour[ch];
      if (!px) throw new Error(`no colour for "${ch}"`);
      return px;
    })
  );
}
