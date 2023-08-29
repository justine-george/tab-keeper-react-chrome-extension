import { showToast } from '../redux/slice/globalStateSlice';
import { AppDispatch } from '../redux/store';

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

// Save data to local storage
export const saveToLocalStorage = (key: string, data: any): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save to localStorage: ', error);
  }
};

// Load data from local storage
export const loadFromLocalStorage = (key: string): any | undefined => {
  try {
    const serializedState = localStorage.getItem(key);
    if (!serializedState) return undefined;
    return JSON.parse(serializedState);
  } catch (error) {
    console.warn('Error loading state from localStorage:', error);
    return undefined;
  }
};

export function generatePlaceholderURL(
  title: string,
  faviconURL: string,
  url: string
) {
  const html = `<html><head><meta charset="UTF-8" /><link rel="icon" type="image/x-icon" href="${faviconURL}" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${title}</title><style>body {background-color: #181818;color: #ffffff;font-family: "Libre Franklin", sans-serif;display: flex;margin: 20px;flex-direction: column;justify-content: flex-start;align-items: flex-start;height: 100vh;}#copyButton {cursor: pointer;background-color: #2c2c2c;padding: 10px 20px;border: none;border-radius: 10px;color: #ffffff;font-family: "Libre Franklin", sans-serif;font-size: 12px;transition: background-color 0.125s ease, color 0.125s ease;}#copyButton.copied {background-color: #77dd77;color: black;}h1,h2,p {margin: 10px 0;}a {text-decoration: none;color: inherit;}p {font-size: 0.9rem;}</style></head><body><h2>${title}</h2><a href="${url}"><p>${url}</p></a><button id="copyButton" onclick="copyToClipboard()">Copy URL</button><script>function copyToClipboard() {navigator.clipboard.writeText("${url}").then(() => {const button = document.getElementById("copyButton");button.innerHTML = "URL copied!";button.classList.add("copied");setTimeout(() => {button.classList.remove("copied");button.innerHTML = "Copy URL";}, 2000);});}</script></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}
