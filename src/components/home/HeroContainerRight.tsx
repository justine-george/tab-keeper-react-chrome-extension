import { css } from '@emotion/react';
import Icon from '../common/Icon';
import { Tag } from '../common/Tag';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../redux/store';
import {
  deleteTabContainer,
  openAllTabContainer,
} from '../../redux/slice/tabContainerDataStateSlice';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  // assumption is there is only one selected tabGroup
  const selectedTabGroup = tabContainerDataList.tabGroups.filter(
    (tabGroup) => tabGroup.isSelected
  )[0];

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
    padding: 8px;
    padding-bottom: unset;
  `;

  const bottomStyle = css`
    display: flex;
    margin-top: 12px;
    width: 100%;
    align-items: center;
  `;

  const { tabGroupId, title, createdTime, windowCount, tabCount, isAutoSave } =
    selectedTabGroup;

  return (
    <div css={containerStyle}>
      <div css={topStyle}>
        <NormalLabel
          value={title}
          size="1.125rem"
          color={COLORS.TEXT_COLOR}
          style="max-width: 350px;"
        />
        <NormalLabel
          value={`${windowCount} ${
            windowCount > 1 ? 'Windows' : 'Window'
          } - ${tabCount} ${tabCount > 1 ? 'Tabs' : 'Tab'}`}
          size="0.75rem"
          color={COLORS.LABEL_L1_COLOR}
          style="padding-top: 2px;"
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
