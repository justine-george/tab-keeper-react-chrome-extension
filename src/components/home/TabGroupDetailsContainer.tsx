import { css } from "@emotion/react";
import { NormalLabel } from "../common/Label";
import WindowEntryContainer from "./WindowEntryContainer";
import { isEmptyObject } from "../../utils/helperFunctions";
import { useThemeColors } from "../hook/useThemeColors";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import { deleteWindow } from "../../redux/slice/tabContainerDataStateSlice";

export default function TabGroupDetailsContainer() {
  const COLORS = useThemeColors();

  const dispatch = useDispatch();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  // assumption is there is, at max, one selected tabGroup
  const selectedTabGroup = tabContainerDataList.filter(
    (tabGroup) => tabGroup.isSelected
  )[0];

  const tabGroupId = selectedTabGroup.tabGroupId;

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    // height: 100%;
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
          {selectedTabGroup.windows.map(({ windowId, title, tabs }, _) => {
            return (
              <div
              // key={windowId}
              >
                <WindowEntryContainer
                  title={title}
                  tabs={tabs}
                  tabGroupId={tabGroupId}
                  windowId={windowId}
                  onDeleteClick={() =>
                    dispatch(deleteWindow({ tabGroupId, windowId }))
                  }
                />
                {/* <Divider /> */}
                {/* {index != selectedTabGroup.windows.length - 1 && <Divider />} */}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
