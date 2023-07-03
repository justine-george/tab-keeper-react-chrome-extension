import { css } from "@emotion/react";
import Icon from "./Icon";

export default function MenuContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
      <Icon type="undo" />
      <Icon type="redo" />
      <Icon type="sync" />
      <Icon type="settings" />
    </div>
  );
}
