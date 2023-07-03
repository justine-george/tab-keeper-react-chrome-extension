import { css } from "@emotion/react";
import HeroContainer from "./HeroContainer";
import UserInputContainer from "./UserInputContainer";
import TabGroupEntryContainer from "./TabGroupEntryContainer";

export default function LeftPane() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 0 8px;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <HeroContainer />
      <UserInputContainer />
      <TabGroupEntryContainer />
    </div>
  );
}
