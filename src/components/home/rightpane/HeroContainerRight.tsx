import { useEffect, useState } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import Button from '../../common/Button';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  resolveTabUrl,
  formatGroupCounts,
  getPrettyDate,
  isSearchActive,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import {
  addCurrWindowToTabGroup,
  deleteTabContainer,
  openAllTabContainer,
  requestFocusTabContainer,
  updateTabGroupTitle,
  windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editableTitle, setEditableTitle] = useState('');
  const [currentTabName, setCurrentTabName] = useState<string>('New Tab');
  const [isContainerHovered, setIsContainerHovered] = useState<boolean>(false);
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

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.title) {
        setCurrentTabName(currentTab.title);
      } else {
        setCurrentTabName('New Tab');
      }
    });
  }, []);

  // the same list RightPane derives its mount guard from
  const selectedTabGroup = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    isSearchPanel,
    searchInputText
  )[0];

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-16).
  // It sits below every hook deliberately: an early return above the useEffect
  // that reads the current tab name would change the hook count between the
  // nothing-selected and selected renders, and React throws "Rendered more
  // hooks than during the previous render" on that transition.
  if (!selectedTabGroup) return null;

  // `editableTitle` is a DRAFT: nothing reads it unless `isEditing` is true, so
  // it is seeded at the moment editing starts rather than kept in step with the
  // prop by an effect.
  //
  // The effect this replaces depended on the whole selectedTabGroup object, so
  // any change to the selected session re-seeded the draft -- including changes
  // the user did not make. customMiddleware dispatches syncStateWithFirestore()
  // with no user action, and the merge lands replaceState(merged), so a sync
  // tick arriving mid-rename threw away what had been typed. KAN-51.
  const startEditing = () => {
    setEditableTitle(selectedTabGroup.title);
    setIsEditing(true);
  };

  const handleTabGroupTitleClick = () => {
    if (!isSearchPanel) {
      startEditing();
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

  const { tabGroupId, title, createdTime, createdAt, windowCount, tabCount } =
    selectedTabGroup;

  const handleAddCurrWindowClick = async () => {
    // fetch current window
    const windowData = await new Promise<chrome.windows.Window>((resolve) =>
      chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
    );

    // map its tabs
    const tabsData = windowData.tabs!.map((tab) => {
      return {
        tabId: uuidv4(),
        favicon: tab.favIconUrl || '',
        title: tab.title || '',
        url: resolveTabUrl(tab.url || ''),
      };
    });

    const window: windowGroupData = {
      windowId: uuidv4(),
      windowHeight: windowData.height!,
      windowWidth: windowData.width!,
      windowOffsetTop: windowData.top!,
      windowOffsetLeft: windowData.left!,
      tabCount: tabsData.length,
      title: currentTabName,
      tabs: tabsData,
    };

    dispatch(addCurrWindowToTabGroup({ tabGroupId, window }));
  };

  function handleKeyPressOnEditTitle(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleBlur();
    }
  }

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
    width: 100%;
  `;

  const topStyle = css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `;

  const bottomStyle = css`
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
    ${isSearchPanel && 'visibility: hidden;'}
  `;

  return (
    <div
      css={containerStyle}
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
    >
      <div css={topStyle}>
        <div
          css={css`
            position: relative;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            width: 100%;
          `}
        >
          {isEditing && !isSearchPanel ? (
            <input
              value={editableTitle}
              onBlur={handleBlur}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyPressOnEditTitle(e)}
              autoFocus
              css={css`
                color: ${COLORS.TEXT_COLOR};
                background-color: ${COLORS.PRIMARY_COLOR};
                border: 1px solid ${COLORS.BORDER_COLOR};
                display: flex;
                align-items: center;
                font-family: ${FONT_FAMILY};
                font-size: 1.125rem;
                height: 32px;
                padding-left: 8px;
                padding-right: 8px;
                flex-grow: 1;
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
              style="height: 32px; padding-left: 8px; margin-right: 8px;"
              onClick={handleTabGroupTitleClick}
            />
          )}
          <div
            css={css`
              position: absolute;
              top: 50%;
              right: 0;
              transform: translateY(-50%);
              opacity: ${isContainerHovered ? 1 : 0};
              transition: opacity 0.1s ease-out;
              /* The keyboard's equivalent of the hover reveal (KAN-68). */
              &:focus-within {
                opacity: 1;
              }
              ${isSearchPanel && 'visibility: hidden;'}
            `}
          >
            {!isEditing && !isSearchPanel && (
              <Icon
                tooltipText={t('Rename session')}
                ariaLabel="rename session"
                type="edit"
                backgroundColor={COLORS.SECONDARY_COLOR}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing();
                }}
              />
            )}
          </div>
        </div>
        <NormalLabel
          value={formatGroupCounts(
            windowCount,
            tabCount,
            isSearchActive(isSearchPanel, searchInputText),
            t
          )}
          size="0.75rem"
          color={COLORS.LABEL_L1_COLOR}
          style={`padding-top: 2px; padding-left: 8px;`}
        />
        <NormalLabel
          // createdAt is the instant; createdTime is a local wall clock with no
          // offset, kept only for sessions saved before createdAt existed.
          value={getPrettyDate(createdAt ?? createdTime)}
          size="0.7rem"
          color={COLORS.LABEL_L2_COLOR}
          style="padding-top: 2px; padding-left: 8px;"
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
            tooltipText={t('Open session')}
            ariaLabel="open all windows"
            type="reopen_window"
            onClick={() => {
              const goToURLText: string = t('Go to URL');
              dispatch(openAllTabContainer({ tabGroupId, goToURLText }));
            }}
          />
          <Icon
            tooltipText={t('Switch to session')}
            ariaLabel="switch to session"
            type="filter_center_focus"
            onClick={() => {
              dispatch(
                requestFocusTabContainer({
                  tabGroupId,
                  goToURLText: t('Go to URL'),
                  saveTitle: t('FocusAutoSaveTitle'),
                })
              );
            }}
          />
          <Icon
            tooltipText={t('Delete session')}
            ariaLabel="delete session"
            type="delete"
            onClick={() => dispatch(deleteTabContainer(tabGroupId))}
          />
        </div>
        <div
          css={css`
            display: flex;
          `}
        >
          <Button
            text={t('Add window')}
            tooltipText={t('Add current window')}
            ariaLabel="add current window"
            iconType="add"
            onClick={handleAddCurrWindowClick}
            iconSize="1.3rem"
            iconStyle={`
              padding: 4px 4px 2px 4px;
            `}
            style={`
              border: none;
              height: 32px;
              font-size: 0.8rem;
              padding: 4px 9px 3px 2px;
              background-color: ${COLORS.HOVER_COLOR || '#e3e6e9'};
            `}
          />
        </div>
      </div>
    </div>
  );
}
