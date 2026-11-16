import { useId } from 'react';
import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { dialogButtonStyles, tallButtonCss } from '../modals/dialogButtons';
import { setupFinePrintCss } from '../modals/setupFinePrint';

// KAN-862. One place to import from, in setup's import step: a line saying what it does or did, then the button
// that starts it, both on the step heading's left edge. A later source is another block below this one.
export default function ImportSourceBlock({
  line,
  otherLines,
  buttonLabel,
  onPress,
}: {
  line: string;
  // The line's other texts, laid unseen in its cell so it always takes the tallest one's height.
  otherLines: readonly string[];
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
  const lineCellStyle = css`
    display: grid;
  `;
  const lineStyle = css`
    grid-area: 1 / 1;
    margin: 0;
    ${setupFinePrintCss(COLORS)}
  `;
  const unseenStyle = css`
    visibility: hidden;
  `;

  return (
    <div css={blockStyle}>
      <div css={lineCellStyle}>
        {/* Polite: a press that finds nothing left changes only this line, and focus stays on the button. */}
        <p id={lineId} aria-live="polite" css={lineStyle}>
          {line}
        </p>
        {otherLines.map((other) => (
          <p key={other} aria-hidden="true" css={[lineStyle, unseenStyle]}>
            {other}
          </p>
        ))}
      </div>
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
