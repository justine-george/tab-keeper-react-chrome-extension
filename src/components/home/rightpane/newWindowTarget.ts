// KAN-350 (S3 A). The New window target is the synthetic first window a
// carried tab or group can land in (CARRY_NEW_WINDOW_ID). It is lit -- the
// hover fill and a solid border -- while the landing is in it.
//
// Written straight to the DOM, as a band's drop-target mark is
// (useTabDropGeometry's onDropTargetChange): it changes as the pointer moves,
// and React never renders this attribute, so a re-render cannot drop it.
import { css, type SerializedStyles } from '@emotion/react';

import { CARRY_NEW_WINDOW_ID } from '../../../utils/functions/carriedView';
import type { ThemeColors } from '../../../hooks/useThemeColors';
import { RADIUS } from '../../../styles/scale';

export const NEW_WINDOW_TARGET = '[data-new-window-target]';

// What a New window target's box looks like, wherever it is drawn: the
// in-list window (WindowEntryContainer) and the session header's toolbar row
// (KAN-361 N1 B, HeroContainerRight). One look in one place, so the two
// cannot drift apart. A dashed box, and lit -- the hover fill and a solid
// border -- while the landing is in it. Where it sits and how tall it is are
// the caller's; its name is NewWindowTargetLabel.
export function newWindowTargetBoxStyle(COLORS: ThemeColors): SerializedStyles {
  return css`
    border-width: 1.5px;
    border-style: dashed;
    border-color: ${COLORS.LABEL_L2_COLOR};
    border-radius: ${RADIUS.SQUARE};
    &[data-landing] {
      background-color: ${COLORS.HOVER_COLOR};
      border-style: solid;
    }
  `;
}

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
