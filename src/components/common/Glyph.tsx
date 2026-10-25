import { css, type SerializedStyles } from '@emotion/react';

import type { IconName, SvgIconName } from './iconNames';
import { SVG_GLYPHS } from './svgGlyphs';

export function isSvgGlyph(type: IconName): type is SvgIconName {
  return Object.prototype.hasOwnProperty.call(SVG_GLYPHS, type);
}

// A ligature's box: 1em square at its font-size, so an svg sits where the span would.
const svgBoxCss = css`
  display: inline-block;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
`;

/**
 * One decorative glyph by name, as Icon and MenuPanel draw it: a Material
 * Symbols ligature, or an SVG_GLYPHS path at the same box and colour. Either
 * way it carries `data-icon`, which is how a test asks what was drawn.
 */
export function Glyph({
  type,
  glyphCss,
  className,
  hidesLigatureText = false,
}: {
  type: IconName;
  glyphCss: SerializedStyles;
  className?: string;
  // For a glyph inside a control named by its own text: the ligature's letters would join that name. An svg is always hidden.
  hidesLigatureText?: boolean;
}) {
  if (isSvgGlyph(type)) {
    // An unavailable ligature falls back to literal text rather than to tofu,
    // so `type="window_add"` against the font would print its NAME -- exactly
    // the failure KAN-5 had to measure inked width to catch.
    return (
      <svg
        data-icon={type}
        className={className}
        css={[svgBoxCss, glyphCss]}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d={SVG_GLYPHS[type]} />
      </svg>
    );
  }
  return (
    <span
      data-icon={type}
      className={
        className
          ? `material-symbols-outlined ${className}`
          : 'material-symbols-outlined'
      }
      css={glyphCss}
      aria-hidden={hidesLigatureText ? true : undefined}
    >
      {type}
    </span>
  );
}
