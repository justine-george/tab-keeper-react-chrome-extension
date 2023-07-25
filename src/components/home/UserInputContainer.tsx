import { css } from "@emotion/react";
import Button from "../common/Button";
import TextBox from "../common/TextBox";
import { useDispatch } from "react-redux";
import { useState } from "react";
import { saveToTabContainer } from "../../redux/slice/tabContainerDataStateSlice";

export default function UserInputContainer() {
  const dispatch = useDispatch();

  const [newTitle, setNewTitle] = useState<string>("");

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  function updateUserInput(e: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(e.target.value);
  }

  function createTabGroup() {
    // TODO: this should be current window -> current tab title
    const groupName = newTitle || "New Group";

    dispatch(saveToTabContainer(groupName));
    setNewTitle("");
  }

  return (
    <div css={containerStyle}>
      <TextBox
        id="name"
        name="name"
        value={newTitle}
        placeholder="New Group"
        autoComplete="off"
        onChange={updateUserInput}
        style="margin-right: 8px;"
      />
      <Button text="Add" onClick={createTabGroup} />
    </div>
  );
}
