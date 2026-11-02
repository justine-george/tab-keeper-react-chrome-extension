import { CORNER_SHAPE, RADIUS } from './scale';

/** A squircle corner at `radius` (one to four CSS radius values). */
export const corners = (radius: string): string =>
  `border-radius: ${radius}; corner-shape: ${CORNER_SHAPE};`;

export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
const ORDER: readonly Corner[] = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

/**
 * Something painted flush in a PANEL's corner(s) (KAN-721): PANEL_INNER on the
 * corners it touches, so its fill follows the panel's curve, `elsewhere` on
 * the rest (CONTROL for a button, SQUARE for a half of a group).
 */
export const flushIn = (
  touching: readonly Corner[],
  elsewhere: string = RADIUS.CONTROL
): string =>
  corners(
    ORDER.map((c) =>
      touching.includes(c) ? RADIUS.PANEL_INNER : elsewhere
    ).join(' ')
  );
