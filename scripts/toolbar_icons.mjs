// KAN-932. The single-colour toolbar icons: a disk outline with its cut corner, a
// solid shutter and a line for the label. 1.75 is Chrome's own icons' line, measured
// on a real toolbar, on the 16 box extension icons get.
export const TOOLBAR_INK = { light: '#c7c7c7', dark: '#474747' };

// KAN-938. The 32px file draws the mark at 15px, centered: filling the box read as sitting low. 1x stays hand-pixelled at 16, where 15 cannot center.
export const TOOLBAR_32_MARK_PX = 30;

export const toolbarSvg = (ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${ink}" stroke-width="1.75" stroke-linejoin="round"><path d="M2.1 .9H11.4L15.1 4.6V13.9A1.2 1.2 0 0 1 13.9 15.1H2.1A1.2 1.2 0 0 1 .9 13.9V2.1A1.2 1.2 0 0 1 2.1 .9Z"/><path d="M4.6 .9H10.4V5.6H4.6Z" fill="${ink}" stroke="none"/><path d="M4 15.1V9.4H12V15.1"/></svg>`;

// Pixelled by hand, as icon16.png is (KAN-907): drawn down, 1.75 goes soft at 1x.
export const TOOLBAR_16_GRID = [
  '.############...',
  '##############..',
  '##..######..###.',
  '##..######...###',
  '##..######....##',
  '##..######....##',
  '##............##',
  '##............##',
  '##............##',
  '##..########..##',
  '##..########..##',
  '##..##....##..##',
  '##..##....##..##',
  '##..##....##..##',
  '################',
  '.##############.',
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function toolbar16Pixels(ink) {
  const on = [...hex(ink), 255];
  const off = [...hex(ink), 0];
  return TOOLBAR_16_GRID.map((row) =>
    [...row].map((letter) => (letter === '#' ? on : off))
  );
}
