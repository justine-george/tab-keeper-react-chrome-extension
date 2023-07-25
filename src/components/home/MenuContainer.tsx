import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { useDispatch } from "react-redux";
import { openSettingsPage } from "../../redux/slice/globalStateSlice";

export default function MenuContainer() {
  const dispatch = useDispatch();

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon type="undo" />
      <Icon type="redo" />
      <Icon type="sync" />
      <Icon type="settings" onClick={() => dispatch(openSettingsPage())} />
    </div>
  );
}
