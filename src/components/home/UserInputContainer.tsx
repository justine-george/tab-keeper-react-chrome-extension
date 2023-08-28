import { css } from '@emotion/react';
import Button from '../common/Button';
import TextBox from '../common/TextBox';
import { useDispatch, useSelector } from 'react-redux';
import { useState } from 'react';
import { saveToTabContainer } from '../../redux/slice/tabContainerDataStateSlice';
import { AppDispatch, RootState } from '../../redux/store';
import { setSearchInputText } from '../../redux/slice/globalStateSlice';

export default function UserInputContainer() {
  const dispatch: AppDispatch = useDispatch();

  const [newTitle, setNewTitle] = useState<string>('Youtube - Home');
  const [searchInput, setSearchInput] = useState<string>('');

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  function updateUserInput(e: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(e.target.value);
  }

  function handleSearchInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchInput(e.target.value);
    dispatch(setSearchInputText(e.target.value));
  }

  function filterResults() {
    // dispatch(setSearchInputText(searchInput));
  }

  function createTabGroup() {
    dispatch(saveToTabContainer(newTitle));
  }

  return isSearchPanel ? (
    <div css={containerStyle}>
      <TextBox
        id="searchInput"
        name="searchInput"
        value={searchInput}
        placeholder="Search tab groups"
        autoComplete="off"
        onChange={handleSearchInputChange}
        onKeyEnter={filterResults}
        style="margin-right: 8px;"
      />
      {/* <Button text="Search" onClick={createTabGroup} /> */}
      <Button
        iconType="search"
        onClick={filterResults}
        style="padding: 12px;"
      />
    </div>
  ) : (
    <div css={containerStyle}>
      <TextBox
        id="name"
        name="name"
        value={newTitle}
        placeholder="Save all open windows as a tab group"
        autoComplete="off"
        onChange={updateUserInput}
        onKeyEnter={createTabGroup}
        style="margin-right: 8px;"
      />
      {/* <Button text="Save" onClick={createTabGroup} /> */}
      <Button iconType="add" onClick={createTabGroup} style="padding: 12px;" />
    </div>
  );
}
