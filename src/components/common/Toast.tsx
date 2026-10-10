import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { AppDispatch, RootState } from '../../redux/store';
import {
  selectReopenOfferForKey,
  toastsRemoved,
} from '../../redux/slices/globalStateSlice';
import { holdToasts, releaseToasts } from '../../redux/toastTimers';
import { reopenFromOffer } from '../../redux/reopenOffer';
import { showSession } from '../../redux/showSession';
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
  const { shown, refFor } = useToastStack(toasts, open);
  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );
  // KAN-349 Q1 C′. The hint names the key only while the key takes the offer.
  const keyOfferId = useSelector(selectReopenOfferForKey);

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
      setOpen(false);
      return;
    }
    if (hovered.current || focused.current) holdToasts();
  }, [toasts]);

  // Fixed at the corner the toast has always used, with no size of its own:
  // only the toasts take the pointer, so the page beside a narrow toast stays
  // clickable (a 300px toast under a wider offer).
  const regionStyle = css`
    position: fixed;
    bottom: 20px;
    ${isSettingsPage ? `right: 20px` : `left: 20px`};
    /* Over the menus (1000) and the tour's dim and mark (1010, 1020); under the drag card (1100). */
    z-index: 1050;
  `;

  const toastStyle = css`
    position: absolute;
    bottom: 0;
    ${isSettingsPage ? `right: 0` : `left: 0`};
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
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    width: 300px;
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
  const offerStyle = css`
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    width: max-content;
    min-width: 300px;
    max-width: min(30rem, calc(100vw - 40px));
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
  const reopenKeyHint = isMac
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
        if (offer === null && show === null) {
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
        // An offer or a Show: the message, and one chip at the right end.
        return (
          <div
            key={toast.id}
            ref={refFor(toast.id)}
            data-toast
            css={[toastStyle, offerStyle, leaving && leavingStyle]}
            aria-hidden={leaving || undefined}
          >
            <span css={messageStyle}>{message}</span>
            {offer !== null && (
              <Button
                variant="chip"
                iconType="undo"
                text={t('Reopen')}
                // The key does nothing on the settings page (MainContainer
                // stands down there), so the hint would name a dead key.
                keyHint={
                  isSettingsPage || keyOfferId !== offer.id
                    ? undefined
                    : reopenKeyHint
                }
                onClick={() => void dispatch(reopenFromOffer(offer.id))}
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
