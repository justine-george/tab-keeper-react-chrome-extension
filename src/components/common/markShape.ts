// KAN-907, his pick B: the mark's corners, in its 128-unit drawing.
export const MARK_RADIUS = {
  GROUND: 15,
  BODY: 6,
  SHUTTER: 3,
  LABEL: 4,
  SLOT: 1.5,
} as const;

// Width of the floppy body, 15.2 to 113.7: scales the mark's radii onto the welcome's floppy.
export const MARK_BODY_WIDTH = 98.5;

// The floppy body: write-protect notch top left, cut corner top right left sharp, the other three rounded by MARK_RADIUS.BODY.
export const MARK_BODY_PATH =
  'M15.2 18.6a6 6 0 0 1 6-6h6.4v3l5 1.3V13h66.6l14.5 14.5v78.3a6 6 0 0 1-6 6H21.2a6 6 0 0 1-6-6z';
