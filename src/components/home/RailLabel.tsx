import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';

// A rail's label, under its glyph (KAN-776). Named by its button's
// aria-label, so this is only what the eye reads. KAN-999: the card's tooltip
// sits under it (data-tooltip-near), not at the full-height card's foot.
export default function RailLabel({ text }: { text: string }) {
  const COLORS = useThemeColors();
  const { i18n } = useTranslation();

  // KAN-776 C. Read top to bottom; CJK stands upright. Set, not inherited:
  // inherited, it drew black on Charcoal.
  const labelStyle = css`
    color: ${COLORS.TEXT_COLOR};
    font-size: ${TYPE.SECONDARY};
    padding: 6px 0 4px;
  `;
  const verticalStyle = css`
    writing-mode: vertical-rl;
    line-height: 1.25;
    white-space: nowrap;
  `;
  // Upright CJK in vertical-rl advances by the font's vertical metrics, and
  // WenQuanYi Zen Hei's are zero: the label drew on one spot. Stacked one
  // character per line, each takes its horizontal advance; a word per block
  // keeps Korean's spaces.
  const stacksUpright = /^(ja|zh|ko)\b/i.test(i18n.language);
  const stackedStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35em;
    line-height: 1;
    & > span {
      width: 1em;
      text-align: center;
    }
  `;

  return stacksUpright ? (
    <span css={[labelStyle, stackedStyle]} data-tooltip-near="">
      {text
        .split(' ')
        .flatMap((word, i) => [
          i > 0 ? ' ' : null,
          <span key={i}>{word}</span>,
        ])}
    </span>
  ) : (
    <span css={[labelStyle, verticalStyle]} data-tooltip-near="">
      {text}
    </span>
  );
}
