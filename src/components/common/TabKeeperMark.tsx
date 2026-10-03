import { useId } from 'react';
import { css } from '@emotion/react';

import { ICON } from '../../styles/scale';

const markStyle = css`
  display: block;
  width: ${ICON.SMALL};
  height: ${ICON.SMALL};
`;

// Inline, not an <img>, so the shutter can be animated.
export default function TabKeeperMark() {
  // Two marks on a page must not share one id.
  const bodyId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
      css={markStyle}
    >
      <rect width="128" height="128" fill="#99bf9d" fillOpacity="0.6" />
      <path
        id={bodyId}
        d="M15.2 12.6h12.4v3l5 1.3V13h66.6l14.5 14.5v84.3H15.2z"
      />
      <use href={`#${bodyId}`} x="1.7" y="3.6" fill="#253038" />
      <use href={`#${bodyId}`} fill="#445562" />
      <rect
        x="32.8"
        y="12.9"
        width="58.4"
        height="36.6"
        rx="1.5"
        fill="#222636"
      />
      <rect
        x="32.8"
        y="12.9"
        width="58.4"
        height="34.7"
        rx="1.5"
        fill="#f4eae2"
      />
      <rect x="32.9" y="64.8" width="62.5" height="47" rx="2" fill="#f4eae2" />
      <g fill="#20292e">
        <rect
          data-mark-part="shutter"
          x="71.3"
          y="18.4"
          width="15.3"
          height="26.6"
          rx="1"
        />
        <path d="M42.9 73.8h42.8v7.3H42.9zM20 100.9h5.1v4H20zm81.8-4.6h8.5v10.2h-8.5z" />
      </g>
      <path fill="#d09263" d="M42.9 87.1h42.8v7.5H42.9zm0 12h42.8v7.3H42.9z" />
    </svg>
  );
}
