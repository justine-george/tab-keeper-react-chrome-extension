import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { dialogButtonStyles } from '../modals/dialogButtons';
import { isUnclaimedEscape } from '../common/unclaimedEscape';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useCoachPlacement } from '../../hooks/useCoachPlacement';
import { useCardMotion } from '../../hooks/useCardMotion';
import ProgressLine from '../common/ProgressLine';
import {
  COACH,
  clipPathWithHole,
  ringBox,
  type AnchoredPlacement,
  type Box,
  type CoachAction,
  type CoachSide,
  type Size,
} from './coachMarkPlacement';
import type { AnchorBox, Spotlight } from './anchorBox';
import { TYPE } from '../../styles/scale';

interface CoachMarkProps {
  step: number;
  total: number;
  text: ReactNode;
  fine?: string;
  anchors: readonly string[];
  boxOf?: AnchorBox;
  spotlight?: Spotlight;
  isLive: boolean;
  width: number;
  place: (
    anchor: Box,
    mark: Size,
    viewport: Size,
    bright: Box
  ) => AnchoredPlacement;
  onSkip?: () => void;
  onBack?: () => void;
  // Drawn as the left link in Skip tutorial's place.
  secondary?: CoachAction;
  primary: CoachAction;
  onEscape: () => void;
}

// The callout's notch, turned toward the anchor: a BORDER triangle under a PRIMARY one.
function Notch({
  side,
  notch,
  border,
  fill,
}: {
  side: CoachSide;
  notch: number;
  border: string;
  fill: string;
}) {
  // Off the facing edge by `out`, centred `half` before the notch point.
  const at = (out: number, half: number): CSSProperties => {
    const along = notch - half;
    switch (side) {
      case 'below':
        return { top: out, left: along };
      case 'right':
        return { left: out, top: along };
      case 'left':
        return { right: out, top: along };
    }
  };
  const triangle = (size: number, color: string) => {
    const pointsUp = side === 'below';
    const solid = `${size}px solid ${color}`;
    const clear = `${size}px solid transparent`;
    return css`
      position: absolute;
      width: 0;
      height: 0;
      border-top: ${pointsUp ? 'none' : clear};
      border-bottom: ${pointsUp ? solid : clear};
      border-left: ${pointsUp ? clear : side === 'left' ? solid : 'none'};
      border-right: ${pointsUp ? clear : side === 'right' ? solid : 'none'};
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

const Z = { DIM: 1010, MARK: 1020 } as const;

// A press on the dim does nothing: no focus moves, and no menu sees it as a press outside.
const swallow = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

// KAN-413's card on the run's steps: not modal, takes no focus; the dim blocks the pointer, never the keyboard.
export default function CoachMark({
  step,
  total,
  text,
  fine,
  anchors,
  boxOf,
  spotlight,
  isLive,
  width,
  place,
  onSkip,
  onBack,
  secondary,
  primary,
  onEscape,
}: CoachMarkProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const textId = useId();
  const markRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const frame = useCoachPlacement(markRef, anchors, place, boxOf, spotlight);
  useCardMotion(markRef, ringRef, step, frame);
  const buttons = dialogButtonStyles(COLORS);
  const isPlaced = frame !== null;

  // Only while drawn; the last step's Esc is its non-pin button.
  useEffect(() => {
    if (!isPlaced) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUnclaimedEscape(event)) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPlaced, onEscape]);

  // The dim over the panes and their menus (1000), the mark and ring over it, all under the toasts (1050).
  const markStyle = css`
    position: fixed;
    z-index: ${Z.MARK};
    box-sizing: border-box;
    display: grid;
    gap: 10px;
    width: ${width}px;
    margin: 0;
    padding: 18px 16px 12px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    color: ${COLORS.TEXT_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    line-height: 1.45;
    text-align: left;
    cursor: default;
    box-shadow: ${COLORS.FLOATING_SHADOW};
  `;
  // One element dims and blocks: its clip-path hole cuts both the paint and the hit-test.
  const dimStyle = css`
    position: fixed;
    inset: 0;
    z-index: ${Z.DIM};
    background-color: ${COLORS.TOUR_SCRIM};
    pointer-events: auto;
    cursor: not-allowed;
  `;
  const ringStyle = css`
    position: fixed;
    z-index: ${Z.MARK};
    box-sizing: border-box;
    border: 2px dashed ${COLORS.TEXT_COLOR};
    pointer-events: none;
  `;
  const textStyle = css`
    margin: 0;
  `;
  const stillStyle = css`
    position: fixed;
    z-index: ${Z.DIM};
    cursor: default;
  `;
  const fineStyle = css`
    margin: 0;
    font-size: ${TYPE.SECONDARY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const footStyle = css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  `;
  const endStyle = css`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
  `;

  const bright = frame?.kind === 'anchored' ? frame.bright : null;
  return (
    <>
      {frame && (
        <div
          aria-hidden="true"
          data-coach-dim
          css={dimStyle}
          onMouseDown={swallow}
          style={
            bright === null ? undefined : { clipPath: clipPathWithHole(bright) }
          }
        />
      )}
      {bright !== null && !isLive && (
        <div
          aria-hidden="true"
          data-coach-still
          css={stillStyle}
          onMouseDown={swallow}
          onClick={swallow}
          style={{
            left: bright.left,
            top: bright.top,
            width: bright.width,
            height: bright.height,
          }}
        />
      )}
      {frame?.kind === 'anchored' && (
        <div
          ref={ringRef}
          aria-hidden="true"
          data-coach-ring
          css={ringStyle}
          style={ringBox(frame.anchor)}
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
        <ProgressLine
          n={step}
          total={total}
          label={t('Step {{n}} of {{total}}', { n: step, total })}
        />
        {frame && (
          <Notch
            side={frame.kind === 'anchored' ? frame.placement.side : 'below'}
            notch={
              frame.kind === 'anchored'
                ? frame.placement.notch
                : COACH.FREE_NOTCH
            }
            border={COLORS.BORDER_COLOR}
            fill={COLORS.PRIMARY_COLOR}
          />
        )}
        <p id={textId} css={textStyle}>
          {text}
        </p>
        {fine !== undefined && <p css={fineStyle}>{fine}</p>}
        <div css={footStyle}>
          {secondary ? (
            <button
              type="button"
              css={buttons.link}
              onClick={secondary.onPress}
            >
              {secondary.label}
            </button>
          ) : (
            onSkip && (
              <button type="button" css={buttons.link} onClick={onSkip}>
                {t('Skip tutorial')}
              </button>
            )
          )}
          <span css={endStyle}>
            {onBack && (
              <button type="button" css={buttons.quiet} onClick={onBack}>
                {t('Back')}
              </button>
            )}
            <button
              type="button"
              css={buttons.filled}
              onClick={primary.onPress}
            >
              {primary.label}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
