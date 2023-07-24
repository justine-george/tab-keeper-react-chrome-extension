import { css } from "@emotion/react";
import HeroContainerRight from "./HeroContainerRight";
import TabGroupDetailsContainer from "./TabGroupDetailsContainer";

export default function RightPane() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainerRight />
      <TabGroupDetailsContainer />
    </div>
  );
}
