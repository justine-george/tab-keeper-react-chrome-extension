import { describe, expect, test } from 'vitest';
import {
  decodeDataUrl,
  filterTabGroups,
  generatePlaceholderURL,
  getPrettyDate,
  getStringDate,
  isEmptyObject,
  isValidDate,
  isValidEmail,
  isValidPassword,
  isValidTabMasterContainer,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../../utils/functions/local';

describe('isValidDate', () => {
  // Valid dates
  test('should return true if date is valid', () => {
    const testDate: number = Date.now();
    expect(isValidDate(testDate)).toBe(true);
  });

  // Invalid dates
  test('should return false if date is invalid', () => {
    expect(isValidDate('')).toBe(false);
  });
});

describe('isEmptyObject', () => {
  // Empty objects
  test('should return true if object is empty', () => {
    expect(isEmptyObject({})).toBe(true);
  });

  // Non empty objects
  test('should return false if object is not empty', () => {
    expect(isEmptyObject({ key: 'value' })).toBe(false);
  });
});

describe('getStringDate', () => {
  test('should return formatted date string', () => {
    const date = new Date(2023, 9, 17, 10, 30, 45);
    expect(getStringDate(date)).toBe('2023-10-17 10:30:45');
  });
});

describe('isValidEmail', () => {
  // Valid emails
  test('should return true if email is valid', () => {
    expect(isValidEmail('test@gmail.com')).toBe(true);
  });

  // Invalid emails
  test('should return false if email is invalid', () => {
    expect(isValidEmail('@gmail.com')).toBe(false);
    expect(isValidEmail('testgmail.com')).toBe(false);
    expect(isValidEmail('test@.com')).toBe(false);
    expect(isValidEmail('test@gmailcom')).toBe(false);
    expect(isValidEmail('test@gmail.')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('isValidPassword', () => {
  // Valid password
  test('should return true if password is valid', () => {
    expect(isValidPassword('abcd1234')).toBe(true);
  });

  // Invalid passwords - less than 8 characters
  test('should return false if password is invalid', () => {
    expect(isValidPassword('abcd123')).toBe(false);
    expect(isValidPassword('')).toBe(false);
  });

  // Invalid passwords - no letters
  test('should return false if password is invalid', () => {
    expect(isValidPassword('12345678')).toBe(false);
  });

  // Invalid passwords - no numbers
  test('should return false if password is invalid', () => {
    expect(isValidPassword('abcdefgh')).toBe(false);
  });
});

describe('filterTabGroups', () => {
  test('should return filtered tab groups', () => {
    const tabGroups = [
      {
        tabGroupId: 'c1172d60-4af3-4a5f-ba57-6b68ea1e1823',
        title: 'Extensions',
        createdTime: '2023-10-17 22:01:23',
        windowCount: 1,
        tabCount: 8,
        isAutoSave: false,
        isSelected: true,
        windows: [
          {
            windowId: '164f8fb7-84f9-441b-835a-044b91df1e8b',
            windowHeight: 1415,
            windowWidth: 1417,
            windowOffsetTop: 25,
            windowOffsetLeft: 0,
            tabCount: 8,
            title: 'Test Group',
            tabs: [
              {
                tabId: '59bfecef-6c08-4206-afad-1182d563d6d1',
                favicon: 'https://leetcode.com/favicon.ico',
                title: 'Valid Anagram - LeetCode',
                url: 'https://leetcode.com/problems/valid-anagram/',
              },
              {
                tabId: '3b4229bd-51fe-4957-874e-daec670de53d',
                favicon:
                  'https://www.freecodecamp.org/favicon-32x32.png?v=6cba562cbd10e31af925a976f3db73f7',
                title:
                  'Back End Development and APIs Certification | freeCodeCamp.org',
                url: 'https://www.freecodecamp.org/learn/back-end-development-and-apis/',
              },
              {
                tabId: '3beee22e-f888-4b55-95a2-8894fe33999d',
                favicon:
                  'https://www.freecodecamp.org/favicon-32x32.png?v=6cba562cbd10e31af925a976f3db73f7',
                title:
                  'Basic Node and Express - Start a Working Express Server | Learn | freeCodeCamp.org',
                url: 'https://www.freecodecamp.org/learn/back-end-development-and-apis/basic-node-and-express/start-a-working-express-server',
              },
              {
                tabId: '410ef43b-4726-4f5c-8746-3832327ba5ea',
                favicon:
                  'https://developer.chrome.com/images/meta/favicon-32x32.png',
                title: 'Unit testing Chrome Extensions - Chrome for Developers',
                url: 'https://developer.chrome.com/docs/extensions/mv3/unit-testing/#:~:text=Unit%20testing%20allows%20small%20sections,writes%20a%20value%20to%20storage.',
              },
              {
                tabId: 'b6d3dca0-20a8-4767-8240-3cb108a53470',
                favicon:
                  'https://miro.medium.com/v2/1*m-R_BkNf1Qjr1YbyOIJY2w.png',
                title:
                  'How to setup Jest and React Testing Library in Vite project | by Zafer Ayan | Medium',
                url: 'https://zaferayan.medium.com/how-to-setup-jest-and-react-testing-library-in-vite-project-2600f2d04bdd',
              },
              {
                tabId: 'a97bf1b3-5982-416c-8c6c-f4db85dd7566',
                favicon: 'https://kulshekhar.github.io/ts-jest/img/logo.svg',
                title: 'Presets | ts-jest',
                url: 'https://kulshekhar.github.io/ts-jest/docs/getting-started/presets',
              },
              {
                tabId: '8ad75550-32a6-478c-802e-3c1afd0ab2e0',
                favicon: 'https://www.diffchecker.com/favicon.ico',
                title: 'Untitled diff - Diff Checker',
                url: 'https://www.diffchecker.com/text-compare/',
              },
              {
                tabId: '888c1cf7-166c-4be0-bc6f-4e62d0fb70a2',
                favicon: '',
                title: 'Extensions',
                url: 'chrome://extensions/',
              },
            ],
          },
        ],
      },
    ];
    const filteredTabGroups = [
      {
        tabGroupId: 'c1172d60-4af3-4a5f-ba57-6b68ea1e1823',
        title: 'Extensions',
        createdTime: '2023-10-17 22:01:23',
        windowCount: 1,
        tabCount: 2,
        isAutoSave: false,
        isSelected: true,
        windows: [
          {
            windowId: '164f8fb7-84f9-441b-835a-044b91df1e8b',
            windowHeight: 1415,
            windowWidth: 1417,
            windowOffsetTop: 25,
            windowOffsetLeft: 0,
            tabCount: 2,
            title: 'Unit testing Chrome Extensions - Chrome for Developers',
            tabs: [
              {
                tabId: '410ef43b-4726-4f5c-8746-3832327ba5ea',
                favicon:
                  'https://developer.chrome.com/images/meta/favicon-32x32.png',
                title: 'Unit testing Chrome Extensions - Chrome for Developers',
                url: 'https://developer.chrome.com/docs/extensions/mv3/unit-testing/#:~:text=Unit%20testing%20allows%20small%20sections,writes%20a%20value%20to%20storage.',
              },
              {
                tabId: '888c1cf7-166c-4be0-bc6f-4e62d0fb70a2',
                favicon: '',
                title: 'Extensions',
                url: 'chrome://extensions/',
              },
            ],
          },
        ],
      },
    ];
    expect(filterTabGroups('chrome', tabGroups)).toEqual(filteredTabGroups);
  });
});

describe('localStorage', () => {
  // valid flow
  test('should  handle save to and load from local storage', () => {
    const key = 'test';
    const data = { key: 'value' };
    saveToLocalStorage(key, data);
    expect(loadFromLocalStorage(key)).toStrictEqual(data);
  });

  // invalid load
  test('handle invalid load from local storage', () => {
    expect(loadFromLocalStorage('invalid')).toBe(undefined);
  });
});

describe('placeholderURL', () => {
  const title = 'Test title';
  const favicon = 'https://www.testurl.com/favicon.ico';
  const url = 'https://www.testurl.com';
  const buttonText = 'Visit Site';
  const encodedPlaceholderUrl =
    'data:text/html;base64,PGh0bWw+IDxoZWFkPiA8bWV0YSBjaGFyc2V0PSJVVEYtOCIgLz4gPGxpbmsgcmVsPSJpY29uIiB0eXBlPSJpbWFnZS94LWljb24iIGhyZWY9Imh0dHBzOi8vd3d3LnRlc3R1cmwuY29tL2Zhdmljb24uaWNvIiAvPiA8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEuMCIgLz4gPHRpdGxlPlRlc3QgdGl0bGU8L3RpdGxlPiA8c3R5bGU+IGJvZHkgeyBiYWNrZ3JvdW5kLWNvbG9yOiAjMTgxODE4OyBjb2xvcjogI2ZmZmZmZjsgZm9udC1mYW1pbHk6ICJMaWJyZSBGcmFua2xpbiIsIHNhbnMtc2VyaWY7IGRpc3BsYXk6IGZsZXg7IG1hcmdpbjogMjBweDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsganVzdGlmeS1jb250ZW50OiBmbGV4LXN0YXJ0OyBhbGlnbi1pdGVtczogZmxleC1zdGFydDsgaGVpZ2h0OiAxMDB2aDsgfSAjY29weUJ1dHRvbiB7IGN1cnNvcjogcG9pbnRlcjsgYmFja2dyb3VuZC1jb2xvcjogIzJjMmMyYzsgcGFkZGluZzogMTBweCAyMHB4OyBib3JkZXI6IG5vbmU7IGJvcmRlci1yYWRpdXM6IDEwcHg7IGNvbG9yOiAjZmZmZmZmOyBmb250LWZhbWlseTogIkxpYnJlIEZyYW5rbGluIiwgc2Fucy1zZXJpZjsgZm9udC1zaXplOiAxNHB4OyB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDAuMTI1cyBlYXNlLCBjb2xvciAwLjEyNXMgZWFzZTsgfSAjY29weUJ1dHRvbjpob3ZlciB7IGJhY2tncm91bmQtY29sb3I6ICM3N2RkNzc7IGNvbG9yOiBibGFjazsgfSBoMSxoMixwIHsgbWFyZ2luOiAxMHB4IDNweDsgfSBhIHsgdGV4dC1kZWNvcmF0aW9uOiBub25lOyBjb2xvcjogaW5oZXJpdDsgfSBwIHsgZm9udC1zaXplOiAwLjlyZW07IG1hcmdpbi1ib3R0b206IDE1cHg7IH0gPC9zdHlsZT4gPC9oZWFkPiA8Ym9keT4gPGgyPlRlc3QgdGl0bGU8L2gyPiA8YSBocmVmPSJodHRwczovL3d3dy50ZXN0dXJsLmNvbSI+PHA+aHR0cHM6Ly93d3cudGVzdHVybC5jb208L3A+PC9hPiA8YSBocmVmPSJodHRwczovL3d3dy50ZXN0dXJsLmNvbSI+PGJ1dHRvbiBpZD0iY29weUJ1dHRvbiI+VmlzaXQgU2l0ZTwvYnV0dG9uPjwvYT4gPC9ib2R5PjwvaHRtbD4=';

  test('should generate encoded html as placeholder url', () => {
    expect(generatePlaceholderURL(title, favicon, url, buttonText)).toBe(
      encodedPlaceholderUrl
    );
  });

  test('should load decoded url from placeholder encoded html', () => {
    expect(decodeDataUrl(encodedPlaceholderUrl)).toBe(url);
  });

  test('should load url properly even if it is not encoded', () => {
    expect(decodeDataUrl(url)).toBe(url);
  });
});

describe('isValidTabMasterContainer', () => {
  test('should return true for valid TabMasterContainer structure', () => {
    const validData = {
      lastModified: Date.now(),
      selectedTabGroupId: 'sample-id',
      tabGroups: [
        {
          tabGroupId: 'sample-id',
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'sample-window-id',
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  tabId: 'sample-tab-id',
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(validData)).toBe(true);
  });

  test('should return false for invalid TabMasterContainer structure', () => {
    const invalidData = {
      selectedTabGroupId: 'sample-id',
      tabGroups: [
        {
          tabGroupId: 'sample-id',
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'sample-window-id',
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  tabId: 'sample-tab-id',
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
  });

  test('should return false for invalid TabMasterContainer structure', () => {
    const invalidData = {
      lastModified: Date.now(),
      tabGroups: [
        {
          tabGroupId: 'sample-id',
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'sample-window-id',
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  tabId: 'sample-tab-id',
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
  });

  test('should return false for invalid TabMasterContainer structure', () => {
    const invalidData = {
      lastModified: Date.now(),
      selectedTabGroupId: 'sample-id',
      tabGroups: [
        {
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'sample-window-id',
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  tabId: 'sample-tab-id',
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
  });

  test('should return false for invalid TabMasterContainer structure', () => {
    const invalidData = {
      lastModified: Date.now(),
      selectedTabGroupId: 'sample-id',
      tabGroups: [
        {
          tabGroupId: 'sample-id',
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  tabId: 'sample-tab-id',
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
  });

  test('should return false for invalid TabMasterContainer structure', () => {
    const invalidData = {
      lastModified: Date.now(),
      selectedTabGroupId: 'sample-id',
      tabGroups: [
        {
          tabGroupId: 'sample-id',
          title: 'Sample title',
          createdTime: '2023-10-17 22:01:23',
          windowCount: 1,
          tabCount: 2,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'sample-window-id',
              tabCount: 2,
              title: 'Sample Window Title',
              tabs: [
                {
                  favicon: 'https://sample.com/favicon.ico',
                  title: 'Sample Tab Title',
                  url: 'https://sample.com',
                },
                {
                  tabId: 'sample-tab-id2',
                  favicon: 'https://sample2.com/favicon.ico',
                  title: 'Sample Tab Title 2',
                  url: 'https://sample2.com',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
  });
});

describe('should convert datestring to "mmm DD, yyyy at H:MM:SS AM/PM" format', () => {
  test('should return formatted date string', () => {
    const inputDateString = '2023-10-17 22:01:23';
    const expectedOutputString = 'Oct 17, 2023 at 10:01:23 PM';
    expect(getPrettyDate(inputDateString)).toBe(expectedOutputString);
  });

  test('should handle AM time correctly', () => {
    const inputDateString = '2023-10-17 09:05:03';
    const expectedOutputString = 'Oct 17, 2023 at 9:05:03 AM';
    expect(getPrettyDate(inputDateString)).toBe(expectedOutputString);
  });

  test('should handle noon correctly', () => {
    const inputDateString = '2023-10-17 12:00:00';
    const expectedOutputString = 'Oct 17, 2023 at 12:00:00 PM';
    expect(getPrettyDate(inputDateString)).toBe(expectedOutputString);
  });

  test('should handle midnight correctly', () => {
    const inputDateString = '2023-10-17 00:00:00';
    const expectedOutputString = 'Oct 17, 2023 at 12:00:00 AM';
    expect(getPrettyDate(inputDateString)).toBe(expectedOutputString);
  });
});

describe('should convert timestamp to "mmm DD, yyyy at H:MM:SS AM/PM" format', () => {
  test('should return formatted date string', () => {
    const inputTimestamp = new Date('2023-10-17 22:01:23').getTime();
    const expectedOutputString = 'Oct 17, 2023 at 10:01:23 PM';
    expect(getPrettyDate(inputTimestamp)).toBe(expectedOutputString);
  });

  test('should handle AM time correctly', () => {
    const inputTimestamp = new Date('2023-10-17 09:05:03').getTime();
    const expectedOutputString = 'Oct 17, 2023 at 9:05:03 AM';
    expect(getPrettyDate(inputTimestamp)).toBe(expectedOutputString);
  });

  test('should handle noon correctly', () => {
    const inputTimestamp = new Date('2023-10-17 12:00:00').getTime();
    const expectedOutputString = 'Oct 17, 2023 at 12:00:00 PM';
    expect(getPrettyDate(inputTimestamp)).toBe(expectedOutputString);
  });

  test('should handle midnight correctly', () => {
    const inputTimestamp = new Date('2023-10-17 00:00:00').getTime();
    const expectedOutputString = 'Oct 17, 2023 at 12:00:00 AM';
    expect(getPrettyDate(inputTimestamp)).toBe(expectedOutputString);
  });
});
