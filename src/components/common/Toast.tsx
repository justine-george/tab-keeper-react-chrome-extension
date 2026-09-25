import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { AppDispatch, RootState } from '../../redux/store';
import { holdToast, releaseToast } from '../../redux/slices/globalStateSlice';
import { reopenFromOffer } from '../../redux/reopenOffer';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';
import { CONTROL, RADIUS, TYPE } from '../../styles/scale';
import Button from './Button';

interface ToastProps {
  style?: string;
}

export const Toast: React.FC<ToastProps> = ({ style }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const toastText = useSelector(
    (state: RootState) => state.globalState.toastText
  );
  const toastParams = useSelector(
    (state: RootState) => state.globalState.toastParams
  );
  const isToastOpen = useSelector(
    (state: RootState) => state.globalState.isToastOpen
  );
  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );
  const offerId = useSelector(
    (state: RootState) => state.globalState.toastReopenOfferId
  );

  // KAN-280 O8a. The Reopen toast holds while the pointer is over it OR focus
  // is in it, so it is held while either is true and released only when both
  // have gone -- a pointer leaving a focused Reopen button must not restart
  // the timer.
  const hovered = useRef(false);
  const focused = useRef(false);
  const setHold = (next: { hovered?: boolean; focused?: boolean }) => {
    const wasHeld = hovered.current || focused.current;
    hovered.current = next.hovered ?? hovered.current;
    focused.current = next.focused ?? focused.current;
    const isHeld = hovered.current || focused.current;
    if (!wasHeld && isHeld) dispatch(holdToast());
    if (wasHeld && !isHeld) dispatch(releaseToast());
  };
  // The slice starts every toast unheld. A toast that closes, or turns plain,
  // takes the hold with it; a new offer arriving under the pointer or focus
  // (each close replaces the toast, rule 3) is held again.
  useEffect(() => {
    if (!isToastOpen || offerId === null) {
      hovered.current = false;
      focused.current = false;
      return;
    }
    if (hovered.current || focused.current) dispatch(holdToast());
  }, [isToastOpen, offerId, dispatch]);

  const toastStyle = css`
    position: fixed;
    bottom: 20px;
    ${isSettingsPage ? `right: 20px` : `left: 20px`};
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.TEXT_COLOR};
    padding: 10px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    z-index: 1000;
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
  // line, up to 460px, growing away from the edge it is anchored to (O8b).
  // Past that the message ellipses rather than pushing the button out.
  const offerStyle = css`
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    width: max-content;
    min-width: 300px;
    max-width: min(460px, calc(100vw - 40px));
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

  // toastText is a key and toastParams its interpolation values (KAN-86).
  // t() with no matching key returns the key unchanged, which is what keeps a
  // raw platform error -- a JSON SyntaxError naming its offending token --
  // readable when it is passed through as a {{detail}} value.
  const message = t(toastText, toastParams);

  // Always mounted, empty while no toast shows (KAN-280 O8a): a screen reader
  // announces changes to a live region it already knows, and a region
  // inserted together with its text is often read out by none of them.
  return (
    <div role="status">
      {isToastOpen &&
        (offerId === null ? (
          <div css={toastStyle}>{message}</div>
        ) : (
          <div
            css={[toastStyle, offerStyle]}
            onMouseEnter={() => setHold({ hovered: true })}
            onMouseLeave={() => setHold({ hovered: false })}
            onFocus={() => setHold({ focused: true })}
            onBlur={(event) => {
              // Focus moving between controls inside the toast is not leaving.
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              )
                return;
              setHold({ focused: false });
            }}
          >
            <span css={messageStyle}>{message}</span>
            <Button
              variant="chip"
              iconType="undo"
              text={t('Reopen')}
              // The key does nothing on the settings page (MainContainer
              // stands down there), so the hint would name a dead key.
              keyHint={isSettingsPage ? undefined : reopenKeyHint}
              onClick={() => void dispatch(reopenFromOffer(offerId))}
              style={`
                height: 34px;
                padding: 0 14px;
                flex-shrink: 0;
              `}
            />
          </div>
        ))}
    </div>
  );
};
