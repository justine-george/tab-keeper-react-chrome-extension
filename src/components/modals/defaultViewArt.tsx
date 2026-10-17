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
        stroke={C.PANEL_BORDER_COLOR}
      />
      <rect
        x="8"
        y="6"
        width="130"
        height="14"
        fill={C.PRIMARY_COLOR}
        stroke={C.PANEL_BORDER_COLOR}
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

// KAN-628. Tab Keeper's own tab, outlined as the compact picture outlines its icon, and the full view as it is.
export function FullViewArt() {
  const C = useThemeColors();
  const line = (x: number, y: number, width: number, fill: string, h = 3) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={width} height={h} fill={fill} />
  );
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
        stroke={C.PANEL_BORDER_COLOR}
      />
      <g data-art-part="tab">
        <path
          d="M8 26V10q0-3 3-3h50q3 0 3 3v16z"
          fill={C.PRIMARY_COLOR}
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
        <foreignObject x="12" y="10" width="11" height="11">
          <TabKeeperMark size="11px" />
        </foreignObject>
        {line(27, 14, 22, C.TEXT_COLOR)}
        <path d="M54 12l5 5m0-5l-5 5" stroke={C.TEXT_COLOR} strokeWidth="1" />
      </g>
      <g data-art-part="tab">
        <path
          d="M70 26V12q0-3 3-3h46q3 0 3 3v14"
          fill="none"
          stroke={C.LABEL_L3_COLOR}
          strokeWidth="1"
        />
        <circle cx="80" cy="17" r="3" fill={C.LABEL_L3_COLOR} />
        {line(87, 16, 24, C.LABEL_L3_COLOR, 2.5)}
      </g>
      <rect
        x="5"
        y="4.5"
        width="62"
        height="24"
        rx="4"
        fill="none"
        stroke={C.TEXT_COLOR}
        strokeDasharray="3 2"
      />
      <rect
        x="0.5"
        y="26.5"
        width="219"
        height="93"
        fill={C.PRIMARY_COLOR}
        stroke={C.PANEL_BORDER_COLOR}
      />
      <g data-art-part="sessions">
        <rect
          x="8.5"
          y="33.5"
          width="74"
          height="80"
          fill={C.PRIMARY_COLOR}
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
        <foreignObject x="13" y="37" width="8" height="8">
          <TabKeeperMark size="8px" />
        </foreignObject>
        {line(24, 39.5, 22, C.TEXT_COLOR)}
        {[56, 63, 70].map((cx) => (
          <circle key={cx} cx={cx} cy="41" r="1.6" fill={C.LABEL_L2_COLOR} />
        ))}
        <rect
          x="13.5"
          y="48.5"
          width="64"
          height="8"
          fill="none"
          stroke={C.PANEL_BORDER_COLOR}
        />
        <rect x="13" y="61" width="65" height="14" fill={C.SELECTION_COLOR} />
        {[
          [64, 34, 22],
          [80, 40, 24],
          [94, 30, 20],
        ].flatMap(([y, title, when]) => [
          line(17, y, title, C.TEXT_COLOR),
          line(17, y + 5.5, when, C.LABEL_L2_COLOR, 2),
        ])}
      </g>
      <g data-art-part="open-now">
        <rect
          x="88.5"
          y="33.5"
          width="123"
          height="80"
          fill={C.PRIMARY_COLOR}
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
        <rect x="89" y="34" width="122" height="11" fill={C.SELECTION_COLOR} />
        {line(94, 38, 30, C.TEXT_COLOR)}
        {line(94, 51, 24, C.TEXT_COLOR)}
        {[
          [61, 78],
          [70, 62],
          [79, 88],
          [88, 54],
          [97, 70],
        ].flatMap(([y, width]) => [
          <circle
            key={`dot-${y}`}
            cx="101"
            cy={y + 1.5}
            r="2.4"
            fill={C.LABEL_L3_COLOR}
          />,
          line(107, y, width, C.LABEL_L2_COLOR),
        ])}
      </g>
    </svg>
  );
}
