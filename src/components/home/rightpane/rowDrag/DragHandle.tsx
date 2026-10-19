import React from 'react';
import { css } from '@emotion/react';

import Icon from '../../../common/Icon';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { DURATION, ICON } from '../../../../styles/scale';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../../utils/constants/common';
import { useRowDragHandle } from './dragContext';

// KAN-701, his pick A. Six dots on the row under the pointer, where its drag
// can start, so a row says it drags. A picture only: it takes no pointer,
// and the row's own hit areas, cursor and drag are unchanged.
//
// The row that owns the hover carries `data-drag-handle-row`. Shown while
// that row is hovered and nothing is dragged, and on the held row until its
// release, hovered or not: it follows the pointer only up and down, so a
// pointer that leaves its pane sideways leaves it. The held row's hover
// bridges the frames between the drag's start and the render that marks it
// held, measured as one to three. Never on keyboard focus: there is no
// keyboard drag.
const shownWhen = (rule: string) => `
  html:not([data-dragging]) [data-drag-handle-row]:hover & ${rule}
  [data-drag-held] [data-drag-handle-row]:hover & ${rule}
  &[data-held] ${rule}
`;

// The action strips' fade (KAN-100); none under reduced motion.
const FADE = `
  @media (prefers-reduced-motion: no-preference) {
    transition: opacity ${DURATION.COLOR} ease-out;
  }
`;

const GLYPH_STYLE = `${NON_INTERACTIVE_ICON_STYLE} padding: 0;`;

interface DragHandleProps {
  rowId: string;
  // The list the row's DraggableRow joins, as it names it.
  scope?: string;
}

/** The handle in the column left of a row: `left` from the row's own edge. */
export const DragHandle: React.FC<DragHandleProps & { left: string }> = ({
  rowId,
  scope,
  left,
}) => {
  const COLORS = useThemeColors();
  const { canDrag, held } = useRowDragHandle(rowId, scope);
  if (!canDrag) return null;
  return (
    <span
      aria-hidden="true"
      data-drag-handle=""
      data-held={held ? '' : undefined}
      css={css`
        position: absolute;
        top: 50%;
        left: ${left};
        translate: 0 -50%;
        display: flex;
        pointer-events: none;
        opacity: 0;
        ${FADE}
        ${shownWhen('{ opacity: 1; }')}
      `}
    >
      <Icon
        type="drag_indicator"
        size={ICON.SMALL}
        color={COLORS.TEXT_COLOR}
        style={GLYPH_STYLE}
      />
    </span>
  );
};

/**
 * The handle drawn over a row's own glyph, which it replaces while shown: a
 * window's web_asset. Just the glyph where the row cannot be dragged.
 */
export const DragHandleSwap: React.FC<
  DragHandleProps & { children: React.ReactNode }
> = ({ rowId, scope, children }) => {
  const COLORS = useThemeColors();
  const { canDrag, held } = useRowDragHandle(rowId, scope);
  if (!canDrag) return <>{children}</>;
  return (
    <span
      data-held={held ? '' : undefined}
      css={css`
        position: relative;
        display: flex;
        & > * {
          ${FADE}
        }
        & > [data-drag-handle] {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          opacity: 0;
        }
        ${shownWhen('> [data-drag-handle] { opacity: 1; }')}
        ${shownWhen('> :not([data-drag-handle]) { opacity: 0; }')}
      `}
    >
      {children}
      <span aria-hidden="true" data-drag-handle="">
        <Icon
          type="drag_indicator"
          size={ICON.SMALL}
          color={COLORS.TEXT_COLOR}
          style={GLYPH_STYLE}
        />
      </span>
    </span>
  );
};
