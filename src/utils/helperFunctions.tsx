import { showToast } from "../redux/slice/globalStateSlice";
import { AppDispatch } from "../redux/store";

export function isEmptyObject(obj: any): boolean {
  return typeof obj === "object" && Object.keys(obj).length === 0;
}

export function getStringDate(inputDate: Date): string {
  const year = inputDate.getFullYear();
  // Month is 0-indexed, so +1
  const month = String(inputDate.getMonth() + 1).padStart(2, "0");
  const day = String(inputDate.getDate()).padStart(2, "0");
  const hour = String(inputDate.getHours()).padStart(2, "0");
  const minute = String(inputDate.getMinutes()).padStart(2, "0");
  const second = String(inputDate.getSeconds()).padStart(2, "0");

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
