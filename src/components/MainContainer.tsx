import { css } from "@emotion/react";
import LeftPane from "./LeftPane";
import RightPane from "./RightPane";

export default function MainContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-content: center;
  `;

  return (
    <div css={containerStyle}>
      <div
        css={css`
          width: 50%;
          height: 600px;
          border: 1px solid black;
          margin: 8px 4px 8px 8px;
        `}
      >
        <LeftPane />
      </div>
      <div
        css={css`
          width: 50%;
          height: 600px;
          border: 1px solid black;
          margin: 8px 8px 8px 4px;
        `}
      >
        <RightPane />
      </div>
    </div>
  );
}
