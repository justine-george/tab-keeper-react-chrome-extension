import { css } from "@emotion/react";
import TabGroupEntry from "./TabGroupEntry";
import Divider from "../common/Divider";
import { NormalLabel } from "../common/Label";
import { useThemeColors } from "../hook/useThemeColors";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import {
  deleteTabContainer,
  openAllTabContainer,
  selectTabContainer,
} from "../../redux/slice/tabContainerDataStateSlice";

export default function TabGroupEntryContainer() {
  const COLORS = useThemeColors();

  const dispatch = useDispatch();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState,
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 8px 0;
    overflow: auto;
    user-select: none;
  `;

  const emptyContainerStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  const filledContainerStyle = css`
    display: flex;
    flex-direction: column;
  `;

  return (
    <div css={containerStyle}>
      {tabContainerDataList.tabGroups.length === 0 ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {tabContainerDataList.tabGroups.map((tabGroupData, index) => {
            return (
              <div
              // key={tabGroupData.tabGroupId}
              >
                <TabGroupEntry
                  tabGroupData={tabGroupData}
                  onTabGroupClick={() =>
                    dispatch(selectTabContainer(tabGroupData.tabGroupId))
                  }
                  onOpenAllClick={() =>
                    dispatch(openAllTabContainer(tabGroupData.tabGroupId))
                  }
                  onDeleteClick={() =>
                    dispatch(deleteTabContainer(tabGroupData.tabGroupId))
                  }
                />
                {/* <Divider /> */}
                {index != tabContainerDataList.tabGroups.length - 1 && (
                  <Divider />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
