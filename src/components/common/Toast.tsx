import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { AppDispatch, RootState } from '../../redux/store';
import {
  selectUndoKeyTarget,
  toastsRemoved,
} from '../../redux/slices/globalStateSlice';
import { holdToasts, releaseToasts } from '../../redux/toastTimers';
import { reopenFromOffer } from '../../redux/reopenOffer';
import { showSession } from '../../redux/showSession';
import { selectLiveStepOnTop } from '../../redux/slices/undoRedoSlice';
import { undoStep } from '../../redux/undoHistory';
import type { StepPress } from '../../redux/undoHistory';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';
import { CONTROL, RADIUS, TYPE } from '../../styles/scale';
import Button from './Button';
import {
  TOAST_FADE_REDUCED,
  TOAST_GAP_PX,
  TOAST_LEAVE_MS,
  TOAST_MOVE,
  useToastStack,
} from './useToastStack';
import { APP_WIDTH, SETTINGS_COLUMN } from '../../utils/constants/common';
import { isTabView } from '../../utils/functions/viewMode';

// KAN-583, KAN-694. A toast's Undo closes its own toast only; the other plain toasts stay up.
const LEAVES_PLAIN_TOASTS: StepPress = { closesPlainToasts: false };

// The stack's distance from the window's left and bottom edges.
const EDGE_PX = 20;

interface ToastProps {
  style?: string;
}

export const Toast: React.FC<ToastProps> = ({ style }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const toasts = useSelector((state: RootState) => state.globalState.toasts);
  // KAN-488. Open while held: the pointer on the stack or focus in it.
  const [open, setOpen] = useState(false);
  // An empty stack takes the hover with it (the effect below), so it is not open either.
  if (toasts.length === 0 && open) setOpen(false);
  const { shown, refFor } = useToastStack(toasts, open);
  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );
  // KAN-574. On Settings a toast stays inside the category column, as far from its right edge as from the window's left.
  // Only plain toasts: opening Settings clears the stack, so no Reopen offer is ever drawn there.
  const settingsColumn = isTabView()
    ? `${SETTINGS_COLUMN.TAB_PX}px`
    : `calc(${APP_WIDTH} * ${SETTINGS_COLUMN.POPUP_PERCENT} / 100)`;
  const settingsCap = `calc(${settingsColumn} - ${2 * EDGE_PX}px)`;
  // KAN-349 Q1 C′, KAN-744 R16-R17. A chip names the key only while the key
  // would do what the chip does: not while ⌘Z would take a Reopen offer shown
  // since, nor on Settings, where the key does nothing (MainContainer stands
  // down there).
  const keyTarget = useSelector(selectUndoKeyTarget, shallowEqual);
  const keyTakesOffer = (offerId: number) =>
    !isSettingsPage &&
    keyTarget?.kind === 'offer' &&
    keyTarget.offerId === offerId;
  const keyTakesStep = !isSettingsPage && keyTarget?.kind === 'step';
  // KAN-694, KAN-744 R16. A sort toast offers Undo only while its sort is the step on top.
  const liveStepOnTopId = useSelector(
    (state: RootState) => selectLiveStepOnTop(state)?.id ?? null
  );

  // KAN-349 T3 (from KAN-280 O8a). The pointer over any toast, or focus in
  // one, holds them all: held while either is true, released only when both
  // have gone -- a pointer leaving a focused Reopen button must not restart
  // the timers. Each toast's hit area reaches over the gap above it, so the
  // pointer crossing from one toast to the next never leaves the stack.
  const hovered = useRef(false);
  const focused = useRef(false);
  const setHold = (next: { hovered?: boolean; focused?: boolean }) => {
    const wasHeld = hovered.current || focused.current;
    hovered.current = next.hovered ?? hovered.current;
    focused.current = next.focused ?? focused.current;
    const isHeld = hovered.current || focused.current;
    if (!wasHeld && isHeld) holdToasts();
    if (wasHeld && !isHeld) releaseToasts();
    setOpen(isHeld);
  };
  // After every change to the list: an empty stack takes the hold with it
  // (the timers start the next toast unheld), and a toast arriving while the
  // pointer or focus is on the stack is held with the rest (an offer
  // replacing the only toast restarts the timers unheld). Focus in a toast
  // that leaves is given up by useToastStack.
  useLayoutEffect(() => {
    if (toasts.length === 0) {
      hovered.current = false;
      focused.current = false;
      return;
    }
    if (hovered.current || focused.current) holdToasts();
  }, [toasts]);

  // Fixed at the bottom-left on every page (KAN-574), with no size of its own:
  // only the toasts take the pointer, so the page beside a narrow toast stays
  // clickable (a 300px toast under a wider offer).
  const regionStyle = css`
    position: fixed;
    bottom: ${EDGE_PX}px;
    left: ${EDGE_PX}px;
    /* Over the menus (1000) and the tour's dim and mark (1010, 1020); under the drag card (1100). */
    z-index: 1050;
  `;

  const toastStyle = css`
    position: absolute;
    bottom: 0;
    left: 0;
    /* The gap above a toast is part of it for the pointer, so crossing from
       one toast to the next stays on the stack and keeps the hold. */
    [data-toast] + &::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: 100%;
      height: ${TOAST_GAP_PX}px;
    }
    transition:
      transform ${TOAST_MOVE},
      opacity ${TOAST_MOVE};
    /* KAN-488. Collapsed, an older toast narrows toward the newest's bottom edge, and shows only its edge. */
    transform-origin: bottom center;
    & > * {
      transition: opacity ${TOAST_LEAVE_MS}ms;
    }
    [data-stack='collapsed'] &:not([data-depth='0']) > * {
      opacity: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      transition: opacity ${TOAST_FADE_REDUCED};
    }
    /* KAN-487. The card, not the list's own colour, lifted by the floating
       shadow: the Reopen chip's fill is tuned on this card (chipContrast). */
    background-color: ${COLORS.SECONDARY_COLOR};
    box-shadow: ${COLORS.FLOATING_SHADOW};
    color: ${COLORS.TEXT_COLOR};
    padding: 10px;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    /* KAN-401. The popup sets this for every element; the export page does not. */
    box-sizing: border-box;
    width: ${isSettingsPage ? `min(300px, ${settingsCap})` : '300px'};
    min-height: ${CONTROL.DEFAULT};
    display: flex;
    justify-content: center;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    align-items: center;
    user-select: none;
    ${style && style}
  `;

  // The message on the left, Reopen at the right end (KAN-280 O8a). At 300px
  // the count was cut off in most locales, so the toast is as wide as its one
  // line, up to 30rem, growing away from the edge it is anchored to (O8b).
  // Past that the message ellipses rather than pushing the button out. The
  // cap is in rem because Chrome's Font size setting scales the text, so a
  // px cap cut the count at "Large" (KAN-312).
  const chipRowStyle = css`
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 12px;
  `;
  const growStyle = css`
    width: max-content;
    min-width: 300px;
    max-width: min(30rem, calc(100vw - ${2 * EDGE_PX}px));
  `;
  const chipStyle = `
    height: 34px;
    padding: 0 14px;
    flex-shrink: 0;
  `;
  const leavingStyle = css`
    pointer-events: none;
    transition-duration: ${TOAST_LEAVE_MS}ms;
    @media (prefers-reduced-motion: reduce) {
      transition-duration: ${TOAST_LEAVE_MS}ms;
    }
  `;
  const messageStyle = css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;

  // KAN-311 (O8c). ⌘Z on a Mac, Ctrl+Z anywhere else, as MainContainer's
  // key handler takes it. Read once; until Chrome answers, and if it never
  // does, the Ctrl form shows: most keyboards have no ⌘.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    let live = true;
    chrome.runtime
      .getPlatformInfo()
      .then((info) => {
        if (live) setIsMac(info.os === 'mac');
      })
      .catch((error: unknown) => {
        console.warn('Could not read the platform: ', error);
      });
    return () => {
      live = false;
    };
  }, []);
  const undoKeyHint = isMac
    ? { text: '⌘Z', ariaKeyShortcuts: 'Meta+Z' }
    : { text: `${t('Ctrl')}+Z`, ariaKeyShortcuts: 'Control+Z' };

  // Always mounted, empty while no toast shows (KAN-280 O8a): a screen reader
  // announces changes to a live region it already knows, and a region
  // inserted together with its text is often read out by none of them. Each
  // toast is announced as it is added; a leaving one is hidden from screen
  // readers and the pointer while it fades.
  return (
    <div
      role="status"
      // role="status" is atomic by default, so each new toast would make a
      // screen reader read out the whole stack again. Each is its own
      // message (KAN-349 A).
      aria-atomic="false"
      data-stack={open ? 'open' : 'collapsed'}
      css={regionStyle}
      onMouseEnter={() => setHold({ hovered: true })}
      onMouseLeave={() => setHold({ hovered: false })}
      onFocus={() => setHold({ focused: true })}
      onBlur={(event) => {
        // Focus moving between controls inside the stack is not leaving.
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setHold({ focused: false });
      }}
    >
      {shown.map(({ toast, leaving }) => {
        // The text is a key and params its interpolation values (KAN-86).
        // t() with no matching key returns the key unchanged, which is what
        // keeps a raw platform error -- a JSON SyntaxError naming its
        // offending token -- readable when it is passed through as a
        // {{detail}} value.
        const message = t(toast.text, toast.params);
        const offer = toast.reopenOffer;
        const show = toast.show;
        const offersSortUndo =
          toast.liveStepId !== null && toast.liveStepId === liveStepOnTopId;
        const offersAnyUndo = toast.offersUndo || offersSortUndo;
        if (offer === null && show === null && !offersAnyUndo) {
          return (
            <div
              key={toast.id}
              ref={refFor(toast.id)}
              data-toast
              css={[toastStyle, leaving && leavingStyle]}
              aria-hidden={leaving || undefined}
            >
              <span>{message}</span>
            </div>
          );
        }
        // An offer, a Show or an Undo: the message, and one chip at the right end.
        // KAN-583 W2. Undo keeps the plain toast's width and wraps its message:
        // grown, Replace's crossed the popup's divider and was cut off in French.
        return (
          <div
            key={toast.id}
            ref={refFor(toast.id)}
            data-toast
            css={[
              toastStyle,
              chipRowStyle,
              !offersAnyUndo && growStyle,
              leaving && leavingStyle,
            ]}
            aria-hidden={leaving || undefined}
          >
            <span css={offersAnyUndo ? undefined : messageStyle}>
              {message}
            </span>
            {offer !== null && (
              <Button
                variant="chip"
                iconType="undo"
                text={t('Reopen')}
                keyHint={keyTakesOffer(offer.id) ? undoKeyHint : undefined}
                onClick={() => void dispatch(reopenFromOffer(offer.id))}
                style={chipStyle}
              />
            )}
            {toast.offersUndo && (
              <Button
                variant="chip"
                iconType="undo"
                text={t('Undo')}
                keyHint={keyTakesStep ? undoKeyHint : undefined}
                // Shown only while its step is the newest; the undo reducer closes this toast (globalStateSlice).
                onClick={() => void dispatch(undoStep(LEAVES_PLAIN_TOASTS))}
                style={chipStyle}
              />
            )}
            {offersSortUndo && (
              <Button
                variant="chip"
                iconType="undo"
                text={t('Undo')}
                keyHint={keyTakesStep ? undoKeyHint : undefined}
                // Shown only while its sort is the newest step, so this undoes the sort, then closes this toast; a press ignored while another step runs (R19) leaves it.
                onClick={() =>
                  void dispatch(undoStep(LEAVES_PLAIN_TOASTS)).then((run) => {
                    if (
                      undoStep.fulfilled.match(run) &&
                      run.payload !== 'busy'
                    ) {
                      dispatch(toastsRemoved([toast.id]));
                    }
                  })
                }
                style={chipStyle}
              />
            )}
            {show !== null && (
              <Button
                variant="chip"
                text={t('Show')}
                // Show, then close: a session gone by now shows nothing, and
                // the toast closes all the same.
                onClick={() => {
                  dispatch(showSession(show.tabGroupId));
                  dispatch(toastsRemoved([toast.id]));
                }}
                style={chipStyle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
