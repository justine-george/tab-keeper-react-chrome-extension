import { Base64 } from 'js-base64';
import {
  TabMasterContainer,
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// check validity of the timestamp
export function isValidDate(param: any) {
  if (typeof param === 'number' || param === '') {
    const date = new Date(param);
    return date instanceof Date && !isNaN(date.getTime());
  }
  return false;
}

// check if an object is empty
export function isEmptyObject(obj: any): boolean {
  return typeof obj === 'object' && Object.keys(obj).length === 0;
}

// convert Date object to formatted string
export function getStringDate(inputDate: Date): string {
  const [year, month, day, hour, minute, second] = [
    inputDate.getFullYear(),
    inputDate.getMonth() + 1, // Month is 0-indexed
    inputDate.getDate(),
    inputDate.getHours(),
    inputDate.getMinutes(),
    inputDate.getSeconds(),
  ].map((val) => String(val).padStart(2, '0'));

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// simulate a lottery win based on random number
export function isLotteryWon(): boolean {
  return Math.floor(Math.random() * 2) === 1;
}

// simulate a network delay
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// debounce a function
export function debounce(func: any, delay: number) {
  let timeoutId: null | ReturnType<typeof setTimeout>;
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

// validate email format
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// validate password format
export function isValidPassword(password: string): boolean {
  const hasLetters = /[a-zA-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  return password.length >= 8 && hasLetters && hasNumbers;
}

// filter tabGroup
export const filterTabGroups = (
  searchText: string,
  tabGroups: tabContainerData[]
): tabContainerData[] => {
  const loweredSearchText = searchText.toLowerCase();

  return tabGroups.reduce((acc: tabContainerData[], tabGroup) => {
    let matchedWindows = tabGroup.windows.reduce(
      (windowAcc: windowGroupData[], window) => {
        let matchedTabs = window.tabs.filter(
          (tab) =>
            tab.title.toLowerCase().includes(loweredSearchText) ||
            (tab.url && tab.url.toLowerCase().includes(loweredSearchText))
        );

        if (matchedTabs.length) {
          windowAcc.push({
            ...window,
            tabs: matchedTabs,
            tabCount: matchedTabs.length,
            title: matchedTabs[0].title,
          });
        }

        return windowAcc;
      },
      []
    );

    if (matchedWindows.length) {
      acc.push({
        ...tabGroup,
        windows: matchedWindows,
        windowCount: matchedWindows.length,
        tabCount: matchedWindows.reduce(
          (total, win) => total + win.tabCount,
          0
        ),
      });
    }

    return acc;
  }, []);
};

// save data to local storage
export const saveToLocalStorage = (key: string, data: any): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save to localStorage: ', error);
  }
};

// load data from local storage
export const loadFromLocalStorage = (key: string): any | undefined => {
  try {
    const serializedState = localStorage.getItem(key);
    if (!serializedState) return undefined;
    return JSON.parse(serializedState);
  } catch (error) {
    console.error('Error loading state from localStorage: ', error);
    return undefined;
  }
};

// generate placeholder URL for quicker session loads and lesser memory consumption
export function generatePlaceholderURL(
  title: string,
  faviconURL: string,
  url: string,
  goToURLText: string
) {
  const html = `<html> <head> <meta charset="UTF-8" /> <link rel="icon" type="image/x-icon" href="${faviconURL}" /> <meta name="viewport" content="width=device-width, initial-scale=1.0" /> <title>${title}</title> <style> body { background-color: #181818; color: #ffffff; font-family: "Libre Franklin", sans-serif; display: flex; margin: 20px; flex-direction: column; justify-content: flex-start; align-items: flex-start; height: 100vh; } #copyButton { cursor: pointer; background-color: #2c2c2c; padding: 10px 20px; border: none; border-radius: 10px; color: #ffffff; font-family: "Libre Franklin", sans-serif; font-size: 14px; transition: background-color 0.125s ease, color 0.125s ease; } #copyButton:hover { background-color: #77dd77; color: black; } h1,h2,p { margin: 10px 3px; } a { text-decoration: none; color: inherit; } p { font-size: 0.9rem; margin-bottom: 15px; } </style> </head> <body> <h2>${title}</h2> <a href="${url}"><p>${url}</p></a> <a href="${url}"><button id="copyButton">${goToURLText}</button></a> </body></html>`;
  const base64Html = Base64.encode(html);
  return `data:text/html;base64,${base64Html}`;
}

// decode dataurl before saving - bugfix to prevent saving base64 encoded urls
export function decodeDataUrl(url: string): string {
  if (url.startsWith('data:text/html;base64,')) {
    const base64Data = url.replace('data:text/html;base64,', '');
    const decodedHtml = Base64.decode(base64Data);

    // extract the actual URL from the HTML content
    const urlMatch = decodedHtml.match(/<a href="([^"]+)">/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
  }
  return url;
}

// validate import JSON structure - TabMasterContainer
export const isValidTabMasterContainer = (
  data: any
): data is TabMasterContainer => {
  return (
    typeof data.lastModified === 'number' &&
    (typeof data.selectedTabGroupId === 'string' ||
      data.selectedTabGroupId === null) &&
    Array.isArray(data.tabGroups) &&
    data.tabGroups.every(isValidTabContainerData)
  );
};

// validate import JSON structure - tabContainerData
const isValidTabContainerData = (data: any): data is tabContainerData => {
  return (
    typeof data.tabGroupId === 'string' &&
    typeof data.title === 'string' &&
    typeof data.createdTime === 'string' &&
    typeof data.windowCount === 'number' &&
    typeof data.tabCount === 'number' &&
    typeof data.isAutoSave === 'boolean' &&
    typeof data.isSelected === 'boolean' &&
    Array.isArray(data.windows) &&
    data.windows.every(isValidWindowGroupData)
  );
};

// validate import JSON structure - windowGroupData
const isValidWindowGroupData = (data: any): data is windowGroupData => {
  return (
    typeof data.windowId === 'string' &&
    typeof data.tabCount === 'number' &&
    typeof data.title === 'string' &&
    Array.isArray(data.tabs) &&
    data.tabs.every(isValidTabData)
  );
};

// validate import JSON structure - tabData
const isValidTabData = (data: any): data is tabData => {
  return (
    typeof data.tabId === 'string' &&
    typeof data.favicon === 'string' &&
    typeof data.title === 'string' &&
    typeof data.url === 'string'
  );
};

// convert datestring and timestamp to "mmm DD, yyyy at H:MM:SS AM/PM" format
export const getPrettyDate = (dateOrTimeStamp: string | number): string => {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ];

  const date = new Date(dateOrTimeStamp);

  const year = date.getFullYear();
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;

  return `${month} ${day}, ${year} at ${formattedHours}:${minutes}:${seconds} ${ampm}`;
};
