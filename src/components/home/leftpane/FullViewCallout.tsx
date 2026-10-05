import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { isUnclaimedEscape } from '../../common/unclaimedEscape';
import Icon from '../../common/Icon';
import { dialogButtonStyles } from '../../modals/dialogButtons';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { ICON, TYPE } from '../../../styles/scale';

interface FullViewCalloutProps {
  onTry: () => void;
  onDismiss: () => void;
}

// The notch's left edge: under the middle of ⤢'s box, which starts 24px in.
const NOTCH_LEFT = `calc(24px + (${ICON.DEFAULT} + 8px) / 2 - 8px)`;

// KAN-7 §6. Anchored under ⤢ in the popup, once. Not modal: the focus stays where it was.
export default function FullViewCallout({
  onTry,
  onDismiss,
}: FullViewCalloutProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const textId = useId();
  const buttons = dialogButtonStyles(COLORS);

  // D7. Esc closes it, unless a field already used the key; a consumed Esc is
  // prevented, or Chrome closes the popup (KAN-403). This hears Esc before a
  // modal dialog's cancel or a drag's own listener, so it stands aside for both.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUnclaimedEscape(event)) return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const calloutStyle = css`
    position: absolute;
    z-index: 20;
    top: calc(100% + 12px);
    left: -24px;
    width: 264px;
    padding: 10px 6px 12px 14px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: 1.5;
    text-align: left;
    cursor: default;
  `;
  const notch = (
    size: number,
    color: string,
    top: number,
    inset: number
  ) => css`
    position: absolute;
    top: ${top}px;
    left: calc(${NOTCH_LEFT} + ${inset}px);
    width: 0;
    height: 0;
    border-left: ${size}px solid transparent;
    border-right: ${size}px solid transparent;
    border-bottom: ${size}px solid ${color};
  `;
  const rowStyle = css`
    display: flex;
    align-items: flex-start;
    gap: 6px;
  `;
  const textStyle = css`
    flex: 1;
    margin: 0;
    padding-top: 4px;
  `;
  const actionsStyle = css`
    display: flex;
    justify-content: flex-end;
    margin: 8px 8px 0 0;
  `;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={textId}
      data-full-view-callout
      css={calloutStyle}
    >
      <span aria-hidden="true" css={notch(8, COLORS.BORDER_COLOR, -9, 0)} />
      <span aria-hidden="true" css={notch(7, COLORS.PRIMARY_COLOR, -7, 1)} />
      <div css={rowStyle}>
        <p id={textId} css={textStyle}>
          {t('See your saved sessions and open tabs side by side.')}
        </p>
        <Icon
          type="close"
          ariaLabel={t('Close')}
          tooltipText={t('Close')}
          onClick={onDismiss}
        />
      </div>
      <div css={actionsStyle}>
        <button type="button" css={buttons.primary} onClick={onTry}>
          {t('Try it')}
        </button>
      </div>
    </div>
  );
}
