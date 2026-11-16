import { useId } from 'react';
import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';
import { dialogButtonStyles, tallButtonCss } from '../modals/dialogButtons';

// KAN-862. One place to import from, in setup's import step: a line saying what it does or did, then the button
// that starts it, both on the step heading's left edge. A later source is another block below this one.
export default function ImportSourceBlock({
  line,
  buttonLabel,
  onPress,
}: {
  line: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  const COLORS = useThemeColors();
  const lineId = useId();
  const buttons = dialogButtonStyles(COLORS);

  const blockStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  `;
  // Setup's small print type, so the line and the note under the block read as one voice.
  const lineStyle = css`
    margin: 0;
    font-size: ${TYPE.SECONDARY};
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
    &:lang(ko) {
      word-break: keep-all;
    }
  `;

  return (
    <div css={blockStyle}>
      {/* Polite: a press that finds nothing left changes only this line, and focus stays on the button. */}
      <p id={lineId} aria-live="polite" css={lineStyle}>
        {line}
      </p>
      <button
        type="button"
        aria-describedby={lineId}
        // Setup's Back, so it reads as a button to press.
        css={[buttons.quiet, tallButtonCss(24)]}
        onClick={onPress}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
