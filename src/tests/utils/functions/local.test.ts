import { afterEach, describe, expect, test } from 'vitest';
import {
  classifyStoredToken,
  decodeDataUrl,
  filterTabGroups,
  isUsableToken,
  resolveTabUrl,
  unwrapSuspendedUrl,
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
  stripEmbeddedFavicons,
  resolveFaviconUrl,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../../../utils/functions/local';
import { TabMasterContainer } from '../../../redux/slices/tabContainerDataStateSlice';

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

  // Tombstones arrived with the automatic merge. The merge iterates this list
  // and writes the result back to Firestore, so a malformed value must be
  // rejected here rather than walked - a string would be iterated character by
  // character. Absent must stay valid: every container written before
  // tombstones existed lacks the field.
  describe('deletedTabGroups', () => {
    const withTombstones = (deletedTabGroups: unknown) => ({
      lastModified: 1,
      selectedTabGroupId: null,
      tabGroups: [],
      deletedTabGroups,
    });

    test('accepts a container with no deletedTabGroups at all', () => {
      expect(
        isValidTabMasterContainer({
          lastModified: 1,
          selectedTabGroupId: null,
          tabGroups: [],
        })
      ).toBe(true);
    });

    test('accepts an empty tombstone list', () => {
      expect(isValidTabMasterContainer(withTombstones([]))).toBe(true);
    });

    test('accepts well-formed tombstones', () => {
      expect(
        isValidTabMasterContainer(
          withTombstones([{ tabGroupId: 'a', deletedAt: 123 }])
        )
      ).toBe(true);
    });

    test.each([
      ['a bare string', 'garbage'],
      ['a number', 42],
      ['null', null],
      ['an object', { tabGroupId: 'a', deletedAt: 1 }],
      ['an entry missing deletedAt', [{ tabGroupId: 'a' }]],
      ['an entry missing tabGroupId', [{ deletedAt: 1 }]],
      [
        'an entry with a non-numeric deletedAt',
        [{ tabGroupId: 'a', deletedAt: 'x' }],
      ],
      ['an entry that is null', [null]],
    ])('rejects %s', (_label, value) => {
      expect(() =>
        isValidTabMasterContainer(withTombstones(value))
      ).not.toThrow();
      expect(isValidTabMasterContainer(withTombstones(value))).toBe(false);
    });
  });

  // A .json file containing any of these is valid JSON, so the import path can
  // hand them straight to the validator. It must reject them, not throw - the
  // caller shows error.message to the user, so a TypeError leaks
  // "Cannot read properties of null" instead of "Invalid JSON structure."
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'not an object'],
    ['a boolean', true],
    ['an array', []],
  ])('should return false for %s rather than throwing', (_label, input) => {
    expect(() => isValidTabMasterContainer(input)).not.toThrow();
    expect(isValidTabMasterContainer(input)).toBe(false);
  });

  test('should return false when a nested tab group is null', () => {
    const invalidData = {
      lastModified: Date.now(),
      selectedTabGroupId: null,
      tabGroups: [null],
    };
    expect(() => isValidTabMasterContainer(invalidData)).not.toThrow();
    expect(isValidTabMasterContainer(invalidData)).toBe(false);
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

describe('stripEmbeddedFavicons', () => {
  const EMBEDDED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
  const REMOTE = 'https://github.githubassets.com/favicons/favicon.svg';

  const buildContainer = (
    tabsPerWindow: number,
    favicon: string
  ): TabMasterContainer => ({
    lastModified: 1785312544441,
    selectedTabGroupId: 'group-0',
    tabGroups: [
      {
        tabGroupId: 'group-0',
        title: 'Extensions',
        createdTime: '2026-07-27 04:08:12',
        windowCount: 1,
        tabCount: tabsPerWindow,
        isAutoSave: false,
        isSelected: true,
        windows: [
          {
            windowId: 'window-0',
            windowHeight: 550,
            windowWidth: 790,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: tabsPerWindow,
            title: 'first tab title',
            tabs: Array.from({ length: tabsPerWindow }, (_, i) => ({
              tabId: `tab-${i}`,
              favicon,
              title: `Repository ${i}`,
              url: `https://github.com/user/repo-${i}`,
            })),
          },
        ],
      },
    ],
  });

  test('should replace embedded data: favicons with an empty string', () => {
    const result = stripEmbeddedFavicons(buildContainer(3, EMBEDDED));
    const favicons = result.tabGroups[0].windows[0].tabs.map((t) => t.favicon);
    expect(favicons).toEqual(['', '', '']);
  });

  test('should leave remote favicon URLs untouched', () => {
    const result = stripEmbeddedFavicons(buildContainer(3, REMOTE));
    const favicons = result.tabGroups[0].windows[0].tabs.map((t) => t.favicon);
    expect(favicons).toEqual([REMOTE, REMOTE, REMOTE]);
  });

  test('should preserve every field other than the favicon', () => {
    const input = buildContainer(2, EMBEDDED);
    const result = stripEmbeddedFavicons(input);

    expect(result.lastModified).toBe(input.lastModified);
    expect(result.selectedTabGroupId).toBe(input.selectedTabGroupId);
    expect(result.tabGroups[0].tabCount).toBe(input.tabGroups[0].tabCount);
    expect(result.tabGroups[0].windows[0].windowHeight).toBe(550);
    expect(result.tabGroups[0].windows[0].tabs[1]).toEqual({
      tabId: 'tab-1',
      favicon: '',
      title: 'Repository 1',
      url: 'https://github.com/user/repo-1',
    });
  });

  test('should not mutate the input container', () => {
    const input = buildContainer(2, EMBEDDED);
    stripEmbeddedFavicons(input);
    expect(input.tabGroups[0].windows[0].tabs[0].favicon).toBe(EMBEDDED);
  });

  test('should bring an oversized container under the Firestore limit', () => {
    // 12KB embedded favicon x 120 tabs - a plausible heavy session
    const heavyFavicon = 'data:image/png;base64,' + 'A'.repeat(12000);
    const oversized = buildContainer(120, heavyFavicon);

    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      FIRESTORE_MAX_DOCUMENT_BYTES
    );
    expect(
      JSON.stringify(stripEmbeddedFavicons(oversized)).length
    ).toBeLessThan(FIRESTORE_MAX_DOCUMENT_BYTES);
  });

  test('should handle a container with no tab groups', () => {
    const empty: TabMasterContainer = {
      lastModified: 1,
      selectedTabGroupId: null,
      tabGroups: [],
    };
    expect(stripEmbeddedFavicons(empty)).toEqual(empty);
  });

  test('should not throw when a favicon field is missing', () => {
    const malformed = buildContainer(1, EMBEDDED);
    // simulates data written before the favicon field was guaranteed
    delete (malformed.tabGroups[0].windows[0].tabs[0] as any).favicon;
    expect(() => stripEmbeddedFavicons(malformed)).not.toThrow();
  });
});

describe('resolveFaviconUrl', () => {
  const EXT = 'chrome-extension://abcdefghijklmnop';
  const withChrome = () => {
    (globalThis as any).chrome = {
      runtime: { getURL: (path: string) => `${EXT}${path}` },
    };
  };

  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  test('should return the stored favicon when there is one', () => {
    withChrome();
    const stored = 'https://github.githubassets.com/favicons/favicon.svg';
    expect(resolveFaviconUrl(stored, 'https://github.com')).toBe(stored);
  });

  test('should derive from the page URL when the favicon is empty', () => {
    withChrome();
    const result = resolveFaviconUrl('', 'https://github.com/user/repo');
    expect(result).toBe(
      `${EXT}/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2Fuser%2Frepo&size=32`
    );
  });

  test('should derive for http as well as https', () => {
    withChrome();
    expect(resolveFaviconUrl('', 'http://example.com')).toContain('/_favicon/');
  });

  test('should not derive for non-http schemes', () => {
    withChrome();
    expect(resolveFaviconUrl('', 'chrome://extensions/')).toBe('');
    expect(resolveFaviconUrl('', 'chrome-extension://x/suspended.html')).toBe(
      ''
    );
    expect(resolveFaviconUrl('', 'file:///tmp/page.html')).toBe('');
  });

  test('should return empty string when there is no page URL', () => {
    withChrome();
    expect(resolveFaviconUrl('', '')).toBe('');
  });

  test('should not throw when the chrome API is unavailable', () => {
    // chrome is undefined here - afterEach removed it
    expect(() => resolveFaviconUrl('', 'https://github.com')).not.toThrow();
    expect(resolveFaviconUrl('', 'https://github.com')).toBe('');
  });
});

describe('isUsableToken', () => {
  test('should return true for a non-empty string', () => {
    expect(isUsableToken('7f8d1e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6')).toBe(true);
    expect(isUsableToken('any-non-empty-string')).toBe(true);
  });

  test('should return false for an empty string', () => {
    expect(isUsableToken('')).toBe(false);
  });

  test('should return false for absent values', () => {
    expect(isUsableToken(undefined)).toBe(false);
    expect(isUsableToken(null)).toBe(false);
  });

  test('should return false for non-string values', () => {
    expect(isUsableToken(0)).toBe(false);
    expect(isUsableToken(1)).toBe(false);
    expect(isUsableToken(false)).toBe(false);
    expect(isUsableToken(true)).toBe(false);
    expect(isUsableToken({})).toBe(false);
    expect(isUsableToken([])).toBe(false);
    expect(isUsableToken(['a-token'])).toBe(false);
  });
});

describe('classifyStoredToken', () => {
  test('should mint when nothing is stored yet', () => {
    expect(classifyStoredToken(undefined)).toBe('mint');
    expect(classifyStoredToken(null)).toBe('mint');
    expect(classifyStoredToken('')).toBe('mint');
  });

  test('should use a stored non-empty string as the documentId', () => {
    expect(classifyStoredToken('7f8d1e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6')).toBe(
      'use'
    );
    expect(classifyStoredToken('legacy-token-format')).toBe('use');
  });

  test('should reject a stored value that is not a usable documentId', () => {
    expect(classifyStoredToken(0)).toBe('reject');
    expect(classifyStoredToken(false)).toBe('reject');
    expect(classifyStoredToken(true)).toBe('reject');
    expect(classifyStoredToken({})).toBe('reject');
    expect(classifyStoredToken([])).toBe('reject');
    expect(classifyStoredToken({ tokenValue: 'nested' })).toBe('reject');
  });

  // worst path: minting overwrites the documentId, which strands every tab
  // group already saved under the existing one. A malformed stored value must
  // never be treated as "absent".
  test('should never mint over a value that is already stored', () => {
    const alreadyStored = [0, false, true, {}, [], 42, { a: 1 }, ['x']];
    for (const value of alreadyStored) {
      expect(classifyStoredToken(value)).not.toBe('mint');
    }
  });
});

// Real capture from Tab Suspender (extension laameccjpleogmfhilmffpdbiibgbekf),
// which wraps the page in a percent-encoded `url` query parameter.
const TAB_SUSPENDER_REAL =
  'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=justine-george%2Ftab-keeper-react-chrome-extension%3A%20Chrome%20extension&url=https%3A%2F%2Fgithub.com%2Fjustine-george%2Ftab-keeper-react-chrome-extension&time=1788097428448';

// The Great Suspender / Marvellous Suspender family instead put the page in the
// hash fragment as a raw, unencoded `uri=` placed last.
const MARVELLOUS_SUSPENDER =
  'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Google&pos=0&uri=https://www.google.com/search?q=tabs&hl=en';

describe('unwrapSuspendedUrl', () => {
  test('should recover the page from a Tab Suspender url parameter', () => {
    expect(unwrapSuspendedUrl(TAB_SUSPENDER_REAL)).toBe(
      'https://github.com/justine-george/tab-keeper-react-chrome-extension'
    );
  });

  test('should recover the page from a hash-fragment uri parameter', () => {
    expect(unwrapSuspendedUrl(MARVELLOUS_SUSPENDER)).toBe(
      'https://www.google.com/search?q=tabs&hl=en'
    );
  });

  // the hash `uri=` value is unencoded and runs to the end of the string, so
  // splitting the fragment on '&' would silently truncate the page's own query
  test('should not truncate a hash uri that contains its own query string', () => {
    const page = 'https://example.com/s?a=1&b=2&c=3';
    const wrapped = `chrome-extension://abc/suspended.html#ttl=T&pos=0&uri=${page}`;
    expect(unwrapSuspendedUrl(wrapped)).toBe(page);
  });

  test('should not truncate an encoded query url that contains its own query string', () => {
    const page = 'https://example.com/s?a=1&b=2&c=3';
    const wrapped = `chrome-extension://abc/suspended.html?url=${encodeURIComponent(
      page
    )}`;
    expect(unwrapSuspendedUrl(wrapped)).toBe(page);
  });

  test('should recover an unknown suspender parameter on a suspend-like page', () => {
    const page = 'https://example.com/article';
    const wrapped = `chrome-extension://zzz/suspended.html?target=${encodeURIComponent(
      page
    )}`;
    expect(unwrapSuspendedUrl(wrapped)).toBe(page);
  });

  test('should leave non-extension urls untouched', () => {
    expect(unwrapSuspendedUrl('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1'
    );
    expect(unwrapSuspendedUrl('chrome://extensions/')).toBe(
      'chrome://extensions/'
    );
    expect(unwrapSuspendedUrl('file:///Users/j/x.pdf')).toBe(
      'file:///Users/j/x.pdf'
    );
    expect(unwrapSuspendedUrl('')).toBe('');
  });

  // worst path: an extension page that merely mentions a url must not be
  // rewritten into that url - the user would be sent somewhere they never saved
  test('should not rewrite an ordinary extension page that carries a url parameter', () => {
    const welcome =
      'chrome-extension://abc/welcome.html?ref=https://tracker.example.com/x';
    expect(unwrapSuspendedUrl(welcome)).toBe(welcome);
  });

  test('should refuse to unwrap to a non-http scheme', () => {
    const hostile = `chrome-extension://abc/suspended.html?url=${encodeURIComponent(
      'javascript:alert(1)'
    )}`;
    expect(unwrapSuspendedUrl(hostile)).toBe(hostile);
  });

  test('should return malformed input unchanged', () => {
    expect(unwrapSuspendedUrl('chrome-extension://')).toBe(
      'chrome-extension://'
    );
  });
});

describe('resolveTabUrl', () => {
  test('should unwrap a suspended url', () => {
    expect(resolveTabUrl(TAB_SUSPENDER_REAL)).toBe(
      'https://github.com/justine-george/tab-keeper-react-chrome-extension'
    );
  });

  test('should still decode a Tab Keeper lazy-load placeholder', () => {
    const url = 'https://github.com/justine-george';
    const placeholder = generatePlaceholderURL('title', 'favicon', url, 'go');
    expect(resolveTabUrl(placeholder)).toBe(url);
  });

  // a suspended tab that was itself saved under lazy load is wrapped twice
  test('should unwrap a placeholder wrapped around a suspended url', () => {
    const page = 'https://example.com/deep?x=1&y=2';
    const suspended = `chrome-extension://abc/suspended.html?url=${encodeURIComponent(
      page
    )}`;
    const placeholder = generatePlaceholderURL('t', 'f', suspended, 'go');
    expect(resolveTabUrl(placeholder)).toBe(page);
  });

  test('should leave an ordinary url untouched', () => {
    expect(resolveTabUrl('https://example.com')).toBe('https://example.com');
    expect(resolveTabUrl('')).toBe('');
  });
});
