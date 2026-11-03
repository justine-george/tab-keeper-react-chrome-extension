import { useId } from 'react';
import { css } from '@emotion/react';

import { ICON } from '../../styles/scale';
import { MARK_BODY_PATH, MARK_RADIUS } from './markShape';

// Inline, not an <img>, so the shutter can be animated. KAN-7 draws it larger in the pin guide.
export default function TabKeeperMark({
  size = ICON.SMALL,
}: {
  size?: string;
}) {
  // Two marks on a page must not share one id.
  const bodyId = useId();
  const markStyle = css`
    display: block;
    flex-shrink: 0;
    width: ${size};
    height: ${size};
  `;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
      css={markStyle}
    >
      <rect
        width="128"
        height="128"
        rx={MARK_RADIUS.GROUND}
        fill="#99bf9d"
        fillOpacity="0.6"
      />
      <path id={bodyId} d={MARK_BODY_PATH} />
      <use href={`#${bodyId}`} x="1.7" y="3.6" fill="#253038" />
      <use href={`#${bodyId}`} fill="#445562" />
      {/* KAN-627. The slot is cut into the shutter, so the two slide as one. */}
      <g data-mark-part="shutter">
        <rect
          x="32.8"
          y="12.9"
          width="58.4"
          height="36.6"
          rx={MARK_RADIUS.SHUTTER}
          fill="#222636"
        />
        <rect
          x="32.8"
          y="12.9"
          width="58.4"
          height="34.7"
          rx={MARK_RADIUS.SHUTTER}
          fill="#f4eae2"
        />
        <rect
          data-mark-part="slot"
          x="71.3"
          y="18.4"
          width="15.3"
          height="26.6"
          rx={MARK_RADIUS.SLOT}
          fill="#20292e"
        />
      </g>
      <rect
        x="32.9"
        y="64.8"
        width="62.5"
        height="47"
        rx={MARK_RADIUS.LABEL}
        fill="#f4eae2"
      />
      <path
        fill="#20292e"
        d="M42.9 73.8h42.8v7.3H42.9zM20 100.9h5.1v4H20zm81.8-4.6h8.5v10.2h-8.5z"
      />
      <path fill="#d09263" d="M42.9 87.1h42.8v7.5H42.9zm0 12h42.8v7.3H42.9z" />
    </svg>
  );
}
