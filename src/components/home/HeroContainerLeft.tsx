import { css } from "@emotion/react";
import MenuContainer from "./MenuContainer";
import { useThemeColors } from "../hook/useThemeColors";
import { NormalLabel } from "../common/Label";

export default function HeroContainer() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    height: 60px;
    align-items: center;
    font-family: "Libre Franklin", sans-serif;
    font-size: 1.25rem;
    padding: 16px 0px;
    user-select: none;
  `;

  return (
    <div css={containerStyle}>
      <NormalLabel
        value="Tab Keeper"
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
      />
      <div>
        <MenuContainer />
      </div>
    </div>
  );
}
