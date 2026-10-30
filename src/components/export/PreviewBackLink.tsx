import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import AskCard from '../common/AskCard';
import ClickableRow from '../common/ClickableRow';
import { Glyph } from '../common/Glyph';
import TabKeeperMark from '../common/TabKeeperMark';
import { HEADER_BACK_TARGET } from '../common/headerBackTarget';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DURATION, EASE, TYPE } from '../../styles/scale';
import { requestReturnFromPreview } from '../../utils/functions/backFromPreview';
import type { PreviewFrom } from '../../utils/functions/previewFrom';

const ARROW_PX = 18;
const GAP_PX = 6;
// 816 sheet + 2 × (18 arrow + 6 gap + 8 air): the arrow hangs only where both margins hold it.
export const PREVIEW_BACK_HANG_MIN_PX = 880;
// The glyph's own left side bearing; pulled back so its ink, not its box, meets the edge.
const ARROW_BEARING_PX = 3;
// The worker closes this tab well before this; still open means the request failed silently.
export const RETRY_AFTER_MS = 2000;

interface PreviewBackLinkProps {
  from: PreviewFrom;
  // Edits would be lost (the page's beforeunload rule).
  pending: boolean;
  // Called right before the request, so the page can drop its beforeunload guard.
  onLeave: () => void;
  // The request failed or went unanswered: the page is still here, so it should guard itself again.
  onLeaveFailed: () => void;
}

/**
 * KAN-880. "← [floppy] Tab Keeper" on the preview: goes back to where the
 * preview came from. With edits pending a card asks first; ✕, Esc and a press
 * outside are Stay. Never touches the closes-this-tab flag.
 */
export default function PreviewBackLink({
  from,
  pending,
  onLeave,
  onLeaveFailed,
}: PreviewBackLinkProps) {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const linkRef = useRef<HTMLButtonElement>(null);
  const isSentRef = useRef(false);
  const retryTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(retryTimerRef.current), []);

  // Nothing left to lose: the card has nothing to ask.
  if (!pending && isOpen) setOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        anchorRef.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const failed = () => {
    isSentRef.current = false;
    onLeaveFailed();
  };

  // The first press wins until the request fails or the tab is still here after RETRY_AFTER_MS.
  const leave = () => {
    setOpen(false);
    if (isSentRef.current) return;
    isSentRef.current = true;
    onLeave();
    void requestReturnFromPreview(from).then((isSent) => {
      if (!isSent) failed();
      else retryTimerRef.current = window.setTimeout(failed, RETRY_AFTER_MS);
    });
  };

  const stay = () => {
    setOpen(false);
    linkRef.current?.focus();
  };

  const press = () => {
    if (pending) setOpen(true);
    else leave();
  };

  const linkStyle = `
    ${HEADER_BACK_TARGET}
    display: flex;
    align-items: center;
    gap: ${GAP_PX}px;
    color: ${COLORS.LABEL_L2_COLOR};
    font-size: ${TYPE.BODY};
    transition: color ${DURATION.COLOR};
    &:hover { color: ${COLORS.LABEL_L1_COLOR}; }
    &:active { color: ${COLORS.TEXT_COLOR}; }
    @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
      & .preview-back-arrow {
        transition: translate ${DURATION.MOVE} ${EASE.OUT};
      }
      &:hover .preview-back-arrow {
        translate: -5px;
        transition: translate ${DURATION.MOVE} ${EASE.OUT_BACK};
      }
    }
  `;

  return (
    <span
      ref={anchorRef}
      css={css`
        position: relative;
        display: inline-flex;
        @media (min-width: ${PREVIEW_BACK_HANG_MIN_PX}px) {
          margin-left: -${ARROW_PX + GAP_PX}px;
        }
      `}
    >
      <ClickableRow
        ariaLabel={t('Back to Tab Keeper')}
        tooltipText={t('Back to Tab Keeper')}
        onClick={press}
        style={linkStyle}
        buttonRef={linkRef}
      >
        <Glyph
          type="arrow_back"
          className="preview-back-arrow"
          glyphCss={css`
            font-size: ${ARROW_PX}px;
            width: ${ARROW_PX}px;
            height: ${ARROW_PX}px;
            margin-left: -${ARROW_BEARING_PX}px;
            @media (min-width: ${PREVIEW_BACK_HANG_MIN_PX}px) {
              margin-left: 0;
            }
          `}
        />
        <TabKeeperMark size="16px" />
        <span>{t('Tab Keeper')}</span>
      </ClickableRow>
      {isOpen && (
        <AskCard
          text={t(
            'Going back loses your edits. Save as PDF first to keep them.'
          )}
          quiet={{ label: t('Go back'), onPress: leave }}
          filled={{ label: t('Stay'), onPress: stay }}
          align="left"
          notchInset="16px"
          onCancel={stay}
        />
      )}
    </span>
  );
}
