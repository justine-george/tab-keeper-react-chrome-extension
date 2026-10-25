import type { SvgIconName } from './iconNames';

/**
 * Glyphs Material Symbols does not carry, drawn as one path in a 24x24 box.
 * Keyed by the same `type` string a ligature uses, so a caller says
 * `type="x"` and neither knows nor cares which path it took.
 *
 * Add sparingly. Every entry is bytes in every user's bundle whether or not
 * anything renders it, the same trap the TOAST_MESSAGES comment describes.
 */
export const SVG_GLYPHS: Record<SvgIconName, string> = {
  // The app's own mark, for the About nameplate (KAN-241): the floppy from
  // icon128.png -- notched body, top label with its slider, lower label with
  // three stripes -- traced to a 24x24 box as ONE colour. Not the PNG: that is
  // an opaque mint square edge to edge, the only saturated fill on any
  // settings pane, and it read as a tile rather than a mark. Drawn in
  // currentColor it is made of the same ink as the text beside it, which is
  // how the popup treats every other glyph.
  //
  // Nonzero winding: the body runs clockwise, the two label cut-outs
  // anticlockwise, the stripes clockwise again inside the lower cut-out.
  tab_keeper:
    'M3 3.5h14.5L21 7v13.5H3zM7 3.5v6h9v-6h-2.4v4.2h-2.2V3.5zM6.5 13v7.5h11V13zM8 14.4h8v1.2H8zM8 16.6h8v1.2H8zM8 18.8h8v1.2H8z',
  // KAN-780. Save current window: `web_asset`, its bottom-right corner cut
  // away by a circle (centre 20.16, 20.16; r 9.84), and `add` scaled 0.62 into
  // the cut (offset 11.52). Traced, not redrawn, from Material Symbols outlines
  // (opsz 48, FILL 0): the window at the bundled font's wght 400, so its strokes
  // are its neighbours'; the plus at wght 700, so its 1.46-unit bar matches the
  // frame's 1.5 (at 400 it greyed out on a 1x screen at Medium, his pick 700).
  window_add:
    'M3.5 20Q2.9 20 2.45 19.55Q2 19.1 2 18.5L2 5.5Q2 4.9 2.45 4.45Q2.9 4 3.5 4L20.5 4Q21.1 4 21.55 4.45Q22 4.9 22 5.5L22 10.5C21.51 10.4 21.01 10.35 20.5 10.33L20.5 7.6L3.5 7.6L3.5 18.5L10.46 18.5C10.38 18.99 10.33 19.49 10.33 20ZM18.23 19.69L14.23 19.69L14.23 18.23L18.23 18.23L18.23 14.22L19.69 14.22L19.69 18.23L23.7 18.23L23.7 19.69L19.69 19.69L19.69 23.69L18.23 23.69Z',
  // KAN-780. Save every open window: `select_window` (two titled windows),
  // cut and badged exactly as window_add, from the same font instance.
  two_windows_add:
    'M3.5 22Q2.9 22 2.45 21.55Q2 21.1 2 20.5L2 10.82Q2 10.23 2.45 9.78Q2.9 9.32 3.5 9.32L6.38 9.32L6.38 3.5Q6.38 2.9 6.83 2.45Q7.28 2 7.88 2L20.5 2Q21.1 2 21.55 2.45Q22 2.9 22 3.5L22 10.5C21.51 10.4 21.01 10.35 20.5 10.33L20.5 5L7.88 5L7.88 9.32L15.8 9.32Q16.6 9.32 17.12 9.85Q17.47 10.2 17.59 10.66C16.35 11 15.21 11.57 14.21 12.32L3.5 12.32L3.5 20.5L10.33 20.5C10.35 21.01 10.4 21.51 10.5 22ZM18.23 19.69L14.23 19.69L14.23 18.23L18.23 18.23L18.23 14.22L19.69 14.22L19.69 18.23L23.7 18.23L23.7 19.69L19.69 19.69L19.69 23.69L18.23 23.69Z',
};
