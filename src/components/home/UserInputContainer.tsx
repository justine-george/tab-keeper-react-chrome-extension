import { css } from '@emotion/react';
import Button from '../common/Button';
import TextBox from '../common/TextBox';
import { useDispatch } from 'react-redux';
import { useState } from 'react';
import { saveToTabContainer } from '../../redux/slice/tabContainerDataStateSlice';
import { AppDispatch } from '../../redux/store';

export default function UserInputContainer() {
  const dispatch: AppDispatch = useDispatch();

  const [newTitle, setNewTitle] = useState<string>('');

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  function updateUserInput(e: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(e.target.value);
  }

  function createTabGroup() {
    dispatch(saveToTabContainer(newTitle));
    setNewTitle('');
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
        onKeyEnter={createTabGroup}
        style="margin-right: 8px;"
      />
      <Button text="Add" onClick={createTabGroup} />
    </div>
  );
}
