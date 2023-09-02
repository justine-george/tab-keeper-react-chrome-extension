import { AppDispatch } from '../redux/store';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
} from '../redux/slice/globalStateSlice';
import {
  TabMasterContainer,
  tabContainerData,
  windowGroupData,
} from '../redux/slice/tabContainerDataStateSlice';
import { db, fetchDataFromFirestore } from '../config/firebase';
import { doc, setDoc } from 'firebase/firestore';

// Check if an object is empty
export function isEmptyObject(obj: any): boolean {
  return typeof obj === 'object' && Object.keys(obj).length === 0;
}

// Convert Date object to formatted string
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

// Simulate a lottery win based on random number
export function isLotteryWon(): boolean {
  return Math.floor(Math.random() * 2) === 1;
}

// Simulate a network delay
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Debounce a function
export function debounce(func: any, delay: number) {
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

// Validate email format
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Validate password format
export function isValidPassword(password: string): boolean {
  const hasLetters = /[a-zA-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  return password.length >= 8 && hasLetters && hasNumbers;
}

// Display a toast message
export const displayToast = (
  dispatch: AppDispatch,
  text: string,
  duration?: number,
  error?: any
) => {
  const displayText = error ? error.message || 'An error occurred.' : text;
  dispatch(
    showToast({
      toastText: displayText,
      duration: duration || 3000,
    })
  );
};

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

// Save data to local storage
export const saveToLocalStorage = (key: string, data: any): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save to localStorage: ', error);
  }
};

// Load data from local storage
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

// placeholder URL for quicker session loads and lesser memory consumption
export function generatePlaceholderURL(
  title: string,
  faviconURL: string,
  url: string
) {
  const html = `<html><head><meta charset="UTF-8" /><link rel="icon" type="image/x-icon" href="${faviconURL}" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${title}</title><style>body {background-color: #181818;color: #ffffff;font-family: "Libre Franklin", sans-serif;display: flex;margin: 20px;flex-direction: column;justify-content: flex-start;align-items: flex-start;height: 100vh;}#copyButton {cursor: pointer;background-color: #2c2c2c;padding: 10px 20px;border: none;border-radius: 10px;color: #ffffff;font-family: "Libre Franklin", sans-serif;font-size: 12px;transition: background-color 0.125s ease, color 0.125s ease;}#copyButton.copied {background-color: #77dd77;color: black;}h1,h2,p {margin: 10px 0;}a {text-decoration: none;color: inherit;}p {font-size: 0.9rem;}</style></head><body><h2>${title}</h2><a href="${url}"><p>${url}</p></a><button id="copyButton" onclick="copyToClipboard()">Copy URL</button><script>function copyToClipboard() {navigator.clipboard.writeText("${url}").then(() => {const button = document.getElementById("copyButton");button.innerHTML = "URL copied!";button.classList.add("copied");setTimeout(() => {button.classList.remove("copied");button.innerHTML = "Copy URL";}, 2000);});}</script></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

// load data from Firestore
export async function loadFromFirestore(
  userId: string,
  thunkAPI: any
): Promise<TabMasterContainer | undefined> {
  try {
    const tabDataFromCloud: TabMasterContainer =
      await fetchDataFromFirestore(userId);
    return tabDataFromCloud;
  } catch (error: any) {
    if (error.message === 'Document does not exist for userId: ' + userId) {
      console.log('handled error: ' + error.message);
      console.log(error);
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
    } else if (error.message === `Missing or insufficient permissions.`) {
      console.log('handled error: ' + error.message);
      console.log(error);
      thunkAPI.dispatch(setIsDirty());
      thunkAPI.dispatch(saveToFirestoreIfDirty());
    } else {
      // Handle other types of Firestore errors
      console.log('unexpected error: ' + error.message);
      console.log(error);
      thunkAPI.dispatch(
        showToast({
          toastText: 'Error fetching data:' + error.message,
          duration: 3000,
        })
      );
    }
  }
}

// save data to Firestore
export async function saveToFirestore(
  userId: string,
  data: TabMasterContainer,
  thunkAPI: any
): Promise<void> {
  try {
    await setDoc(doc(db, 'tabGroupData', userId), data);
  } catch (error: any) {
    console.warn('Error updating Firestore: ', error.message);
    thunkAPI.dispatch(
      showToast({
        toastText: 'Sync error:' + error.message,
        duration: 3000,
      })
    );
  }
}
