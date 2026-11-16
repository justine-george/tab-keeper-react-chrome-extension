import { useId, type ReactNode } from 'react';
import { css } from '@emotion/react';

import Icon from './Icon';
import { focusRingCss } from './focusRing';
import { slidingPairColors } from './slidingPairColors';
import { useThemeColors } from '../../hooks/useThemeColors';
import { corners } from '../../styles/corners';
import { ICON, RADIUS, TYPE } from '../../styles/scale';

// A toggle button with a drawing above its name and a caption: the default view cards (KAN-7 §5, KAN-749) and
// setup's import sources (KAN-862). Pressed, its label strip fills and carries a ✓ (D2).
export function PictureCard({
  isPressed,
  label,
  caption,
  art,
  onPress,
}: {
  isPressed: boolean;
  label: string;
  caption: string;
  art: ReactNode;
  onPress: () => void;
}) {
  const COLORS = useThemeColors();
  const pressed = slidingPairColors(COLORS);
  const id = useId();
  const labelId = `${id}-label`;
  const captionId = `${id}-caption`;

  const cardStyle = css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: ${COLORS.TEXT_COLOR};
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
    /* A control (KAN-721); the label strip's fill is clipped to its corners. */
    ${corners(RADIUS.CONTROL)}
    overflow: hidden;
    ${focusRingCss(COLORS)}
  `;
  // D2: the pressed card's outline is 1px TEXT; its label strip is filled below.
  const cardPressedStyle = css`
    border-color: ${COLORS.TEXT_COLOR};
  `;
  const artStyle = css`
    display: block;
    padding: 12px;
  `;
  const labelStyle = css`
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 6px 12px;
    /* Holds two lines, so the check's padded box never resizes the pressed strip. */
    min-height: 3rem;
  `;
  const labelTextStyle = css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `;
  const captionStyle = css`
    font-size: ${TYPE.SECONDARY};
    line-height: 1.35;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  // D2: the language cell's pressed look, on the label strip.
  const labelPressedStyle = css`
    background-color: ${pressed.knob};
    color: ${pressed.labelOnKnob};
  `;
  const captionPressedStyle = css`
    color: ${pressed.labelOnKnob};
  `;

  return (
    <button
      type="button"
      aria-pressed={isPressed}
      aria-labelledby={labelId}
      aria-describedby={captionId}
      css={[cardStyle, isPressed && cardPressedStyle]}
      onClick={onPress}
    >
      <span aria-hidden="true" css={artStyle}>
        {art}
      </span>
      <span data-card-label css={[labelStyle, isPressed && labelPressedStyle]}>
        {isPressed && (
          <Icon type="check" size={ICON.SMALL} color={pressed.labelOnKnob} />
        )}
        <span css={labelTextStyle}>
          <span id={labelId}>{label}</span>
          <span
            id={captionId}
            data-card-caption
            css={[captionStyle, isPressed && captionPressedStyle]}
          >
            {caption}
          </span>
        </span>
      </span>
    </button>
  );
}

const rowStyle = css`
  display: flex;
  gap: 14px;
  /* Setup's width at 16px; the full view's pane is wider than the cards need. */
  max-width: 36rem;
`;

// Picture cards side by side, sharing the row's width.
export function PictureCardRow({ children }: { children: ReactNode }) {
  return <div css={rowStyle}>{children}</div>;
}
