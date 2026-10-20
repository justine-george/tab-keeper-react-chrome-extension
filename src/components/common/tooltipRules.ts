// Pure rules for the app-drawn tooltip (KAN-695): when it shows, where it sits,
// and whether it repeats the name a screen reader already hears.
export const FIRST_DELAY_MS = 300;
export const WARM_DELAY_MS = 100;
export const WARM_WINDOW_MS = 500;
export const GAP_PX = 6;
export const INSET_PX = 8;
export const MAX_WIDTH_PX = 260;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Placement {
  left: number;
  top: number;
  side: 'below' | 'above';
}

/** Short delay while moving between tooltips, the first delay otherwise. */
export function showDelay(now: number, lastHiddenAt: number | null): number {
  const warm = lastHiddenAt !== null && now - lastHiddenAt < WARM_WINDOW_MS;
  return warm ? WARM_DELAY_MS : FIRST_DELAY_MS;
}

/** Below the anchor if it fits, else above; always inside the viewport inset. */
export function placeTooltip(
  anchor: Box,
  tip: Size,
  viewport: Size
): Placement {
  const maxLeft = viewport.width - INSET_PX - tip.width;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.min(Math.max(centred, INSET_PX), maxLeft);

  const below = anchor.top + anchor.height + GAP_PX;
  if (below + tip.height <= viewport.height - INSET_PX) {
    return { left, top: below, side: 'below' };
  }
  const above = anchor.top - GAP_PX - tip.height;
  if (above >= INSET_PX) return { left, top: above, side: 'above' };
  return {
    left,
    top: viewport.height - INSET_PX - tip.height,
    side: 'below',
  };
}

/** The accessible description: the tooltip, unless it only repeats the name (KAN-345). */
export function tooltipDescription(
  tooltip: string | undefined,
  name: string | undefined
): string | undefined {
  if (!tooltip) return undefined;
  return name?.startsWith(tooltip) ? undefined : tooltip;
}
