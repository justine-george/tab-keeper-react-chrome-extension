import { css } from "@emotion/react";

export default function Divider() {
  const containerStyle = css`
    border-bottom: 1px solid black;
  `;

  return <div css={containerStyle}></div>;
}
