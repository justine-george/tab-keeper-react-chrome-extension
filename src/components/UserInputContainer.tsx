import { css } from "@emotion/react";
import { Button, TextInput } from "../utils/CustomElements";

export default function UserInputContainer() {
  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  return (
    <div css={containerStyle}>
      <TextInput
        css={css`
          margin-right: 8px;
        `}
        type="text"
        id="name"
        name="name"
        placeholder="New Group"
        autoComplete="off"
      />
      <Button>Add</Button>
    </div>
  );
}
