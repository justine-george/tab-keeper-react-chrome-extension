import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { Tag } from '../common/Tag';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { filterTabGroups } from '../../utils/helperFunctions';
import {
  deleteTabContainer,
  openAllTabContainer,
  updateTabGroupTitle,
} from '../../redux/slice/tabContainerDataStateSlice';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();
  const [isEditing, setIsEditing] = useState(false);
  const [editableTitle, setEditableTitle] = useState('');

  const dispatch: AppDispatch = useDispatch();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  const searchInputText = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );

  let filteredTabGroups = tabContainerDataList.tabGroups.filter(
    (tabGroup) => tabGroup.isSelected
  );
  if (isSearchPanel && searchInputText) {
    filteredTabGroups = filterTabGroups(searchInputText, filteredTabGroups);
  }
  const selectedTabGroup = filteredTabGroups[0];

  useEffect(() => {
    setEditableTitle(selectedTabGroup.title);
  }, [selectedTabGroup]);

  const handleTabGroupTitleClick = () => {
    if (!isSearchPanel) {
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (selectedTabGroup.title !== editableTitle) {
      dispatch(updateTabGroupTitle({ tabGroupId, editableTitle }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditableTitle(e.target.value);
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: 'Libre Franklin', sans-serif;
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
  `;

  const topStyle = css`
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 8px;
    padding-bottom: unset;
  `;

  const bottomStyle = css`
    display: flex;
    margin-top: '12px'
    width: 100%;
    align-items: center;
  `;

  const { tabGroupId, title, createdTime, windowCount, tabCount, isAutoSave } =
    selectedTabGroup;

  return (
    <div css={containerStyle}>
      <div css={topStyle}>
        {isEditing && !isSearchPanel ? (
          <input
            value={editableTitle}
            onBlur={handleBlur}
            onChange={handleChange}
            autoFocus
            css={css`
              color: ${COLORS.TEXT_COLOR};
              background-color: ${COLORS.PRIMARY_COLOR};
              border: 1px solid ${COLORS.BORDER_COLOR};
              display: flex;
              align-items: center;
              font-family: 'Libre Franklin', sans-serif;
              font-size: 1.1rem;
              &:focus {
                outline: none;
              }
            `}
          />
        ) : (
          <NormalLabel
            tooltipText={title}
            value={title}
            size="1.125rem"
            color={COLORS.TEXT_COLOR}
            style="height: 21px;"
            onClick={handleTabGroupTitleClick}
          />
        )}
        <NormalLabel
          value={`${windowCount} ${
            windowCount > 1 ? 'Windows' : 'Window'
          } - ${tabCount} ${tabCount > 1 ? 'Tabs' : 'Tab'}`}
          size="0.75rem"
          color={COLORS.LABEL_L1_COLOR}
          style={`padding-top: ${isEditing ? '2px' : '6px'};`}
        />
        <NormalLabel
          value={createdTime}
          size="0.7rem"
          color={COLORS.LABEL_L2_COLOR}
          style="padding-top: 2px;"
        />
      </div>
      <div css={bottomStyle}>
        <div
          css={css`
            display: flex;
            padding-top: 8px;
            ${isSearchPanel && 'visibility: hidden'}
          `}
        >
          <Icon
            tooltipText="Open in new window"
            ariaLabel="open all windows"
            type="open_in_new"
            onClick={() => dispatch(openAllTabContainer(tabGroupId))}
          />
          <Icon
            tooltipText="Delete"
            ariaLabel="delete"
            type="delete"
            onClick={() => dispatch(deleteTabContainer(tabGroupId))}
          />
        </div>
        <div
          css={css`
            padding-left: 8px;
          `}
        >
          {isAutoSave && <Tag value="AUTOSAVE" style="padding: 4px 8px;" />}
        </div>
      </div>
    </div>
  );
}
