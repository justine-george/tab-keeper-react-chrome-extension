import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import { COACH_LAYER } from './coachLayers';

import {
  dialogButtonStyles,
  flushLinkCss,
  pairCss,
  tallButtonCss,
} from '../modals/dialogButtons';
import { isUnclaimedEscape } from '../common/unclaimedEscape';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useCoachPlacement } from '../../hooks/useCoachPlacement';
import { useCardMotion } from '../../hooks/useCardMotion';
import ProgressLine from '../common/ProgressLine';
import Icon from '../common/Icon';
import {
  COACH,
  clipPathWithHoles,
  ringBox,
  ringCorners,
  type AnchoredPlacement,
  type Box,
  type CoachAction,
  sameCorners,
  type CoachSide,
  type HoleCorners,
  type Size,
} from './coachMarkPlacement';
import type { AnchorBox, Opening, Spotlight } from './anchorBox';
import { playLineIn, playSwell } from './cardMotion';
import { canAnimate, prefersReducedMotion } from '../modals/getStartedMotion';
import { CORNER_SHAPE, RADIUS, TYPE } from '../../styles/scale';
import { onRefusedDuringTour } from './tourRefusal';
import { corners } from '../../styles/corners';

// O1. Each ring sits RING_INSET outside what it rings, so it rounds that
// much more: a CONTROL's at PANEL.
// KAN-901. The dim's hole takes the corners of what it lights, so it is lit
// to its corners and no further: a CONTROL's unless the step says otherwise.
const CONTROL_CORNERS = sameCorners(Number.parseFloat(RADIUS.CONTROL));

// The run's step, and which card it is of how many; null for the note after the run, which has no progress line.
export interface CoachProgress {
  step: number;
  position: number;
  total: number;
}

// Round 2 (KAN-1023). A line of the card's checklist, ticked once done.
export interface CoachCheck {
  label: string;
  isDone: boolean;
}

interface CoachMarkProps {
  progress: CoachProgress | null;
  // The run step this card is, or 'ending' (KAN-879); none on the note after the run.
  kind?: string;
  text: ReactNode;
  fine?: string;
  checklist?: readonly CoachCheck[];
  anchors: readonly string[];
  boxOf?: AnchorBox;
  spotlight?: Spotlight;
  // KAN-900. Elements lit and reachable in holes of their own, outside the ring.
  openings?: readonly Opening[];
  // KAN-901. The corners of what the step lights, when not a CONTROL's.
  holeCorners?: HoleCorners;
  isLive: boolean;
  // KAN-879. False for a card that leaves the page undimmed, as the onboarding ending does.
  isDimmed?: boolean;
  width: string;
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

// The callout's notch, turned toward the anchor: a border triangle over a fill one.
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

const Z = COACH_LAYER;

// A press on the dim does nothing: no focus moves, no menu sees it as a press outside,
// and a right-click opens no menu, Chrome's included (KAN-736).
// KAN-902. Whether an element may be moved: drawn, animatable, motion allowed.
const canMove = (element: HTMLElement | null): element is HTMLElement =>
  element !== null && canAnimate(element) && !prefersReducedMotion();

const swallow = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

// KAN-413's card on the run's steps: not modal, takes no focus; the dim blocks the pointer, never the keyboard.
export default function CoachMark({
  progress,
  kind,
  text,
  fine,
  checklist,
  anchors,
  boxOf,
  spotlight,
  openings,
  holeCorners = CONTROL_CORNERS,
  isLive,
  isDimmed = true,
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
  const nudgeRef = useRef<HTMLParagraphElement>(null);
  // KAN-902. The step a press on the dim was made at: its card says why
  // nothing happened, until the step changes.
  const step = progress?.step ?? null;
  const [pressedAt, setPressedAt] = useState<{ step: number | null } | null>(
    null
  );
  const isNudged = pressedAt !== null && pressedAt.step === step;
  // Round 2. Any press the tour turns away says so: on the dim, on a
  // look-only step's still box, or a row's right-click (tourRefusal).
  const nudge = () => {
    setPressedAt({ step });
    if (canMove(markRef.current)) playSwell(markRef.current);
  };
  const onDimPress = (event: SyntheticEvent) => {
    swallow(event);
    nudge();
  };
  // A right-click, or a Ctrl+click on a Mac, nudges at its contextmenu: once.
  const onDimMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey) swallow(event);
    else onDimPress(event);
  };
  useLayoutEffect(() => {
    if (isNudged && canMove(nudgeRef.current)) playLineIn(nudgeRef.current);
  }, [isNudged]);
  const ringRef = useRef<HTMLDivElement>(null);
  const frame = useCoachPlacement(
    markRef,
    anchors,
    place,
    boxOf,
    spotlight,
    openings
  );
  useCardMotion(markRef, ringRef, progress?.step ?? null, frame);
  const buttons = dialogButtonStyles(COLORS);
  const isPlaced = frame !== null;
  const onRefusedRef = useRef(nudge);
  useLayoutEffect(() => {
    onRefusedRef.current = nudge;
  });
  useLayoutEffect(() => {
    if (!isPlaced) return;
    return onRefusedDuringTour(() => onRefusedRef.current());
  }, [isPlaced]);

  // Only while drawn; the last step's Esc is its non-pin button. A layout effect, so it lands in the commit that shows the card (KAN-520).
  // On window, so it hears Esc after the overlays on document: an open drawer closes before the tour skips (KAN-813).
  useLayoutEffect(() => {
    if (!isPlaced) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isUnclaimedEscape(event)) return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaced, onEscape]);

  // The dim over the panes and their menus (1000), the mark and ring over it, all under the toasts (1050).
  const markStyle = css`
    position: fixed;
    z-index: ${Z.MARK};
    box-sizing: border-box;
    display: grid;
    gap: 10px;
    width: ${width};
    max-width: calc(100vw - ${2 * COACH.GUTTER}px);
    margin: 0;
    padding: 20px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    ${corners(RADIUS.DIALOG)}
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
    corner-shape: ${CORNER_SHAPE};
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
  const checklistStyle = css`
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  `;
  const checkStyle = css`
    display: flex;
    align-items: flex-start;
    gap: 8px;
  `;
  // An open ring until done, then filled with a tick, as Tickbox draws one.
  const tickStyle = css`
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border: 1.5px solid ${COLORS.TEXT_COLOR};
    border-radius: 50%;
    &[data-done] {
      background: ${COLORS.TEXT_COLOR};
    }
  `;
  // KAN-970: the way out at the row's left, its words on the text edge, as in the dialogs; the way on at the right.
  // wrap-reverse: when one row can't hold both, the way out drops under the buttons, not above them.
  const footStyle = css`
    display: flex;
    flex-wrap: wrap-reverse;
    align-items: center;
    gap: 6px 8px;
    margin-top: 6px;
  `;
  const endStyle = css`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-inline-start: auto;
  `;
  const wayOutCss = css`
    order: -1;
  `;
  const tall = tallButtonCss(20);

  const bright = frame?.kind === 'anchored' ? frame.bright : null;
  const openingHoles = frame?.kind === 'anchored' ? frame.openings : [];
  return (
    <>
      {frame && isDimmed && (
        <div
          aria-hidden="true"
          data-coach-dim
          css={dimStyle}
          onMouseDown={onDimMouseDown}
          onContextMenu={onDimPress}
          style={
            bright === null
              ? undefined
              : {
                  clipPath: clipPathWithHoles([
                    { box: bright, corners: holeCorners },
                    ...openingHoles,
                  ]),
                }
          }
        />
      )}
      {/* KAN-1021. A look-only step holds what it lights beside the ring too. */}
      {bright !== null &&
        !isLive &&
        [bright, ...openingHoles.map((hole) => hole.box)].map((box, index) => (
          <div
            key={index}
            aria-hidden="true"
            data-coach-still
            css={stillStyle}
            onMouseDown={onDimMouseDown}
            onClick={swallow}
            onContextMenu={onDimPress}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
          />
        ))}
      {frame?.kind === 'anchored' && (
        <div
          ref={ringRef}
          aria-hidden="true"
          data-coach-ring
          css={ringStyle}
          style={{
            ...ringBox(frame.anchor),
            borderRadius: ringCorners(holeCorners),
          }}
        />
      )}
      {openingHoles
        .filter((hole) => hole.isRinged)
        .map((hole, index) => (
          <div
            key={index}
            aria-hidden="true"
            data-coach-opening-ring
            css={ringStyle}
            style={{
              ...ringBox(hole.box),
              borderRadius: ringCorners(hole.corners),
            }}
          />
        ))}
      <div
        ref={markRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={textId}
        aria-hidden={isPlaced ? undefined : true}
        data-coach-mark
        data-coach-step={progress?.step}
        data-coach-kind={kind}
        data-coach-side={frame?.placement.side}
        css={markStyle}
        style={
          frame
            ? { left: frame.placement.left, top: frame.placement.top }
            : { left: 0, top: 0, visibility: 'hidden' }
        }
      >
        {progress !== null && (
          <ProgressLine
            n={progress.position}
            total={progress.total}
            label={t('Step {{n}} of {{total}}', {
              n: progress.position,
              total: progress.total,
            })}
          />
        )}
        {/* KAN-755. A free card points at nothing: the tab strip may be on top or down the side. */}
        {frame?.kind === 'anchored' && (
          <Notch
            side={frame.placement.side}
            notch={frame.placement.notch}
            border={COLORS.PANEL_BORDER_COLOR}
            fill={COLORS.PRIMARY_COLOR}
          />
        )}
        <p id={textId} css={textStyle}>
          {text}
        </p>
        {checklist !== undefined && (
          <ul css={checklistStyle}>
            {checklist.map(({ label, isDone }) => (
              <li key={label} css={checkStyle}>
                <span
                  data-coach-tick
                  {...(isDone
                    ? { 'data-done': '', role: 'img', 'aria-label': t('Done') }
                    : { 'aria-hidden': true })}
                  css={tickStyle}
                >
                  {isDone && (
                    <Icon
                      type="check"
                      size="14px"
                      color={COLORS.PRIMARY_COLOR}
                      style="padding: 0;"
                    />
                  )}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        )}
        {fine !== undefined && <p css={fineStyle}>{fine}</p>}
        {isNudged && (
          <p ref={nudgeRef} css={fineStyle} data-coach-nudge>
            {t('Everything else works after the tour.')}
          </p>
        )}
        <div css={footStyle}>
          <span css={[endStyle, onBack && pairCss]}>
            {onBack && (
              <button
                type="button"
                css={[buttons.quiet, tall]}
                onClick={onBack}
              >
                {t('Back')}
              </button>
            )}
            <button
              type="button"
              css={[buttons.filled, tall]}
              onClick={primary.onPress}
            >
              {primary.label}
            </button>
          </span>
          {secondary ? (
            <button
              type="button"
              css={[buttons.link, flushLinkCss, wayOutCss]}
              onClick={secondary.onPress}
            >
              {secondary.label}
            </button>
          ) : (
            onSkip && (
              <button
                type="button"
                css={[buttons.link, flushLinkCss, wayOutCss]}
                onClick={onSkip}
              >
                {t('Skip tutorial')}
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}
