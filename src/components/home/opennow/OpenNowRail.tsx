import { RefObject, useEffect, useId, useRef, useState } from 'react';

import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from '../../common/Icon';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { formatTabCount } from '../../../utils/functions/local';
import type { OpenWindow } from '../../../utils/functions/openNow';
import OpenNowPane from './OpenNowPane';
import type { OpenNowHeaderAction } from './OpenNowPane';

interface OpenNowRailProps {
  windows: OpenWindow[] | null;
  // The fold button, shown in the drawer's header before its close button.
  foldAction: OpenNowHeaderAction;
  // The rail's button. The caller holds it so an unfold that brings the rail
  // back can focus it (OpenNowColumn).
  buttonRef: RefObject<HTMLButtonElement>;
}

// KAN-280 O2. A 44px column with one button, which opens Open now as a 380px
// drawer over the right side. The drawer's open state lives here, so it goes
// when the rail does: a window grown past 1100px, or a fold, drops both.
export default function OpenNowRail({
  windows,
  foldAction,
  buttonRef,
}: OpenNowRailProps) {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const drawerId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // On open, focus goes to the drawer's heading, so a screen reader announces
  // where it landed and Tab continues into the drawer.
  useEffect(() => {
    if (isOpen) headingRef.current?.focus();
  }, [isOpen]);

  // Back to the button that opened it, so the user's place is kept.
  const close = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  // No count while the first read is in flight: "0 Tabs" would be false.
  const railLabel =
    windows === null
      ? t('Open now')
      : `${t('Open now')}, ${formatTabCount(
          windows.reduce((sum, w) => sum + w.tabs.length, 0),
          t
        )}`;

  const railStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    padding-top: 8px;
  `;

  // Sized and filled as an actionable Icon is (padding 4px round a 24px
  // glyph, hover and press fills), but a native button: it needs a ref for
  // focus to come back to, and aria-controls.
  const buttonStyle = css`
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    background-color: transparent;
    color: inherit;
    cursor: pointer;
    &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    &:active,
    &[aria-expanded='true'] {
      background-color: ${COLORS.ICON_ACTIVE_COLOR};
    }
  `;

  // z-index 900: over the panes, and under the toast (1000), which must stay
  // readable while the drawer is open. The modals are <dialog>s in the top
  // layer, above any z-index, so they need no room here.
  const drawerStyle = css`
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 380px;
    z-index: 900;
    overflow: hidden;
    background-color: ${COLORS.PRIMARY_COLOR};
    border-left: 1px solid ${COLORS.BORDER_COLOR};
    box-shadow: ${COLORS.FLOATING_SHADOW};
  `;

  return (
    <div css={railStyle}>
      <button
        ref={buttonRef}
        type="button"
        css={buttonStyle}
        aria-label={railLabel}
        title={railLabel}
        aria-expanded={isOpen}
        aria-controls={drawerId}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
      >
        <Icon type="tab" />
      </button>
      {isOpen && (
        <div
          id={drawerId}
          role="dialog"
          aria-label={t('Open now')}
          css={drawerStyle}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            close();
          }}
        >
          <OpenNowPane
            windows={windows}
            actions={[
              foldAction,
              { icon: 'close', label: t('Close Open now'), onClick: close },
            ]}
            headingRef={headingRef}
          />
        </div>
      )}
    </div>
  );
}
