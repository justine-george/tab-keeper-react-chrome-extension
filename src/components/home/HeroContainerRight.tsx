import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';
import { v4 as uuidv4 } from 'uuid';

import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { filterTabGroups } from '../../utils/helperFunctions';
import {
  addCurrWindowToTabGroup,
  deleteTabContainer,
  openAllTabContainer,
  updateTabGroupTitle,
  windowGroupData,
} from '../../redux/slice/tabContainerDataStateSlice';
import Button from '../common/Button';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();
  const [isEditing, setIsEditing] = useState(false);
  const [editableTitle, setEditableTitle] = useState('');

  const [isContainerHovered, setIsContainerHovered] = useState<boolean>(false);
  console.log(isContainerHovered);
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
    width: 100%;
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
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
    ${isSearchPanel && 'visibility: hidden;'}
  `;

  const { tabGroupId, title, createdTime, windowCount, tabCount } =
    selectedTabGroup;

  const handleAddCurrWindowClick = async () => {
    // fetch current window
    const windowData = await new Promise<chrome.windows.Window>((resolve) =>
      chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
    );

    // map its tabs
    let tabCount = 0;
    const tabsData = windowData.tabs!.map((tab) => {
      return {
        tabId: uuidv4(),
        favicon: tab.favIconUrl || '',
        title: tab.title || '',
        url: tab.url || '',
      };
    });

    tabCount += tabsData.length;

    const window: windowGroupData = {
      windowId: uuidv4(),
      windowHeight: windowData.height!,
      windowWidth: windowData.width!,
      windowOffsetTop: windowData.top!,
      windowOffsetLeft: windowData.left!,
      tabCount: tabsData.length,
      title: tabsData[0].title,
      tabs: tabsData,
    };

    dispatch(addCurrWindowToTabGroup({ tabGroupId, window }));
  };

  return (
    <div
      css={containerStyle}
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
    >
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
            display: flex;
            opacity: ${isContainerHovered ? 1 : 0};
            transition: opacity 0.1s ease-out;
          `}
        >
          <Button
            text="Add window"
            tooltipText="Add current window"
            ariaLabel="add current window"
            iconType="add"
            onClick={handleAddCurrWindowClick}
            iconSize="1.4rem"
            iconStyle={`
              padding: 4px;
            `}
            style={`
              border: none;
              height: 2.4rem;
              font-size: 0.8rem;
              padding: 2px 10px 0px 4px;
              background-color: ${COLORS.HOVER_COLOR};
            `}
          />
        </div>
      </div>
    </div>
  );
}
