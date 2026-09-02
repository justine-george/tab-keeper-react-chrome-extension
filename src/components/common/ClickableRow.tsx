import React from 'react';

import { css } from '@emotion/react';

interface ClickableRowProps {
  /**
   * Required, not optional. The children of a row are an Icon plus a label,
   * and the Icon renders its Material Symbols glyph as ligature text, so
   * name-from-content computes something like "arrow_back Back". There is no
   * useful default; every row has to say what it is.
   */
  ariaLabel: string;
  onClick: () => void;
  tooltipText?: string;
  style?: string;
  children: React.ReactNode;
}

/**
 * A button whose visible content is composed of other components.
 *
 * This exists because three header affordances -- the settings Back, the
 * search Back and the search opener -- each hand-rolled "a div that behaves
 * like a button", and each arrived at a different level of correctness: none
 * carried role="button", two handled Enter but not Space, and one handled no
 * key at all, leaving it focusable but impossible to activate (KAN-62).
 *
 * Rendering a real <button> rather than <div role="button"> is the point: the
 * role, the tab order, Enter, Space and the focus ring all come from the
 * platform instead of from four props that a fourth call site could forget.
 */
const ClickableRow: React.FC<ClickableRowProps> = ({
  ariaLabel,
  onClick,
  tooltipText,
  style,
  children,
}) => {
  // The UA stylesheet for <button> is what makes this swap risky, so the
  // reset is explicit rather than `all: unset` -- `all` would also drop the
  // inherited font and colour these rows rely on, and would reset the
  // focus-visible outline that makes the control usable by keyboard.
  //
  // text-align and align-items are the two that actually bite: Chrome centres
  // button content, and these rows are left-aligned flex rows.
  const rowStyle = css`
    appearance: none;
    background: none;
    border: none;
    margin: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: inherit;
    align-items: stretch;
    cursor: pointer;
    ${style && style}
  `;

  return (
    <button
      type="button"
      title={tooltipText}
      aria-label={ariaLabel}
      css={rowStyle}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

export default ClickableRow;
