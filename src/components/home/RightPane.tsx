import { css } from "@emotion/react";
import HeroContainerRight from "./HeroContainerRight";
import TabGroupDetailsContainer from "./TabGroupDetailsContainer";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/store";

export default function RightPane() {
  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState,
  );

  // to identify whether no tab groups are selected
  const isNoneSelected =
    tabContainerDataList.tabGroups.filter((tabGroup) => tabGroup.isSelected)
      .length === 0;

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px 8px;
    height: 100%;
  `;

  return (
    <>
      {/* Only render right pane when atleast one selected item exists */}
      {!isNoneSelected && (
        <div css={containerStyle}>
          <HeroContainerRight />
          <TabGroupDetailsContainer />
        </div>
      )}
    </>
  );
}
