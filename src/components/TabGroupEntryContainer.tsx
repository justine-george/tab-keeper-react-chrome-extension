import { css } from "@emotion/react";
import TabGroupEntry from "./TabGroupEntry";
import Divider from "./Divider";

export default function TabGroupEntryContainer() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid black;
    margin: 8px 0;
    overflow: auto;
    user-select: none;
  `;

  const sampleTabGroups = [
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

  return (
    <div css={containerStyle}>
      {sampleTabGroups.map(
        ({ title, windowCount, tabCount, createdTime, isAutoSave }, index) => {
          return (
            <>
              <TabGroupEntry
                title={title}
                windowCount={windowCount}
                tabCount={tabCount}
                createdTime={createdTime}
                isAutoSave={isAutoSave}
              />
              {/* <Divider /> */}
              {index != sampleTabGroups.length - 1 && <Divider />}
            </>
          );
        }
      )}
    </div>
  );
}
