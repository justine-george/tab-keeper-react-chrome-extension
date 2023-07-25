import { css } from "@emotion/react";
import { useDispatch } from "react-redux";
import Icon from "../common/Icon";
import { NormalLabel } from "../common/Label";
import { openSettingsPage } from "../../redux/slice/globalStateSlice";
import { useThemeColors } from "../hook/useThemeColors";

export default function MenuContainer() {
  const COLORS = useThemeColors();

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
    align-items: center;
  `;

  const dispatch = useDispatch();

  return (
    <div css={containerStyle}>
      <Icon type="arrow_back" onClick={() => dispatch(openSettingsPage())} />
      <NormalLabel
        value="Back"
        size="1.125rem"
        color={COLORS.TEXT_COLOR}
        style="padding-left: 8px;"
      />
    </div>
  );
}
