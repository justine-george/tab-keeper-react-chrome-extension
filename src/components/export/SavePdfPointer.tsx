import { css } from '@emotion/react';
import { useLayoutEffect, useState } from 'react';

import { useThemeColors } from '../../hooks/useThemeColors';
import {
  savePdfPointerPaths,
  type ButtonBox,
  type SheetBox,
} from './savePdfPointerPaths';

interface Placed {
  button: ButtonBox;
  sheet: SheetBox;
  viewportRight: number;
}

// In document coordinates, so a scrolled page keeps the tip on the button.
const place = (button: HTMLElement, sheet: HTMLElement): Placed => {
  const b = button.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  return {
    button: {
      left: b.left + scrollX,
      width: b.width,
      bottom: b.bottom + scrollY,
    },
    sheet: { right: s.right + scrollX, top: s.top + scrollY },
    viewportRight: innerWidth + scrollX,
  };
};

/**
 * KAN-826. Points from beside the preview sheet at Save as PDF…. Measured
 * from both elements' real boxes, again whenever either changes size or the
 * window does. Static and inert: no motion, no pointer events, hidden from
 * assistive tech, which reaches the button by its name.
 */
export default function SavePdfPointer({
  button,
  sheet,
}: {
  button: HTMLElement | null;
  sheet: HTMLElement | null;
}) {
  const COLORS = useThemeColors();
  const [placed, setPlaced] = useState<Placed | null>(null);

  useLayoutEffect(() => {
    if (!button || !sheet) return;
    const measure = () => setPlaced(place(button, sheet));
    measure();
    addEventListener('resize', measure);
    // As SlidingPair: jsdom has none.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(button);
    observer?.observe(sheet);
    return () => {
      observer?.disconnect();
      removeEventListener('resize', measure);
    };
  }, [button, sheet]);

  const paths =
    button &&
    sheet &&
    placed &&
    savePdfPointerPaths(placed.button, placed.sheet, placed.viewportRight);
  if (!paths) return null;

  return (
    <svg
      data-save-pdf-pointer
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      css={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 1px;
        height: 1px;
        overflow: visible;
        pointer-events: none;
        color: ${COLORS.LABEL_L1_COLOR};
      `}
    >
      <path d={paths.line} />
      <path d={paths.head} />
    </svg>
  );
}
