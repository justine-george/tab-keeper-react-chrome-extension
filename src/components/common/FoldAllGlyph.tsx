import React from 'react';

import { css, type SerializedStyles } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

// KAN-756. The fold-all control's glyph: `unfold_less` and `unfold_more` are
// the same two chevrons in swapped places, so a change slides each chevron to
// the other end instead of swapping glyphs. A transition, so a second press
// mid-slide turns it around; none on the first draw, and none under reduced
// motion.

// unfold_less's chevrons, from Material Symbols Outlined 400
// (@material-symbols/svg-400@0.47.6, viewBox 0 -960 960 960): ^ at the
// bottom, v at the top.
const UP = 'M343-160l-43-43 180-180 180 180-43 43-137-137-137 137Z';
const DOWN = 'M480-577 300-757l43-43 137 137 137-137 43 43-180 180Z';
// How far each moves to where unfold_more draws it, in glyph units. Its
// chevrons are a unit or two thicker; at 24px that is under 0.05px.
const UP_TO_TOP = -452;
const DOWN_TO_BOTTOM = 457;

const svgCss = css`
  display: block;
  overflow: visible;
`;
const chevronCss = css`
  transition: transform ${DURATION.MOVE} ${EASE.IN_OUT};
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

interface FoldAllGlyphProps {
  // Whether a press folds the windows (unfold_less) or unfolds them (unfold_more).
  folds: boolean;
  // The size and colour a ligature would get (Icon's renderGlyph hands them over).
  glyphCss: SerializedStyles;
}

const FoldAllGlyph: React.FC<FoldAllGlyphProps> = ({ folds, glyphCss }) => (
  <svg
    css={[glyphCss, svgCss]}
    viewBox="0 -960 960 960"
    fill="currentColor"
    focusable="false"
    data-fold-glyph={folds ? 'unfold_less' : 'unfold_more'}
  >
    <path
      d={UP}
      data-chevron="up"
      css={chevronCss}
      style={{ transform: `translateY(${folds ? 0 : UP_TO_TOP}px)` }}
    />
    <path
      d={DOWN}
      data-chevron="down"
      css={chevronCss}
      style={{ transform: `translateY(${folds ? 0 : DOWN_TO_BOTTOM}px)` }}
    />
  </svg>
);

export default FoldAllGlyph;
