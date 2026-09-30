import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { AppDispatch, RootState } from '../../redux/store';
import { selectReopenOfferForKey } from '../../redux/slices/globalStateSlice';
import { holdToasts, releaseToasts } from '../../redux/toastTimers';
import { reopenFromOffer } from '../../redux/reopenOffer';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';
import { CONTROL, RADIUS, TYPE } from '../../styles/scale';
import Button from './Button';
import {
  TOAST_FADE_REDUCED,
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
  const { shown, regionRef, refFor } = useToastStack(toasts);
  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );
  // KAN-349 Q1 C′. The hint names the key only while the key takes the offer.
  const keyOfferId = useSelector(selectReopenOfferForKey);

  // KAN-349 T3 (from KAN-280 O8a). The pointer over any toast, or focus in
  // one, holds them all: held while either is true, released only when both
  // have gone -- a pointer leaving a focused Reopen button must not restart
  // the timers. The region is sized to cover the stack, gaps included, so the
  // pointer crossing from one toast to the next never leaves it.
  const hovered = useRef(false);
  const focused = useRef(false);
  const setHold = (next: { hovered?: boolean; focused?: boolean }) => {
    const wasHeld = hovered.current || focused.current;
    hovered.current = next.hovered ?? hovered.current;
    focused.current = next.focused ?? focused.current;
    const isHeld = hovered.current || focused.current;
    if (!wasHeld && isHeld) holdToasts();
    if (wasHeld && !isHeld) releaseToasts();
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

  // Fixed at the corner the toast has always used; its height and width are
  // set by useToastStack to cover the stack.
  const regionStyle = css`
    position: fixed;
    bottom: 20px;
    ${isSettingsPage ? `right: 20px` : `left: 20px`};
    z-index: 1000;
  `;

  const toastStyle = css`
    position: absolute;
    bottom: 0;
    ${isSettingsPage ? `right: 0` : `left: 0`};
    transition:
      transform ${TOAST_MOVE},
      opacity ${TOAST_MOVE};
    @media (prefers-reduced-motion: reduce) {
      transition: opacity ${TOAST_FADE_REDUCED};
    }
    background-color: ${COLORS.PRIMARY_COLOR};
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
      ref={regionRef}
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
        return offer === null ? (
          <div
            key={toast.id}
            ref={refFor(toast.id)}
            css={[toastStyle, leaving && leavingStyle]}
            aria-hidden={leaving || undefined}
          >
            {message}
          </div>
        ) : (
          <div
            key={toast.id}
            ref={refFor(toast.id)}
            css={[toastStyle, offerStyle, leaving && leavingStyle]}
            aria-hidden={leaving || undefined}
          >
            <span css={messageStyle}>{message}</span>
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
              style={`
                height: 34px;
                padding: 0 14px;
                flex-shrink: 0;
              `}
            />
          </div>
        );
      })}
    </div>
  );
};
