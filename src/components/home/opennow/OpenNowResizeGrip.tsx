import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../../hooks/useThemeColors';
import { RADIUS } from '../../../styles/scale';
import { useViewportWidth } from '../../../hooks/useViewportWidth';
import { setOpenNowWidth } from '../../../redux/slices/settingsDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  OPEN_NOW_KEY_STEP,
  clampOpenNowWidth,
  openNowWidthLimits,
  shownOpenNowWidth,
} from './openNowWidth';

interface OpenNowResizeGripProps {
  // The width a drag in flight is showing, or null when there is none.
  // MainContainer holds it, because it draws the grid track from it.
  liveWidth: number | null;
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

// KAN-321 O1a. The grip on the line between the saved session and Open now.
// A pointer drag resizes Open now live and saves once, on release; the arrow
// keys save after each press; a double-click resets to the default (null).
// MainContainer renders it only side by side (tab view, not Settings, not
// folded, not the rail), as a grid item of its own beside the panes -- so a
// press here is inside no RowDragArea list and can never start a row drag.
export default function OpenNowResizeGrip({
  liveWidth,
  onLiveWidth,
}: OpenNowResizeGripProps) {
  const { t } = useTranslation();
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const storedWidth = useSelector(
    (state: RootState) => state.settingsDataState.openNowWidth
  );
  const viewportWidth = useViewportWidth();
  const shownWidth = shownOpenNowWidth(storedWidth, viewportWidth);
  // What the track is drawn at (MainContainer computes it the same way): a
  // drag's live width clamped to this window too, so a window that narrows
  // mid-drag is heard at its new limit before the next move.
  const drawnWidth = shownOpenNowWidth(liveWidth ?? storedWidth, viewportWidth);
  const { min, max } = openNowWidthLimits(viewportWidth);

  const drag = useRef<Drag | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // The drag's listeners live on `window` (RowDragArea's pattern, no pointer
  // capture), from the press until the drag ends. Every way it ends -- the
  // release, pointercancel, Escape, the window losing focus, or this grip
  // unmounting mid-drag -- runs the same cleanup: listeners off, the root
  // flag off, the live width handed back. Only the release saves (O1a:
  // "saved on release"). pointercancel, the window losing focus and Escape
  // end the drag WITHOUT saving, and Open now goes back to its width from
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
        dispatch(setOpenNowWidth(ended.width));
      }
    };

    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      // Dragging LEFT widens Open now: its left edge is the line. The limits
      // are read at the move, from the width useViewportWidth reports too.
      current.width = clampOpenNowWidth(
        current.startWidth + (current.startX - event.clientX),
        window.innerWidth
      );
      onLiveWidth(current.width);
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end(false);
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
  }, [isResizing, dispatch, onLiveWidth]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // No text selection starts under the press.
    event.preventDefault();
    drag.current = {
      startX: event.clientX,
      startWidth: shownWidth,
      width: shownWidth,
    };
    setIsResizing(true);
  };

  // ← widens Open now, → narrows it. A press at a limit changes nothing, so
  // it saves nothing: at a window's clamped max, saving the shown width would
  // overwrite the stored one, and widening the window would no longer bring
  // it back (O1a, "the stored width is kept"). The key is taken either way.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let step: number;
    if (event.key === 'ArrowLeft') step = OPEN_NOW_KEY_STEP;
    else if (event.key === 'ArrowRight') step = -OPEN_NOW_KEY_STEP;
    else return;
    event.preventDefault();
    const next = clampOpenNowWidth(shownWidth + step, viewportWidth);
    if (next !== shownWidth) dispatch(setOpenNowWidth(next));
  };

  const onDoubleClick = () => {
    dispatch(setOpenNowWidth(null));
  };

  // Straddles the line at Open now's left edge: 6px into each pane's 8px
  // padding, so it never reaches the boxes inside them.
  const gripStyle = css`
    grid-area: active-session;
    justify-self: start;
    width: 12px;
    margin-left: -6px;
    height: 100vh;
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    /* The ring goes round the chip below, not this full-height strip. */
    outline: none;
    touch-action: none;

    & > span {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 6px 2px;
      /* Square, as every corner here is (styles/scale.ts). */
      border-radius: ${RADIUS.SQUARE};
      background-color: ${COLORS.PRIMARY_COLOR};
    }
    & > span > span {
      width: 4px;
      height: 4px;
      border-radius: ${RADIUS.CIRCLE};
      background-color: ${COLORS.LABEL_L2_COLOR};
    }

    &:hover,
    &:focus-visible,
    &[data-active] {
      & > span {
        background-color: ${COLORS.HOVER_COLOR};
      }
      & > span > span {
        background-color: ${COLORS.TEXT_COLOR};
      }
    }
    /* The app's ring (dialogButtons.ts): 2px of TEXT_COLOR. */
    &:focus-visible > span {
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
        background-color: ${COLORS.PRIMARY_COLOR};
      }
      & > span > span {
        background-color: ${COLORS.LABEL_L2_COLOR};
      }
    }
  `;

  return (
    <div
      css={gripStyle}
      data-resize-grip=""
      data-active={isResizing ? '' : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize Open now')}
      aria-valuenow={drawnWidth}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      <span>
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
