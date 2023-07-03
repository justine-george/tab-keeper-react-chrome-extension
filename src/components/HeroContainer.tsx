import { css } from "@emotion/react";
import MenuContainer from "./MenuContainer";

export default function HeroContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    height: 60px;
    // border: 1px solid black;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    font-size: 1.25rem;
  `;

  return (
    <div css={containerStyle}>
      <div>Tab Keeper</div>
      <div>
        <MenuContainer />
      </div>
    </div>
  );
}
