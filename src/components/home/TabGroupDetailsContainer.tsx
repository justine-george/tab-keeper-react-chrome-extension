import { css } from "@emotion/react";
import { NormalLabel } from "../common/Label";
import WindowEntryContainer from "./WindowEntryContainer";
import { isEmptyObject } from "../../utils/helperFunctions";
import { useThemeColors } from "../hook/useThemeColors";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/store";

export default function TabGroupDetailsContainer() {
  const COLORS = useThemeColors();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  // assumption is there is only one selected tabGroup
  const selectedTabGroup = tabContainerDataList.filter(
    (tabGroup) => tabGroup.isSelected
  )[0];

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

  // selectedTabGroup = {};

  return (
    <div css={containerStyle}>
      {isEmptyObject(selectedTabGroup) ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {selectedTabGroup.windows.map(({ title, tabs }, _) => {
            return (
              <>
                <WindowEntryContainer title={title} tabs={tabs} />
                {/* <Divider /> */}
                {/* {index != selectedTabGroup.windows.length - 1 && <Divider />} */}
              </>
            );
          })}
        </div>
      )}
    </div>
  );
}
