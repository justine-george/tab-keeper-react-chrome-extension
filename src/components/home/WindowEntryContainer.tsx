import React, { MouseEventHandler, useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import {
  deleteTab,
  tabData,
} from '../../redux/slice/tabContainerDataStateSlice';

interface WindowEntryContainerProps {
  title: string;
  tabs: tabData[];
  tabGroupId: string;
  windowId: string;
  onWindowTitleClick: MouseEventHandler;
  onAddCurrTabToWindowClick: MouseEventHandler;
  onDeleteClick: MouseEventHandler;
}

const WindowEntryContainer: React.FC<WindowEntryContainerProps> = ({
  title,
  tabs,
  tabGroupId,
  windowId,
  onWindowTitleClick,
  onAddCurrTabToWindowClick,
  onDeleteClick,
}) => {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const [windowOpenState, setWindowOpenState] = useState(true);

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
    font-family: 'Libre Franklin', sans-serif;
    margin-bottom: 8px;
  `;

  const parentStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    transition: background-color 0.3s;
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
    transition: background-color 0.3s;
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

  const handleWindowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isSearchPanel) {
      onWindowTitleClick(e);
    }
  };

  const handleTabClick = (url: string) => {
    chrome.tabs.create({ url: url });
  };

  function handleAccordionClick() {
    setWindowOpenState((state) => !state);
  }

  function handleKeyPressOnWindow(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleWindowClick(e as any);
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
            tooltipText={windowOpenState ? 'Collapse' : 'Expand'}
            ariaLabel={windowOpenState ? 'collapse' : 'expand'}
            type={windowOpenState ? 'expand_less' : 'expand_more'}
            onClick={handleAccordionClick}
          />
          <Icon type="ad" style={NON_INTERACTIVE_ICON_STYLE} />
          <div
            css={parentLinkStyle}
            tabIndex={0}
            onClick={(e) => handleWindowClick(e)}
            onKeyDown={(e) => handleKeyPressOnWindow(e)}
            title={!isSearchPanel ? 'Open in new window' : undefined}
          >
            <NormalLabel
              value={title}
              color={COLORS.TEXT_COLOR}
              size="0.9rem"
              style={`
                padding-left: 8px;
                ${!isSearchPanel && 'cursor: pointer'};
                height: 100%; max-width: 330px;`}
            />
          </div>
        </div>
        <div css={parentRightStyle}>
          <Icon
            tooltipText="Add current tab"
            ariaLabel="add current tab"
            type="add"
            backgroundColor={COLORS.HOVER_COLOR}
            onClick={(e) => {
              e.stopPropagation();
              onAddCurrTabToWindowClick(e);
            }}
            focusable={isParentHovered}
          />
          <Icon
            tooltipText="Delete"
            ariaLabel="delete"
            type="delete"
            backgroundColor={COLORS.HOVER_COLOR}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(e);
            }}
            focusable={isParentHovered}
          />
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
                  title="Open in new tab"
                >
                  <Icon
                    faviconUrl={favicon}
                    type="app_badging"
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
                    tooltipText="Delete"
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
