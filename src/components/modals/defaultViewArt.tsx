import { css } from '@emotion/react';

import TabKeeperMark from '../common/TabKeeperMark';
import { useThemeColors } from '../../hooks/useThemeColors';

// KAN-7 §5 step 3. The two views in miniature, after the round-5 mock.

const artStyle = css`
  display: block;
  width: 100%;
  height: auto;
`;

export function CompactViewArt() {
  const C = useThemeColors();
  return (
    <svg
      viewBox="0 0 220 120"
      aria-hidden="true"
      focusable="false"
      css={artStyle}
    >
      <rect
        x="0.5"
        y="0.5"
        width="219"
        height="26"
        fill={C.SELECTION_COLOR}
        stroke={C.BORDER_COLOR}
      />
      <rect
        x="8"
        y="6"
        width="130"
        height="14"
        fill={C.PRIMARY_COLOR}
        stroke={C.BORDER_COLOR}
      />
      <rect
        x="176"
        y="5"
        width="16"
        height="16"
        fill="none"
        stroke={C.TEXT_COLOR}
        strokeDasharray="3 2"
      />
      <foreignObject x="177" y="6" width="14" height="14">
        <TabKeeperMark size="14px" />
      </foreignObject>
      {[8, 13, 18].map((cy) => (
        <circle key={cy} cx="206" cy={cy} r="1.6" fill={C.TEXT_COLOR} />
      ))}
      <path d="M184 29v4" stroke={C.TEXT_COLOR} strokeWidth="1.5" />
      <rect
        x="120.5"
        y="33.5"
        width="86"
        height="80"
        fill={C.PRIMARY_COLOR}
        stroke={C.TEXT_COLOR}
        strokeWidth="1.5"
      />
      <rect x="121" y="34" width="85" height="11" fill={C.SELECTION_COLOR} />
      <rect x="127" y="38" width="30" height="3" fill={C.TEXT_COLOR} />
      {[
        [52, 60],
        [62, 48],
        [72, 66],
        [82, 42],
        [92, 56],
      ].map(([y, width]) => (
        <rect
          key={y}
          x="127"
          y={y}
          width={width}
          height="3"
          fill={C.LABEL_L2_COLOR}
        />
      ))}
    </svg>
  );
}

export function FullViewArt() {
  const C = useThemeColors();
  return (
    <svg
      viewBox="0 0 220 120"
      aria-hidden="true"
      focusable="false"
      css={artStyle}
    >
      <rect
        x="0.5"
        y="0.5"
        width="219"
        height="26"
        fill={C.SELECTION_COLOR}
        stroke={C.BORDER_COLOR}
      />
      <path
        d="M8 26V10q0-3 3-3h52q3 0 3 3v16z"
        fill={C.PRIMARY_COLOR}
        stroke={C.TEXT_COLOR}
        strokeWidth="1.2"
      />
      <rect x="14" y="14" width="30" height="3" fill={C.TEXT_COLOR} />
      <path d="M56 12l5 5m0-5l-5 5" stroke={C.TEXT_COLOR} strokeWidth="1" />
      <rect
        x="0.5"
        y="26.5"
        width="219"
        height="93"
        fill={C.PRIMARY_COLOR}
        stroke={C.BORDER_COLOR}
      />
      <rect
        x="8.5"
        y="34.5"
        width="62"
        height="78"
        fill={C.PRIMARY_COLOR}
        stroke={C.TEXT_COLOR}
        strokeWidth="1.2"
      />
      <rect x="14" y="42" width="30" height="3" fill={C.TEXT_COLOR} />
      {[
        [54, 44],
        [64, 36],
        [74, 46],
      ].map(([y, width]) => (
        <rect
          key={y}
          x="14"
          y={y}
          width={width}
          height="3"
          fill={C.LABEL_L2_COLOR}
        />
      ))}
      <rect
        x="76.5"
        y="34.5"
        width="135"
        height="78"
        fill={C.PRIMARY_COLOR}
        stroke={C.TEXT_COLOR}
        strokeWidth="1.2"
      />
      <rect x="77" y="35" width="134" height="11" fill={C.SELECTION_COLOR} />
      <rect x="83" y="39" width="40" height="3" fill={C.TEXT_COLOR} />
      {[
        [54, 100],
        [64, 84],
        [74, 110],
        [84, 72],
        [94, 94],
      ].map(([y, width]) => (
        <rect
          key={y}
          x="83"
          y={y}
          width={width}
          height="3"
          fill={C.LABEL_L2_COLOR}
        />
      ))}
    </svg>
  );
}
