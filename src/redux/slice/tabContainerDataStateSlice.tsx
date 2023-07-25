import { PayloadAction, createSlice } from "@reduxjs/toolkit";

import { v4 as uuidv4 } from "uuid";
import { getCurrentDateString } from "../../utils/helperFunctions";

export interface tabData {
  id: string; // TODO: use ULID, 48bit timestamp + 80 bits random data: 128bit key
  favicon: string;
  title: string;
  url: string;
}

export interface windowGroupData {
  id: string;
  title: string;
  tabs: tabData[];
}

export interface tabContainerData {
  id: string;
  title: string;
  windowCount: number;
  tabCount: number;
  createdTime: string; // TODO: conversion to Date might be needed
  isAutoSave: boolean;
  isSelected: boolean;
  windows: windowGroupData[];
}

const initialState: tabContainerData[] = [
  {
    id: "3405c6f0-9fb1-4c65-b8a1-aaf16f35d7a5",
    title: "Youtube - Sample",
    windowCount: 2,
    tabCount: 5,
    createdTime: "2023-06-23 13:02:03",
    isAutoSave: true,
    isSelected: true,
    windows: [
      {
        id: "7859c581-b3af-4bc6-b716-342f28ed5d93",
        title: "Youtube - Sample",
        tabs: [
          {
            id: "32f06b20-9870-4445-b5d8-e99c5f2c5b12",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
          {
            id: "46ddab56-8ed0-4c4e-bc5a-eb15a468db28",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
          {
            id: "146bb2d1-0d9f-48e8-8ea5-8c7b5b1eaeb7",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
        ],
      },
    ],
  },
  {
    id: "e9132d9e-6620-4b74-ba97-baa9c0f5b8f0",
    title: "Youtube - Sample",
    windowCount: 2,
    tabCount: 5,
    createdTime: "2023-06-23 13:02:03",
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        id: "5a7bc8d0-3b75-4410-94d2-bcde95a4e532",
        title: "Youtube - Sample",
        tabs: [
          {
            id: "d81e67fc-7a32-40d1-8a17-33c23e3b8c85",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
          {
            id: "f684d4cd-f9d3-4bb1-8b2b-1c5c15a66b1b",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
          {
            id: "b6c75c1d-b6e8-43b5-8e82-3ef58d7dc67b",
            favicon:
              "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
            title: "Youtube - Sample",
            url: "http://www.google.com/",
          },
        ],
      },
    ],
  },
];

export const tabContainerDataStateSlice = createSlice({
  name: "tabContainerData",
  initialState,
  reducers: {
    // TODO: receive tabContainerData object ready to push to the state
    // saveToTabContainer: (state, action: PayloadAction<tabContainerData>) => {
    //   state.push(action.payload);
    // },

    // add new tab group to the container list
    saveToTabContainer: (state, action: PayloadAction<string>) => {
      const title = action.payload;
      const dummyValue = {
        id: uuidv4(),
        title: title,
        windowCount: 2,
        tabCount: 5,
        createdTime: getCurrentDateString(),
        isAutoSave: false,
        isSelected: false,
        windows: [
          {
            id: "7859c581-b3af-4bc6-b716-342f28ed5d93",
            title: "Youtube - Sample",
            tabs: [
              {
                id: "32f06b20-9870-4445-b5d8-e99c5f2c5b12",
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                id: "46ddab56-8ed0-4c4e-bc5a-eb15a468db28",
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
              {
                id: "146bb2d1-0d9f-48e8-8ea5-8c7b5b1eaeb7",
                favicon:
                  "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico?v=ec617d715196",
                title: "Youtube - Sample",
                url: "http://www.google.com/",
              },
            ],
          },
        ],
      };
      console.log("Generated uuid: " + dummyValue.id);
      state.unshift(dummyValue);
    },

    // select tab group by id
    selectTabContainer: (state, action: PayloadAction<string>) => {
      const selectedId = action.payload;
      console.log(selectedId);
      state.forEach((tabGroup) => {
        if (tabGroup.id === selectedId) {
          tabGroup.isSelected = true;
        } else {
          tabGroup.isSelected = false;
        }
      });
    },

    // delete tab group by id
    // TODO: Bug here, find out the issue.
    deleteTabContainer: (state, action: PayloadAction<string>) => {
      const toBeDeletedId = action.payload;
      console.log(toBeDeletedId);
      // find the index and delete when id is a match with toBeDeletedId
      const index = state.findIndex(
        (tabGroup) => tabGroup.id === toBeDeletedId
      );
      if (index !== -1) {
        state.splice(index, 1);
      }
    },
  },
});

export const { saveToTabContainer, selectTabContainer, deleteTabContainer } =
  tabContainerDataStateSlice.actions;

export default tabContainerDataStateSlice.reducer;
