import React from 'react';

import { css, type SerializedStyles } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

// KAN-757. A window row's chevron: `expand_less` is `expand_more` turned over,
// so a fold change turns the one glyph half a turn instead of swapping glyphs.
// A transition, so a second press mid-turn turns it back; none on the first
// draw, and none under reduced motion.

// Material Symbols Outlined 400 (viewBox 0 -960 960 960) draws expand_more's
// chevron from y -627 to -344 and expand_less's from -640 to -357: turned about
// y -492, 468 units from the top, one lands on the other.
const TURN_ORIGIN = `50% ${(468 / 960) * 100}%`;

const glyphTurnCss = css`
  display: inline-block;
  transform-origin: ${TURN_ORIGIN};
  transition: transform ${DURATION.MOVE} ${EASE.IN_OUT};
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

interface ChevronGlyphProps {
  // Whether the window is unfolded (expand_less) or folded (expand_more).
  open: boolean;
  // The size and colour a ligature would get (Icon's renderGlyph hands them over).
  glyphCss: SerializedStyles;
}

const ChevronGlyph: React.FC<ChevronGlyphProps> = ({ open, glyphCss }) => (
  <span
    css={[glyphCss, glyphTurnCss]}
    className="material-symbols-outlined"
    data-window-chevron={open ? 'expand_less' : 'expand_more'}
    style={{ transform: `rotate(${open ? -180 : 0}deg)` }}
  >
    expand_more
  </span>
);

export default ChevronGlyph;
