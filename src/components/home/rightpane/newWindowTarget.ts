// KAN-350 (S3 A). The New window target is the synthetic first window a
// carried tab or group can land in (CARRY_NEW_WINDOW_ID). It is lit -- the
// hover fill and a solid border -- while the landing is in it.
//
// Written straight to the DOM, as a band's drop-target mark is
// (useTabDropGeometry's onDropTargetChange): it changes as the pointer moves,
// and React never renders this attribute, so a re-render cannot drop it.
import { CARRY_NEW_WINDOW_ID } from '../../../utils/functions/carriedView';

export const NEW_WINDOW_TARGET = '[data-new-window-target]';

// A drag area's onLandingWindowChange: marks the target in `list` while the
// landing window is the synthetic one, and unmarks it otherwise.
export function markNewWindowTarget(
  windowId: string | undefined,
  list: HTMLElement | null
): void {
  const target = list?.querySelector(NEW_WINDOW_TARGET);
  if (windowId === CARRY_NEW_WINDOW_ID)
    target?.setAttribute('data-landing', '');
  else target?.removeAttribute('data-landing');
}
