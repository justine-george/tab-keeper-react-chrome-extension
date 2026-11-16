import { useId } from 'react';
import { css } from '@emotion/react';

import TabKeeperMark from '../common/TabKeeperMark';
import { useThemeColors } from '../../hooks/useThemeColors';

// KAN-7 §5 step 3. The two views in miniature, after the round-5 mock.

// KAN-905. Tab Keeper's parts rounded as the app is, in viewBox units; the
// browser around them is Chrome's and stays square.
const ART_RADIUS = {
  POPUP: 6,
  PANE: 5,
  FIELD: 4,
  // Chrome's address bar is a pill: half its 14 height.
  ADDRESS: 7,
  ROW: 3,
  OUTLINE: 4,
} as const;
// A line of "text": round-ended.
const lineRx = (height: number) => height / 2;

const artStyle = css`
  display: block;
  width: 100%;
  height: auto;
`;

export function CompactViewArt() {
  const C = useThemeColors();
  const clip = useId();
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
        rx={ART_RADIUS.ADDRESS}
        fill={C.PRIMARY_COLOR}
        stroke={C.PANEL_BORDER_COLOR}
      />
      <rect
        x="176"
        y="5"
        width="16"
        height="16"
        rx={ART_RADIUS.OUTLINE}
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
      <g data-art-part="popup">
        <clipPath id={clip}>
          <rect
            x="120.5"
            y="33.5"
            width="86"
            height="80"
            rx={ART_RADIUS.POPUP}
          />
        </clipPath>
        <rect
          x="120.5"
          y="33.5"
          width="86"
          height="80"
          rx={ART_RADIUS.POPUP}
          fill={C.PRIMARY_COLOR}
        />
        <rect
          data-art-part="header"
          x="121"
          y="34"
          width="85"
          height="11"
          fill={C.SELECTION_COLOR}
          clipPath={`url(#${clip})`}
        />
        <rect
          x="127"
          y="38"
          width="30"
          height="3"
          rx={lineRx(3)}
          fill={C.TEXT_COLOR}
        />
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
            rx={lineRx(3)}
            fill={C.LABEL_L2_COLOR}
          />
        ))}
        {/* The frame over its contents, so the header meets its stroke. */}
        <rect
          data-art-part="frame"
          x="120.5"
          y="33.5"
          width="86"
          height="80"
          rx={ART_RADIUS.POPUP}
          fill="none"
          stroke={C.TEXT_COLOR}
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}

// KAN-628. Tab Keeper's own tab, outlined as the compact picture outlines its icon, and the full view as it is.
export function FullViewArt() {
  const C = useThemeColors();
  const clip = useId();
  const line = (x: number, y: number, width: number, fill: string, h = 3) => (
    <rect
      key={`${x}-${y}`}
      x={x}
      y={y}
      width={width}
      height={h}
      rx={lineRx(h)}
      fill={fill}
    />
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
          data-art-part="frame"
          x="8.5"
          y="33.5"
          width="74"
          height="80"
          rx={ART_RADIUS.PANE}
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
          data-art-part="search"
          x="13.5"
          y="48.5"
          width="64"
          height="8"
          rx={ART_RADIUS.FIELD}
          fill="none"
          stroke={C.PANEL_BORDER_COLOR}
        />
        {/* Set in from the pane's sides, as the app's highlight is. */}
        <rect
          data-art-part="selected"
          x="11.5"
          y="61"
          width="68"
          height="14"
          rx={ART_RADIUS.ROW}
          fill={C.SELECTION_COLOR}
        />
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
        <clipPath id={clip}>
          <rect
            x="88.5"
            y="33.5"
            width="123"
            height="80"
            rx={ART_RADIUS.PANE}
          />
        </clipPath>
        <rect
          x="88.5"
          y="33.5"
          width="123"
          height="80"
          rx={ART_RADIUS.PANE}
          fill={C.PRIMARY_COLOR}
        />
        <rect
          data-art-part="header"
          x="89"
          y="34"
          width="122"
          height="11"
          fill={C.SELECTION_COLOR}
          clipPath={`url(#${clip})`}
        />
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
        {/* The frame over its contents, so the header meets its stroke. */}
        <rect
          data-art-part="frame"
          x="88.5"
          y="33.5"
          width="123"
          height="80"
          rx={ART_RADIUS.PANE}
          fill="none"
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
      </g>
    </svg>
  );
}

// KAN-862. Setup's import card, after mock r3 A1: bookmark folders ticked → a saved session with its windows.
export function BookmarksImportArt() {
  const C = useThemeColors();
  const line = (x: number, y: number, width: number, fill: string, h = 3) => (
    <rect
      key={`${x}-${y}`}
      x={x}
      y={y}
      width={width}
      height={h}
      rx={lineRx(h)}
      fill={fill}
    />
  );
  const folder = (x: number, y: number, stroke: string) => (
    <path
      key={`folder-${x}-${y}`}
      d={`M${x} ${y + 1.5}q0-1.5 1.5-1.5h3.5l1.5 2h6q1.5 0 1.5 1.5v6q0 1.5-1.5 1.5h-11q-1.5 0-1.5-1.5z`}
      fill="none"
      stroke={stroke}
      strokeWidth="1.1"
    />
  );
  const tickbox = (x: number, y: number, isTicked: boolean) => (
    <g key={`tick-${x}-${y}`} data-art-part={isTicked ? 'ticked' : 'unticked'}>
      <rect
        x={x}
        y={y}
        width="8"
        height="8"
        rx="1.8"
        fill={isTicked ? C.TEXT_COLOR : 'none'}
        stroke={C.TEXT_COLOR}
        strokeWidth="1"
      />
      {isTicked && (
        <path
          d={`M${x + 1.8} ${y + 4.2}l1.7 1.7 3-3.4`}
          fill="none"
          stroke={C.PRIMARY_COLOR}
          strokeWidth="1.2"
        />
      )}
    </g>
  );
  const browserWindow = (x: number, y: number) => (
    <g key={`window-${y}`} data-art-part="window">
      <rect
        x={x}
        y={y}
        width="11"
        height="8"
        rx="1.2"
        fill="none"
        stroke={C.TEXT_COLOR}
        strokeWidth="1"
      />
      <path d={`M${x} ${y + 2.4}h11`} stroke={C.TEXT_COLOR} strokeWidth="1" />
    </g>
  );
  // A ticked folder, the subfolder its tick covers, then two left unticked.
  const rows: [number, number, boolean, string, number][] = [
    [40, 43, true, C.TEXT_COLOR, 58],
    [54, 62, true, C.LABEL_L2_COLOR, 34],
    [40, 80, false, C.TEXT_COLOR, 44],
    [40, 96, false, C.TEXT_COLOR, 28],
  ];
  return (
    <svg
      viewBox="0 0 440 120"
      aria-hidden="true"
      focusable="false"
      css={artStyle}
    >
      <rect
        x="0.5"
        y="0.5"
        width="439"
        height="119"
        fill={C.PRIMARY_COLOR}
        stroke={C.PANEL_BORDER_COLOR}
      />
      <g data-art-part="bookmarks">
        <rect
          data-art-part="frame"
          x="24.5"
          y="12.5"
          width="160"
          height="96"
          rx={ART_RADIUS.PANE}
          fill={C.PRIMARY_COLOR}
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
        {folder(32, 22, C.TEXT_COLOR)}
        {line(52, 25.5, 50, C.TEXT_COLOR)}
        <rect
          data-art-part="selected"
          x="28"
          y="38"
          width="153"
          height="18"
          rx={ART_RADIUS.ROW}
          fill={C.SELECTION_COLOR}
        />
        {rows.flatMap(([x, y, isTicked, ink, width]) => [
          tickbox(x, y, isTicked),
          folder(x + 13, y - 1, ink),
          line(x + 33, y + 2.5, width, ink),
        ])}
      </g>
      <g data-art-part="arrow">
        <path d="M200 60h40" stroke={C.TEXT_COLOR} strokeWidth="1.4" />
        <path
          d="M234 54l7 6-7 6"
          fill="none"
          stroke={C.TEXT_COLOR}
          strokeWidth="1.4"
        />
      </g>
      <g data-art-part="session">
        <rect
          data-art-part="frame"
          x="256.5"
          y="12.5"
          width="160"
          height="96"
          rx={ART_RADIUS.PANE}
          fill={C.PRIMARY_COLOR}
          stroke={C.TEXT_COLOR}
          strokeWidth="1.2"
        />
        <rect
          data-art-part="selected"
          x="260"
          y="17"
          width="153"
          height="22"
          rx={ART_RADIUS.ROW}
          fill={C.SELECTION_COLOR}
        />
        {line(266, 22, 62, C.TEXT_COLOR)}
        {line(266, 30, 40, C.LABEL_L2_COLOR, 2.4)}
        {[
          [48, 50],
          [64, 30],
          [80, 42],
        ].flatMap(([y, width]) => [
          browserWindow(268, y),
          line(286, y + 2.5, width, C.TEXT_COLOR),
        ])}
      </g>
    </svg>
  );
}
