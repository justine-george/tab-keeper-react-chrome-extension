import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { NormalLabel } from "../common/Label";
import { nonInteractIconStyle } from "../../utils/constants";
import { useThemeColors } from "../hook/useThemeColors";

export default function HeroContainerRightSettings() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    flex-direction: row;
    align-items: center;
    // justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: "Libre Franklin", sans-serif;
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
    padding: 8px 8px;
  `;

  return (
    <div css={containerStyle}>
      <Icon type="settings" style={nonInteractIconStyle} />
      <NormalLabel
        value="Settings"
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 4px;"
      />
    </div>
  );
}
