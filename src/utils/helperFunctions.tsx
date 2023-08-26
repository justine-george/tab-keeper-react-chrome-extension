import { showToast } from "../redux/slice/globalStateSlice";
import { tabContainerData } from "../redux/slice/tabContainerDataStateSlice";
import { AppDispatch } from "../redux/store";

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

// returns true if lottery is won, else false
export function isLotteryWon(): boolean {
  const number = Math.floor(Math.random() * 2); // this could be 0 or 1
  return number === 1;
}

// simulate network delay for testing
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// debounce
export function debounce(func: Function, delay: number) {
  let timeoutId: number | null | undefined;
  return (...args: any[]) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

// validates email
export function isValidEmail(email: string) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// validates password
export function isValidPassword(password: string) {
  return password.length >= 6;
}

export const displayToast = (
  dispatch: AppDispatch,
  text: string,
  duration?: number,
  error?: any
) => {
  const displayText = error ? error.message || "An error occurred." : text;
  dispatch(
    showToast({
      toastText: displayText,
      duration: duration || 3000,
    })
  );
};

// save to local storage
export const saveToLocalStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save to localStorage:", error);
  }
};

// load from local storage
export const loadFromLocalStorage = (key: string) => {
  try {
    const serializedState = localStorage.getItem(key);
    if (serializedState === null) return undefined;
    return JSON.parse(serializedState);
  } catch (e) {
    console.warn("Error loading state from localStorage:", e);
    return undefined;
  }
};

// convert firebase data to tabContainer format
export const convertDataToTabContainer = (data: any): tabContainerData[] => {
  const result: tabContainerData[] = [];

  for (const key in data) {
    const item = data[key];

    const newTabContainer: tabContainerData = {
      tabGroupId: item.tabGroupId,
      title: item.title,
      createdTime: item.createdTime,
      windowCount: item.windowCount,
      tabCount: item.tabCount,
      isAutoSave: item.isAutoSave,
      isSelected: item.isSelected,
      windows: item.windows.map((window: any) => ({
        windowId: window.windowId,
        tabCount: window.tabCount,
        title: window.title,
        tabs: window.tabs.map((tab: any) => ({
          tabId: tab.tabId,
          favicon: tab.favicon,
          title: tab.title,
          url: tab.url,
        })),
      })),
    };

    result.push(newTabContainer);
  }

  return result;
};
