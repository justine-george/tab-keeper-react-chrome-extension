import React from 'react';
import { css } from '@emotion/react';

import { useThemeColors } from '../../../../hooks/useThemeColors';
import { DURATION, ICON } from '../../../../styles/scale';
import { useRowDragHandle } from './dragContext';

// KAN-701, his pick A. Six dots on the row under the pointer, where its drag
// can start, so a row says it drags. Inside the row they are a picture and
// take no pointer; outside its box they take it for the row (KAN-703).
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

// The glyph as generated content, so the row's text stays its own: a
// ligature's name in the DOM is text, read by find in page and by anything
// that reads the row's text.
const Dots: React.FC = () => {
  const COLORS = useThemeColors();
  return (
    <span
      className="material-symbols-outlined"
      css={css`
        font-size: ${ICON.SMALL};
        color: ${COLORS.TEXT_COLOR};
        &::before {
          content: 'drag_indicator';
        }
      `}
    />
  );
};

interface DragHandleProps {
  rowId: string;
  // The list the row's DraggableRow joins, as it names it.
  scope?: string;
}

/** The handle in the column left of a row: `left` from the row's own edge. */
export const DragHandle: React.FC<
  DragHandleProps & {
    left: string;
    // Placed outside the row's box (a tab or group row's indent column).
    // The dots then take the pointer: pointed at, the row stays hovered;
    // pressed, the press reaches the row's DraggableRow as any press in the
    // row does. A click there is no row's, so it does nothing (KAN-703).
    outsideRow?: boolean;
  }
> = ({ rowId, scope, left, outsideRow = false }) => {
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
        ${
          outsideRow
            ? `cursor: grab; &:active { cursor: grabbing; }`
            : 'pointer-events: none;'
        }
        opacity: 0;
        ${FADE}
        ${shownWhen('{ opacity: 1; }')}
      `}
    >
      <Dots />
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
        <Dots />
      </span>
    </span>
  );
};
