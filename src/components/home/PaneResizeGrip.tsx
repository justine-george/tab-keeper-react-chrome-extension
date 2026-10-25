import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { useDispatch } from 'react-redux';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../hooks/useThemeColors';
import { DURATION } from '../../styles/scale';
import { whileKeyNav } from '../common/focusRing';
import {
  setListWidth,
  setOpenNowWidth,
} from '../../redux/slices/settingsDataStateSlice';
import { AppDispatch } from '../../redux/store';
import { RESIZE_KEY_STEP, clampToRange, type WidthRange } from './paneWidths';

// Which pane the grip resizes, and so which line it sits on.
export type ResizablePane = 'list' | 'openNow';

interface PaneResizeGripProps {
  pane: ResizablePane;
  // What to draw and report as aria-valuenow: the drag's live width, or the
  // resting width when none is running. MainContainer computes it once
  // (paneWidths.ts) -- the same number it writes to the grid -- so the grip
  // and the grid can never disagree.
  drawnWidth: number;
  // The width from the stored choices alone: a press starts from here, and
  // so does an arrow key.
  restingWidth: number;
  // This window's range for the pane, beside the other pane as drawn.
  range: WidthRange;
  // Reports each width the drag shows, and null when the drag ends. Keep it
  // stable (a state setter): a new function re-binds the drag's listeners.
  onLiveWidth: (width: number | null) => void;
}

// Where a pointer drag started, and the width it shows now.
interface Drag {
  startX: number;
  startWidth: number;
  width: number;
}

// The list's grip is on its right edge, so dragging right widens it; Open
// now's is on its left edge, so dragging left does (KAN-321 O1a, KAN-687).
const WIDENS = { list: 1, openNow: -1 } as const;
const WIDEN_KEY = { list: 'ArrowRight', openNow: 'ArrowLeft' } as const;
const NARROW_KEY = { list: 'ArrowLeft', openNow: 'ArrowRight' } as const;
const SAVE = { list: setListWidth, openNow: setOpenNowWidth } as const;

// KAN-321 O1a and KAN-687. A grip on the line beside a pane: the list's
// right edge, or Open now's left edge. A pointer drag resizes the pane live
// and saves once, on release; the arrow keys save after each press; a
// double-click resets to the default (null). MainContainer renders it only
// in the tab view, outside Settings, where the window leaves a range
// (paneWidths.ts), as a grid item of its own beside the panes -- so a press
// here is inside no RowDragArea list and can never start a row drag. A
// window narrowed past that mid-drag unmounts it, which ends the drag like a
// cancel (the effect's cleanup below).
export default function PaneResizeGrip({
  pane,
  drawnWidth,
  restingWidth,
  range,
  onLiveWidth,
}: PaneResizeGripProps) {
  const { t } = useTranslation();
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  // Read at each move: a window resized mid-drag re-renders with its range.
  const rangeNow = useRef(range);
  useLayoutEffect(() => {
    rangeNow.current = range;
  }, [range]);

  const drag = useRef<Drag | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // The drag's listeners live on `window` (RowDragArea's pattern, no pointer
  // capture), from the press until the drag ends. Every way it ends -- the
  // release, pointercancel, Escape, the window losing focus, or this grip
  // unmounting mid-drag -- runs the same cleanup: listeners off, the root
  // flag off, the live width handed back. Only the release saves (O1a:
  // "saved on release"). pointercancel, the window losing focus and Escape
  // end the drag WITHOUT saving, and the pane goes back to its width from
  // before the press.
  useEffect(() => {
    if (!isResizing) return;
    const root = document.documentElement;
    root.setAttribute('data-resizing', '');

    const end = (save: boolean) => {
      const ended = drag.current;
      drag.current = null;
      onLiveWidth(null);
      setIsResizing(false);
      // A press and release that did not move saves nothing, so the two
      // presses of a double-click leave no width behind its reset.
      if (save && ended !== null && ended.width !== ended.startWidth) {
        dispatch(SAVE[pane](ended.width));
      }
    };

    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      current.width = clampToRange(
        current.startWidth + WIDENS[pane] * (event.clientX - current.startX),
        rangeNow.current
      );
      onLiveWidth(current.width);
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Consumed here, so Chrome must not also close the popup.
      event.preventDefault();
      end(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
      root.removeAttribute('data-resizing');
      // Also on an unmount mid-drag, which reaches no end(): the grid must
      // not keep a width nobody is dragging.
      onLiveWidth(null);
    };
  }, [isResizing, dispatch, onLiveWidth, pane]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // No text selection starts under the press.
    event.preventDefault();
    drag.current = {
      startX: event.clientX,
      startWidth: restingWidth,
      width: restingWidth,
    };
    setIsResizing(true);
  };

  // The key toward the pane's far edge widens it. A press at a limit
  // changes nothing, so it saves nothing: at a window's clamped max, saving
  // the shown width would overwrite the stored one, and widening the window
  // would no longer bring it back (O1a, "the stored width is kept"). The key
  // is taken either way.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let step: number;
    if (event.key === WIDEN_KEY[pane]) step = RESIZE_KEY_STEP;
    else if (event.key === NARROW_KEY[pane]) step = -RESIZE_KEY_STEP;
    else return;
    event.preventDefault();
    const next = clampToRange(restingWidth + step, range);
    if (next !== restingWidth) dispatch(SAVE[pane](next));
  };

  const onDoubleClick = () => {
    dispatch(SAVE[pane](null));
  };

  // KAN-747. Fills the 8px gap between the panes and 2px past each side,
  // so it never reaches the boxes inside them.
  const placement =
    pane === 'list'
      ? css`
          grid-area: sessions;
          justify-self: end;
          margin-right: -2px;
        `
      : css`
          grid-area: active-session;
          justify-self: start;
          margin-left: -2px;
        `;

  const gripStyle = css`
    width: 12px;
    height: 100vh;
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    /* The ring goes round the dots below, not this full-height strip. */
    outline: none;
    touch-action: none;

    /* KAN-790. Three dots, not KAN-747's pill, which read as the scrollbar
       beside it. LABEL_L3, the lightest grey still 3:1 on the pane; 1.15x and
       in the text colour while in use. Painted in currentColor, so the colour
       transition still runs. */
    & > span {
      width: 4px;
      height: 20px;
      color: ${COLORS.LABEL_L3_COLOR};
      background-image: radial-gradient(
        circle,
        currentColor 1.6px,
        transparent 2px
      );
      background-size: 4px 7px;
      background-position: center 0;
      /* Grown by transform, not height: a height that animates re-lays out
         the page each frame, and the toast stack's hover flickered with it. */
      transition:
        transform ${DURATION.MOVE},
        color ${DURATION.COLOR};
      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }

    &:hover,
    ${whileKeyNav('&:focus-visible')}, &[data-active] {
      & > span {
        transform: scale(1.15);
        color: ${COLORS.TEXT_COLOR};
      }
    }
    /* The app's ring (dialogButtons.ts): 2px of TEXT_COLOR. */
    ${whileKeyNav('&:focus-visible > span')} {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: 1px;
    }
    /* A row drag passing over the grip does not light it (O1a isolation).
       The cursor already stays grabbing: [data-dragging] * in App.css.
       html, not :root: Emotion reads a selector that starts with a colon as
       one on this element, and wrote ".css-x:root[data-dragging] .css-x",
       which matches nothing. */
    html[data-dragging] &:hover {
      & > span {
        transform: none;
        color: ${COLORS.LABEL_L3_COLOR};
      }
    }
  `;

  return (
    <div
      css={[placement, gripStyle]}
      // Open now's marker predates the list's grip: the tour and its specs
      // find Open now's grip by it.
      data-resize-grip={pane === 'openNow' ? '' : undefined}
      data-list-resize-grip={pane === 'list' ? '' : undefined}
      data-active={isResizing ? '' : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={
        pane === 'list'
          ? t('Resize the saved sessions list')
          : t('Resize Open now')
      }
      aria-valuenow={drawnWidth}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      <span />
    </div>
  );
}
