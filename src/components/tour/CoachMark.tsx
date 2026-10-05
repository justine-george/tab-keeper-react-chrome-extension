import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { dialogButtonStyles } from '../modals/dialogButtons';
import { isUnclaimedEscape } from '../common/unclaimedEscape';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useCoachPlacement } from '../../hooks/useCoachPlacement';
import {
  COACH,
  type Box,
  type CoachPlacement,
  type Size,
} from './coachMarkPlacement';
import type { AnchorBox } from './anchorBox';
import { TOUR_STEPS, type TourStep } from '../../utils/functions/sampleTour';
import { TYPE } from '../../styles/scale';

interface CoachMarkProps {
  step: TourStep;
  text: string;
  anchors: readonly string[];
  boxOf?: AnchorBox;
  width: number;
  place: (anchor: Box, mark: Size, viewport: Size) => CoachPlacement;
  onNext: () => void;
  onEnd: () => void;
}

// The callout's notch, turned toward the anchor: a BORDER triangle under a PRIMARY one.
function Notch({
  placement,
  border,
  fill,
}: {
  placement: CoachPlacement;
  border: string;
  fill: string;
}) {
  // Off the facing edge by `out`, centred `half` before the notch point.
  const at = (out: number, half: number): CSSProperties => {
    const along = placement.notch - half;
    switch (placement.side) {
      case 'below':
        return { top: out, left: along };
      case 'right':
        return { left: out, top: along };
      case 'left':
        return { right: out, top: along };
    }
  };
  const triangle = (size: number, color: string) => {
    const pointsUp = placement.side === 'below';
    const solid = `${size}px solid ${color}`;
    const clear = `${size}px solid transparent`;
    return css`
      position: absolute;
      width: 0;
      height: 0;
      border-top: ${pointsUp ? 'none' : clear};
      border-bottom: ${pointsUp ? solid : clear};
      border-left: ${pointsUp
        ? clear
        : placement.side === 'left'
          ? solid
          : 'none'};
      border-right: ${pointsUp
        ? clear
        : placement.side === 'right'
          ? solid
          : 'none'};
    `;
  };
  return (
    <>
      <span
        aria-hidden="true"
        data-coach-notch
        css={triangle(8, border)}
        style={at(-9, 8)}
      />
      <span aria-hidden="true" css={triangle(7, fill)} style={at(-7, 7)} />
    </>
  );
}

// KAN-413. One step's coach mark in the callout's style; not modal, takes no focus.
export default function CoachMark({
  step,
  text,
  anchors,
  boxOf,
  width,
  place,
  onNext,
  onEnd,
}: CoachMarkProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const textId = useId();
  const markRef = useRef<HTMLDivElement>(null);
  const frame = useCoachPlacement(markRef, anchors, place, boxOf);
  const buttons = dialogButtonStyles(COLORS);
  const isLast = step === TOUR_STEPS;
  const isPlaced = frame !== null;

  // Esc is Skip tutorial (Finish at step 5), only while the mark is drawn.
  useEffect(() => {
    if (!isPlaced) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUnclaimedEscape(event)) return;
      event.preventDefault();
      onEnd();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPlaced, onEnd]);

  // Over the panes and Open now's rail (900), under the toasts (1000).
  const markStyle = css`
    position: fixed;
    z-index: 950;
    box-sizing: border-box;
    display: grid;
    gap: 10px;
    width: ${width}px;
    margin: 0;
    padding: 14px 16px 12px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    color: ${COLORS.TEXT_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: 1.45;
    text-align: left;
    cursor: default;
  `;
  const ringStyle = css`
    position: fixed;
    z-index: 950;
    box-sizing: border-box;
    border: 2px dashed ${COLORS.TEXT_COLOR};
    pointer-events: none;
  `;
  const stepStyle = css`
    margin: 0;
    font-size: ${TYPE.META};
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const textStyle = css`
    margin: 0;
  `;
  const footStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
  `;
  const endStyle = css`
    margin-left: auto;
  `;

  return (
    <>
      {frame && (
        <div
          aria-hidden="true"
          data-coach-ring
          css={ringStyle}
          style={{
            left: frame.anchor.left - COACH.RING_INSET,
            top: frame.anchor.top - COACH.RING_INSET,
            width: frame.anchor.width + 2 * COACH.RING_INSET,
            height: frame.anchor.height + 2 * COACH.RING_INSET,
          }}
        />
      )}
      <div
        ref={markRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={textId}
        aria-hidden={isPlaced ? undefined : true}
        data-coach-mark
        data-coach-step={step}
        data-coach-side={frame?.placement.side}
        css={markStyle}
        style={
          frame
            ? { left: frame.placement.left, top: frame.placement.top }
            : { left: 0, top: 0, visibility: 'hidden' }
        }
      >
        {frame && (
          <Notch
            placement={frame.placement}
            border={COLORS.BORDER_COLOR}
            fill={COLORS.PRIMARY_COLOR}
          />
        )}
        <p css={stepStyle}>
          {t('Step {{n}} of {{total}}', { n: step, total: TOUR_STEPS })}
        </p>
        <p id={textId} css={textStyle}>
          {text}
        </p>
        <div css={footStyle}>
          {!isLast && (
            <button type="button" css={buttons.link} onClick={onEnd}>
              {t('Skip tutorial')}
            </button>
          )}
          <button
            type="button"
            css={[buttons.primary, endStyle]}
            onClick={isLast ? onEnd : onNext}
          >
            {isLast ? t('Finish') : t('Next')}
          </button>
        </div>
      </div>
    </>
  );
}
