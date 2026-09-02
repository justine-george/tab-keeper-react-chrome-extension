import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import WindowEntryContainer from './WindowEntryContainer';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  resolveTabUrl,
  isEmptyObject,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import {
  addCurrTabToWindow,
  deleteWindow,
  openTabsInAWindow,
  tabData,
  updateWindowGroupTitle,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

export default function TabGroupDetailsContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
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

  // the same list RightPane derives its mount guard from
  const selectedTabGroup = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    isSearchPanel,
    searchInputText
  )[0];

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-39).
  // Must stay below every hook: an early return above one would change the hook
  // count between renders and React would throw on the transition.
  if (!selectedTabGroup) return null;

  const tabGroupId = selectedTabGroup.tabGroupId;

  async function handleAddCurrTabToWindowClick(
    tabGroupId: string,
    windowId: string
  ) {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tabData: tabData = {
      tabId: uuidv4(),
      favicon: tab.favIconUrl || '',
      title: tab.title || '',
      url: resolveTabUrl(tab.url || ''),
    };
    dispatch(addCurrTabToWindow({ tabGroupId, windowId, tabData }));
  }

  const handleUpdateWindowGroupTitle = async (
    tabGroupId: string,
    windowId: string,
    editableTitle: string
  ) => {
    dispatch(updateWindowGroupTitle({ tabGroupId, windowId, editableTitle }));
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const emptyContainerStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  const filledContainerStyle = css``;

  return (
    <div css={containerStyle}>
      {isEmptyObject(selectedTabGroup) ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {selectedTabGroup.windows.map(({ windowId, title, tabs }) => {
            return (
              // Keyed by windowId, not by index: WindowEntryContainer owns
              // collapse and rename state, and an index key is identical to
              // the positional default React already uses, so it would leave
              // that state bleeding onto the wrong window after a deletion.
              //
              // This key is also what resets collapse state when the user
              // switches sessions. Window ids are uuidv4 minted in exactly two
              // places (capture.ts and HeroContainerRight) and nothing clones a
              // session, so no id is shared between two tab groups -- selecting
              // a different one swaps the whole key set and React remounts every
              // row, which re-runs useState(true). WindowEntryContainer used to
              // do that reset with an effect on tabGroupId; it was deleted as
              // redundant with this key (KAN-51). Weaken this key and that reset
              // goes with it -- renameDrafts.test.tsx covers it.
              <div key={windowId}>
                <WindowEntryContainer
                  title={title}
                  tabs={tabs}
                  tabGroupId={tabGroupId}
                  windowId={windowId}
                  onUpdateWindowGroupTitle={(newTitle) =>
                    handleUpdateWindowGroupTitle(tabGroupId, windowId, newTitle)
                  }
                  onAddCurrTabToWindowClick={() =>
                    handleAddCurrTabToWindowClick(tabGroupId, windowId)
                  }
                  onDeleteClick={() =>
                    dispatch(deleteWindow({ tabGroupId, windowId }))
                  }
                  onWindowTitleClick={() => {
                    const goToURLText: string = t('Go to URL');
                    dispatch(
                      openTabsInAWindow({ tabGroupId, windowId, goToURLText })
                    );
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
