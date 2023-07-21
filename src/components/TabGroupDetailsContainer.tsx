import { css } from "@emotion/react";
import { NormalLabel } from "./Label";
import WindowEntryContainer from "./WindowEntryContainer";
import { isEmptyObject } from "../utils/helperFunctions";

export default function TabGroupDetailsContainer() {
  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    // height: 100%;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid black;
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

  let tabGroupEntry = {
    title: "Youtube - Sample",
    windowCount: 2,
    tabCount: 5,
    createdTime: "2023-06-23 13:02:03",
    isAutoSave: true,
    windows: [
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
      {
        title: "Youtube - Sample",
        tabs: [
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
          {
            title: "Youtube - Sample",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
          },
        ],
      },
    ],
  };

  // tabGroupEntry = {};

  return (
    <div css={containerStyle}>
      {isEmptyObject(tabGroupEntry) ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {tabGroupEntry.windows.map(({ title, tabs }, index) => {
            return (
              <>
                <WindowEntryContainer title={title} tabs={tabs} />
                {/* <Divider /> */}
                {/* {index != tabGroupEntry.windows.length - 1 && <Divider />} */}
              </>
            );
          })}
        </div>
      )}
    </div>
  );
}
