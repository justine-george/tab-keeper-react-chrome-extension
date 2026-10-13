import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from './Icon';
import { cardFadeIn } from './cardFade';
import { isUnclaimedEscape } from './unclaimedEscape';
import { dialogButtonStyles } from '../modals/dialogButtons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { markClosesThisTabCardAnswered } from '../../redux/slices/settingsDataStateSlice';
import type { AppDispatch, RootState } from '../../redux/store';
import { TYPE } from '../../styles/scale';

interface ClosesThisTabProps {
  // Whether the press would close this full view. A read that fails counts as yes.
  wouldClose: () => boolean | Promise<boolean>;
  // What the press does.
  onGo: () => void;
  text: string;
  goLabel: string;
  pinLabel: string;
  // Which edge of the control the card lines up with, and the notch's distance from it.
  align: 'left' | 'right';
  notchInset: string;
  // For a control that shrinks in its row (Open now's chip).
  shrinks?: boolean;
  children: (press: () => void) => ReactNode;
}

/**
 * KAN-578 (pick A, H1). A control whose press may close this full view. Until
 * Go back, or a Pin that worked, on this device, such a press shows a card
 * first; ✕, Esc and a press outside cancel it and are not an answer.
 */
export default function ClosesThisTab({
  wouldClose,
  onGo,
  text,
  goLabel,
  pinLabel,
  align,
  notchInset,
  shrinks = false,
  children,
}: ClosesThisTabProps) {
  const dispatch: AppDispatch = useDispatch();
  const isAnswered = useSelector(
    (state: RootState) => state.settingsDataState.isClosesThisTabCardAnswered
  );
  const [isOpen, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const press = async () => {
    if (isAnswered) {
      onGo();
      return;
    }
    let closes = true;
    try {
      closes = await wouldClose();
    } catch (error) {
      console.warn('Could not tell whether this tab would close:', error);
    }
    if (closes) setOpen(true);
    else onGo();
  };

  const go = () => {
    dispatch(markClosesThisTabCardAnswered());
    setOpen(false);
    onGo();
  };

  // Awaited before the press goes on: the worker reads the tab's pinned state to decide.
  const pinAndGo = async () => {
    try {
      const self = await chrome.tabs.getCurrent();
      if (self?.id === undefined) throw new Error('Not in a tab.');
      await chrome.tabs.update(self.id, { pinned: true });
    } catch (error) {
      console.warn('Could not pin this tab:', error);
      return;
    }
    go();
  };

  // The control is the wrapper's first focusable child; the card follows it.
  const cancel = (refocus: boolean) => {
    setOpen(false);
    if (refocus)
      anchorRef.current
        ?.querySelector<HTMLElement>('button, [role="button"]')
        ?.focus();
  };

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

  return (
    <span
      ref={anchorRef}
      css={css`
        position: relative;
        display: inline-flex;
        ${shrinks ? 'min-width: 0;' : ''}
      `}
    >
      {children(() => void press())}
      {isOpen && (
        <ClosesThisTabCard
          text={text}
          goLabel={goLabel}
          pinLabel={pinLabel}
          align={align}
          notchInset={notchInset}
          onGo={go}
          onPin={() => void pinAndGo()}
          onCancel={() => cancel(true)}
        />
      )}
    </span>
  );
}

interface ClosesThisTabCardProps {
  text: string;
  goLabel: string;
  pinLabel: string;
  align: 'left' | 'right';
  notchInset: string;
  onGo: () => void;
  onPin: () => void;
  onCancel: () => void;
}

// FullViewCallout's card, sized to its buttons: they never wrap.
function ClosesThisTabCard({
  text,
  goLabel,
  pinLabel,
  align,
  notchInset,
  onGo,
  onPin,
  onCancel,
}: ClosesThisTabCardProps) {
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
      data-closes-this-tab-card
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
          border: 1px solid ${COLORS.BORDER_COLOR};
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
      <span aria-hidden="true" css={notch(8, COLORS.BORDER_COLOR, -9, 0)} />
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
        <button type="button" css={buttons.quiet} onClick={onPin}>
          {pinLabel}
        </button>
        <button type="button" css={buttons.filled} onClick={onGo} autoFocus>
          {goLabel}
        </button>
      </div>
    </div>
  );
}
