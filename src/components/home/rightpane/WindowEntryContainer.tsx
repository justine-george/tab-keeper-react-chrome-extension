import React, { MouseEventHandler, useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { decodeDataUrl } from '../../../utils/functions/local';
import { NON_INTERACTIVE_ICON_STYLE } from '../../../utils/constants/common';
import {
  deleteTab,
  tabData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

interface WindowEntryContainerProps {
  title: string;
  tabs: tabData[];
  tabGroupId: string;
  windowId: string;
  onWindowTitleClick: MouseEventHandler;
  onUpdateWindowGroupTitle: (newTitle: string) => void;
  onAddCurrTabToWindowClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
  tabGroupId,
  windowId,
  onWindowTitleClick,
  onUpdateWindowGroupTitle,
  onAddCurrTabToWindowClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();

  const dispatch: AppDispatch = useDispatch();

  const [windowOpenState, setWindowOpenState] = useState(true);
  const [newTitle, setNewTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);
  const [isParentHovered, setIsParentHovered] = useState(false);
  const [hoveredChildIndex, setHoveredChildIndex] = useState<number | null>(
    null
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  // reset the 'windowOpenState' to true whenever a different tabGroup is selected.
  useEffect(() => {
    setWindowOpenState(true);
  }, [tabGroupId]);

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    font-family: ${FONT_FAMILY};
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    transition: background-color 0.2s;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const parentLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
  `;

  const parentRightStyle = css`
    display: flex;
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: ${isParentHovered ? 1 : 0};
    transition: opacity 0.1s ease-out;
    ${isSearchPanel && 'visibility: hidden;'}
  `;

  const childrenContainerStyle = css`
    padding-left: 70px;
  `;

  const childrenStyle = css`
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    transition: background-color 0.2s;
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
  `;

  const childLeftStyle = css`
    display: flex;
    align-items: center;
    flex-grow: 1;
  `;

  const childRightStyle = (index: number) => css`
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: ${hoveredChildIndex === index ? 1 : 0};
    transition: opacity 0.1s ease-out;
  `;

  const parentLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    padding-right: 9px;
    ${!isSearchPanel && 'cursor: pointer;'}
  `;

  const windowChildLinkStyle = css`
    text-decoration: none;
    color: inherit;
    display: flex;
    align-items: center;
    height: 100%;
    flex-grow: 1;
    margin-left: 4px;
    margin-right: 4px;
    cursor: pointer;
  `;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewTitle(e.target.value);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (title !== newTitle) {
      onUpdateWindowGroupTitle(newTitle);
    }
  };

  const handleWindowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isSearchPanel && !isEditing) {
      onWindowTitleClick(e);
    }
  };

  const handleTabClick = (url: string) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTabIndex = tabs[0].index;
      chrome.tabs.create({
        url: decodeDataUrl(url),
        active: true,
        index: currentTabIndex + 1,
      });
    });
  };

  function handleAccordionClick() {
    setWindowOpenState((state) => !state);
  }

  function handleKeyPressOnWindow(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleWindowClick(e as any);
    }
  }

  function handleKeyPressOnEditDone(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleBlur();
    }
  }

  function handleKeyPressOnTab(
    e: React.KeyboardEvent<HTMLDivElement>,
    url: string
  ) {
    if (e.key === 'Enter') {
      handleTabClick(url);
    }
  }

  return (
    <div css={containerStyle}>
      <div
        css={parentStyle}
        onMouseEnter={() => setIsParentHovered(true)}
        onMouseLeave={() => setIsParentHovered(false)}
      >
        <div css={parentLeftStyle}>
          <Icon
            tooltipText={windowOpenState ? t('Collapse') : t('Expand')}
            ariaLabel={windowOpenState ? 'collapse' : 'expand'}
            type={windowOpenState ? 'expand_less' : 'expand_more'}
            onClick={handleAccordionClick}
          />
          <Icon type="web_asset" style={NON_INTERACTIVE_ICON_STYLE} />
          <div
            css={parentLinkStyle}
            tabIndex={0}
            onClick={(e) => handleWindowClick(e)}
            onKeyDown={(e) => handleKeyPressOnWindow(e)}
            title={!isSearchPanel ? t('Open in new window') : undefined}
          >
            {isEditing && !isSearchPanel ? (
              <input
                value={newTitle}
                onBlur={handleBlur}
                onChange={handleChange}
                onKeyDown={(e) => handleKeyPressOnEditDone(e)}
                autoFocus
                css={css`
                  color: ${COLORS.TEXT_COLOR};
                  background-color: ${COLORS.PRIMARY_COLOR};
                  border: 1px solid ${COLORS.BORDER_COLOR};
                  display: flex;
                  align-items: center;
                  font-family: ${FONT_FAMILY};
                  font-size: 0.9rem;
                  padding-left: 8px;
                  height: 100%;
                  width: 310px;
                  &:focus {
                    outline: none;
                  }
                `}
              />
            ) : (
              <NormalLabel
                value={title}
                color={COLORS.TEXT_COLOR}
                size="0.9rem"
                style={`
                padding-left: 8px;
                ${!isSearchPanel && 'cursor: pointer'};
                height: 100%; max-width: 330px;`}
              />
            )}
          </div>
        </div>
        <div css={parentRightStyle}>
          {isEditing && !isSearchPanel ? (
            <Icon
              tooltipText="Save changes"
              ariaLabel="save changes"
              type="done"
              backgroundColor={COLORS.HOVER_COLOR}
              onClick={(e) => {
                e.stopPropagation();
                handleBlur();
              }}
              focusable={isParentHovered}
            />
          ) : (
            <Icon
              tooltipText={t('Rename window group')}
              ariaLabel="rename window group"
              type="edit"
              backgroundColor={COLORS.HOVER_COLOR}
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              focusable={isParentHovered}
            />
          )}

          {!isEditing && !isSearchPanel && (
            <Icon
              tooltipText={t('Add current tab')}
              ariaLabel="add current tab"
              type="add"
              backgroundColor={COLORS.HOVER_COLOR}
              onClick={(e) => {
                e.stopPropagation();
                onAddCurrTabToWindowClick(e);
              }}
              focusable={isParentHovered}
            />
          )}
          {!isEditing && !isSearchPanel && (
            <Icon
              tooltipText={t('Delete window group')}
              ariaLabel="delete window group"
              type="delete"
              backgroundColor={COLORS.HOVER_COLOR}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClick(e);
              }}
              focusable={isParentHovered}
            />
          )}
        </div>
      </div>
      {windowOpenState && (
        <div css={childrenContainerStyle}>
          {tabs.map(({ tabId, favicon, title, url }, index) => {
            return (
              <div
                css={childrenStyle}
                onMouseEnter={() => setHoveredChildIndex(index)}
                onMouseLeave={() => setHoveredChildIndex(null)}
              >
                <div
                  css={childLeftStyle}
                  tabIndex={0}
                  onClick={() => handleTabClick(url)}
                  onKeyDown={(e) => handleKeyPressOnTab(e, url)}
                  title={t('Open in new tab') + ': ' + title}
                >
                  <Icon
                    faviconUrl={favicon}
                    type="globe"
                    style={`&:hover {background-color: unset;}`}
                  />
                  <div css={windowChildLinkStyle}>
                    <NormalLabel
                      value={title}
                      color={COLORS.TEXT_COLOR}
                      size="0.9rem"
                      style="padding-left: 4px; height: 100%; max-width: 289px;"
                    />
                  </div>
                </div>
                <div css={childRightStyle(index)}>
                  <Icon
                    tooltipText={t('Delete tab')}
                    ariaLabel="delete"
                    type="delete"
                    backgroundColor={COLORS.HOVER_COLOR}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(deleteTab({ tabGroupId, windowId, tabId }));
                    }}
                    focusable={hoveredChildIndex === index}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WindowEntryContainer;
