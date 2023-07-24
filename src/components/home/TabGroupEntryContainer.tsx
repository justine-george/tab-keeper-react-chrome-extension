import { css } from "@emotion/react";
import TabGroupEntry from "./TabGroupEntry";
import Divider from "../common/Divider";
import { NormalLabel } from "../common/Label";
import { useThemeColors } from "../hook/useThemeColors";

export default function TabGroupEntryContainer() {
  const COLORS = useThemeColors();

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

  let sampleTabGroups = [
    {
      title: "Youtube - Sample",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: false,
    },
    {
      title: "Bottles Corp",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: false,
    },
    {
      title: "Sample Website",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: true,
    },
    {
      title: "Leetcode",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: false,
    },
    {
      title: "Wikipedia",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: true,
    },
    {
      title: "Youtube - Sample",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: true,
    },
    {
      title: "Facebook - Home",
      windowCount: 2,
      tabCount: 5,
      createdTime: "2023-06-23 13:02:03",
      isAutoSave: true,
    },
  ];

  // sampleTabGroups = [];

  return (
    <div css={containerStyle}>
      {sampleTabGroups.length === 0 ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {sampleTabGroups.map(
            (
              { title, windowCount, tabCount, createdTime, isAutoSave },
              index
            ) => {
              return (
                <>
                  <TabGroupEntry
                    title={title}
                    windowCount={windowCount}
                    tabCount={tabCount}
                    createdTime={createdTime}
                    isAutoSave={isAutoSave}
                    isSelected={index === 0 ? true : false}
                  />
                  {/* <Divider /> */}
                  {index != sampleTabGroups.length - 1 && <Divider />}
                </>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
