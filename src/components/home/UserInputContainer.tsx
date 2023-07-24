import { css } from "@emotion/react";
import Button from "../common/Button";
import TextBox from "../common/TextBox";

export default function UserInputContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  return (
    <div css={containerStyle}>
      <TextBox
        id="name"
        name="name"
        placeholder="New Group"
        autoComplete="off"
        style="margin-right: 8px;"
      />
      <Button text="Add" />
    </div>
  );
}
