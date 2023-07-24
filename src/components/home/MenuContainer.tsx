import { css } from "@emotion/react";
import Icon from "../common/Icon";
import { useDispatch } from "react-redux";
import { openSettingsPage } from "../slice/globalStateSlice";

export default function MenuContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  const dispatch = useDispatch();

  return (
    <div css={containerStyle}>
      <Icon type="undo" />
      <Icon type="redo" />
      <Icon type="sync" />
      <Icon type="settings" onClick={() => dispatch(openSettingsPage())} />
    </div>
  );
}
