import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { TYPE } from '../../styles/scale';

// An empty list's one line, at its top; page content, so it sits behind any
// dialog. The saved list and Open now draw the same line (KAN-571).
export default function EmptyListLine({
  list,
  text,
}: {
  list: 'saved' | 'open-now';
  text: string;
}) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  return (
    <p
      data-empty-list={list}
      css={css`
        margin: 0;
        padding: 16px;
        text-align: center;
        font-family: ${FONT_FAMILY};
        font-size: ${TYPE.BODY};
        line-height: 1.45;
        color: ${COLORS.LABEL_L1_COLOR};
      `}
    >
      {text}
    </p>
  );
}
