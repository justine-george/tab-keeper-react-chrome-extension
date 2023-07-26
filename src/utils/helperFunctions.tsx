import { tabContainerData } from "../redux/slice/tabContainerDataStateSlice";

export function isEmptyObject(obj: any): boolean {
  return typeof obj === "object" && Object.keys(obj).length === 0;
}

export function getCurrentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  // Month is 0-indexed, so +1
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function getWindowCount(tabGroup: tabContainerData): number {
  return tabGroup.windows.length;
}

export function getTabCount(tabGroup: tabContainerData): number {
  const windows = tabGroup.windows;

  let tabCount = 0;
  windows.forEach((window) => {
    tabCount += window.tabs.length;
  });

  return tabCount;
}
