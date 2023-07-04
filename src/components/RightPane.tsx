import { css } from "@emotion/react";

export default function RightPane() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 0 8px;
    height: 100%;
  `;
  
  return (
    <div css={containerStyle}>
      <div></div>
    </div>
  );
}
