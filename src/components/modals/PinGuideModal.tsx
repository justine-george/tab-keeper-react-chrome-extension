import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import TabKeeperMark from '../common/TabKeeperMark';
import {
  NextStepGlyph,
  PointUpDoodleGlyph,
  PointUpGlyph,
  SpinnerGlyph,
} from '../common/glyphs';
import { doodleTipFromLeft } from '../common/pointUpDoodle';
import { PinStepArt, PinnedStepArt, PuzzleStepArt } from './pinGuideArt';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { AppDispatch } from '../../redux/store';
import { dismissPinGuide } from '../../redux/slices/settingsDataStateSlice';
import { leavePinGuide } from '../../redux/firstOpenFollowUps';
import { watchToolbarPin } from '../../utils/functions/toolbarPin';
import { ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'pin-guide-title';
// §4: the spec's value (the mock fixed none): long enough to read "Pinned".
const CLOSE_AFTER_PIN_MS = 1500;
// 107px: the puzzle piece's centre from the window's right edge in Justine's Chrome, left of profile and ⋮.
const PUZZLE_FROM_RIGHT = 107;
const ARROW_WIDTH = 50;
const ARROW_HEIGHT = 84;
const ARROW_RIGHT =
  PUZZLE_FROM_RIGHT -
  (ARROW_WIDTH - doodleTipFromLeft(ARROW_WIDTH, ARROW_HEIGHT));

interface PinStep {
  art: ReactNode;
  caption: string;
  // Where the pointer sits under the ringed item, from the strip's right edge.
  pointerInset: number;
}

// KAN-7 §4. The full view only: Chrome's puzzle menu would close the popup.
export const PinGuideModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPinned, setPinned] = useState(false);

  // Opens unlit (KAN-243): the dialog holds the focus, not its first control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  useEffect(() => watchToolbarPin(() => setPinned(true)), []);

  // A Skip in the meantime unmounts this, and the cleanup drops the timer.
  useEffect(() => {
    if (!isPinned) return;
    const timer = setTimeout(
      () => dispatch(leavePinGuide()),
      CLOSE_AFTER_PIN_MS
    );
    return () => clearTimeout(timer);
  }, [isPinned, dispatch]);

  const dismiss = () => {
    dispatch(dismissPinGuide());
    dispatch(leavePinGuide());
  };

  const steps: PinStep[] = [
    {
      art: <PuzzleStepArt />,
      caption: t('Click the puzzle piece'),
      pointerInset: 94,
    },
    {
      art: <PinStepArt />,
      caption: t('Click the pin next to Tab Keeper'),
      pointerInset: 28,
    },
    {
      art: <PinnedStepArt />,
      caption: t('Tab Keeper stays on your toolbar'),
      pointerInset: 124,
    },
  ];

  const buttons = dialogButtonStyles(COLORS);

  // D8: top right, under Chrome's toolbar, which the arrow points at.
  const dialogStyle = css`
    position: fixed;
    top: 96px;
    right: 48px;
    left: auto;
    margin: 0;
    padding: 20px;
    width: min(calc(100% - 64px), 820px);
    max-width: none;
    max-height: none;
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    &[open] {
      display: block;
    }
    &:focus {
      outline: none;
    }
    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
    }
  `;
  // In the gap above the guide (top 96px), so it never covers it.
  const arrowStyle = css`
    position: fixed;
    top: 6px;
    right: ${ARROW_RIGHT}px;
    color: ${COLORS.PRIMARY_COLOR};
    pointer-events: none;
  `;
  const titleRowStyle = css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
  `;
  const titleStyle = css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const stepsStyle = css`
    display: flex;
    align-items: stretch;
    gap: 34px;
    margin: 0;
    padding: 0;
    list-style: none;
  `;
  const stepStyle = css`
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background-color: ${COLORS.PRIMARY_COLOR};
  `;
  const betweenStyle = css`
    position: absolute;
    left: -29px;
    top: 40%;
    color: ${COLORS.TEXT_COLOR};
  `;
  const pointerStyle = (inset: number) => css`
    display: flex;
    justify-content: flex-end;
    padding: 6px ${inset}px 0 0;
    color: ${COLORS.TEXT_COLOR};
  `;
  const captionStyle = css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 0;
    padding: 2px 10px 12px;
    text-align: center;
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const footerStyle = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  `;
  const statusStyle = css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: ${COLORS.LABEL_L1_COLOR};
  `;

  return (
    <dialog
      ref={dialogRef}
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <span data-pin-arrow aria-hidden="true" css={arrowStyle}>
        <PointUpDoodleGlyph
          width={`${ARROW_WIDTH}px`}
          height={`${ARROW_HEIGHT}px`}
        />
      </span>
      <div css={titleRowStyle}>
        <h2 id={TITLE_ID} css={titleStyle}>
          <TabKeeperMark size={ICON.DEFAULT} />
          {t('Pin Tab Keeper to your toolbar')}
        </h2>
        <Icon
          type="close"
          ariaLabel={t('Close')}
          tooltipText={t('Close')}
          onClick={dismiss}
        />
      </div>
      <ol css={stepsStyle}>
        {steps.map((step, index) => (
          <li key={step.caption} css={stepStyle}>
            {index > 0 && (
              <span aria-hidden="true" css={betweenStyle}>
                <NextStepGlyph size={ICON.SMALL} />
              </span>
            )}
            <div aria-hidden="true">{step.art}</div>
            <div
              data-pin-step-pointer
              aria-hidden="true"
              css={pointerStyle(step.pointerInset)}
            >
              <PointUpGlyph />
            </div>
            <p data-pin-step-caption css={captionStyle}>
              {index === steps.length - 1 && isPinned && (
                <Icon type="check" size={ICON.SMALL} />
              )}
              {step.caption}
            </p>
          </li>
        ))}
      </ol>
      <div css={footerStyle}>
        <button type="button" css={buttons.link} onClick={dismiss}>
          {t('Skip')}
        </button>
        <p role="status" css={statusStyle}>
          {isPinned ? (
            <>
              <Icon type="check" size={ICON.SMALL} />
              <span data-pin-status-words>{t('Pinned. Closing…')}</span>
            </>
          ) : (
            <>
              <SpinnerGlyph size={ICON.SMALL} />
              <span data-pin-status-words>{t('Waiting for you to pin…')}</span>
            </>
          )}
        </p>
      </div>
    </dialog>
  );
};
