import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from './Icon';
import { cardFadeIn } from './cardFade';
import { isUnclaimedEscape } from './unclaimedEscape';
import { dialogButtonStyles } from '../modals/dialogButtons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { TYPE } from '../../styles/scale';

interface Answer {
  label: string;
  onPress: () => void;
}

interface AskCardProps {
  text: string;
  quiet: Answer;
  // Focused on open.
  filled: Answer;
  align: 'left' | 'right';
  notchInset: string;
  // ✕ and Esc.
  onCancel: () => void;
}

// The KAN-578 card, any two answers; sized to its buttons, they never wrap.
export default function AskCard({
  text,
  quiet,
  filled,
  align,
  notchInset,
  onCancel,
}: AskCardProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const textId = useId();
  const buttons = dialogButtonStyles(COLORS);

  // A consumed Esc is prevented, or Chrome closes the popup (KAN-403).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUnclaimedEscape(event)) return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const notch = (
    size: number,
    color: string,
    top: number,
    inset: number
  ) => css`
    position: absolute;
    top: ${top}px;
    ${align}: calc(${notchInset} + ${inset}px);
    width: 0;
    height: 0;
    border-left: ${size}px solid transparent;
    border-right: ${size}px solid transparent;
    border-bottom: ${size}px solid ${color};
  `;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={textId}
      data-ask-card
      css={[
        css`
          position: absolute;
          z-index: 20;
          top: calc(100% + 12px);
          ${align}: -8px;
          width: max-content;
          min-width: 264px;
          max-width: 360px;
          padding: 10px 6px 12px 14px;
          background-color: ${COLORS.PRIMARY_COLOR};
          border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
          color: ${COLORS.LABEL_L1_COLOR};
          font-family: ${FONT_FAMILY};
          font-size: ${TYPE.BODY};
          line-height: 1.5;
          text-align: left;
          white-space: normal;
          cursor: default;
        `,
        cardFadeIn,
      ]}
    >
      <span
        aria-hidden="true"
        css={notch(8, COLORS.PANEL_BORDER_COLOR, -9, 0)}
      />
      <span aria-hidden="true" css={notch(7, COLORS.PRIMARY_COLOR, -7, 1)} />
      <div
        css={css`
          display: flex;
          align-items: flex-start;
          gap: 6px;
        `}
      >
        <p
          id={textId}
          css={css`
            flex: 1;
            margin: 0;
            padding-top: 4px;
          `}
        >
          {text}
        </p>
        <Icon
          type="close"
          ariaLabel={t('Close')}
          tooltipText={t('Close')}
          onClick={onCancel}
        />
      </div>
      <div
        css={css`
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin: 8px 8px 0 0;
          white-space: nowrap;
        `}
      >
        <button type="button" css={buttons.quiet} onClick={quiet.onPress}>
          {quiet.label}
        </button>
        <button
          type="button"
          css={buttons.filled}
          onClick={filled.onPress}
          autoFocus
        >
          {filled.label}
        </button>
      </div>
    </div>
  );
}
