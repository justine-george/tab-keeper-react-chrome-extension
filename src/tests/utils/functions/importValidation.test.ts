import { describe, expect, test } from 'vitest';

import { isValidTabMasterContainer } from '../../../utils/functions/local';

function container(windowOverrides: Record<string, unknown> = {}) {
  return {
    lastModified: 1,
    selectedTabGroupId: null,
    tabGroups: [
      {
        tabGroupId: 'tg1',
        title: 'session',
        createdTime: '2026-09-03 10:00:00',
        windowCount: 1,
        tabCount: 1,
        isAutoSave: false,
        isSelected: false,
        windows: [
          {
            windowId: 'w1',
            tabCount: 1,
            title: 'window',
            tabs: [
              { tabId: 't1', favicon: '', title: 'a', url: 'https://a.test' },
            ],
            ...windowOverrides,
          },
        ],
      },
    ],
  };
}

describe('isValidTabMasterContainer with tab groups', () => {
  test('accepts a container with no group fields at all', () => {
    expect(isValidTabMasterContainer(container())).toBe(true);
  });

  test('accepts a well-formed chromeTabGroups array', () => {
    expect(
      isValidTabMasterContainer(
        container({
          chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
        })
      )
    ).toBe(true);
  });

  // The resilience case, and the reason this file exists. A tenth Chrome
  // colour, or a newer client, must never cost the user their whole account.
  test('accepts a colour this build has never heard of', () => {
    expect(
      isValidTabMasterContainer(
        container({
          chromeTabGroups: [
            { groupId: 'g1', title: 'Work', color: 'chartreuse' },
          ],
        })
      )
    ).toBe(true);
  });

  test('rejects chromeTabGroups that is not an array', () => {
    expect(
      isValidTabMasterContainer(container({ chromeTabGroups: 'blue' }))
    ).toBe(false);
  });

  test('rejects a group entry missing groupId', () => {
    expect(
      isValidTabMasterContainer(
        container({ chromeTabGroups: [{ title: 'Work', color: 'blue' }] })
      )
    ).toBe(false);
  });

  test('rejects a group entry whose colour is not a string', () => {
    expect(
      isValidTabMasterContainer(
        container({
          chromeTabGroups: [{ groupId: 'g1', title: 'W', color: 3 }],
        })
      )
    ).toBe(false);
  });

  test('accepts a tab with a string chromeGroupId', () => {
    expect(
      isValidTabMasterContainer(
        container({
          tabs: [
            {
              tabId: 't1',
              favicon: '',
              title: 'a',
              url: 'https://a.test',
              chromeGroupId: 'g1',
            },
          ],
        })
      )
    ).toBe(true);
  });

  test('rejects a tab whose chromeGroupId is not a string', () => {
    expect(
      isValidTabMasterContainer(
        container({
          tabs: [
            {
              tabId: 't1',
              favicon: '',
              title: 'a',
              url: 'https://a.test',
              chromeGroupId: 7,
            },
          ],
        })
      )
    ).toBe(false);
  });
});

// KAN-458. Absent is every session saved before the fields; a malformed value is a hand edit.
const withTab = (fields: Record<string, unknown>) =>
  container({
    tabs: [
      {
        tabId: 't1',
        favicon: '',
        title: 'a',
        url: 'https://a.test',
        ...fields,
      },
    ],
  });

describe('isValidTabMasterContainer with pinned and active tabs (KAN-458)', () => {
  test('accepts a tab with pinned: true', () => {
    expect(isValidTabMasterContainer(withTab({ pinned: true }))).toBe(true);
  });

  test.each([
    ['false', false],
    ['a string', 'yes'],
    ['null', null],
  ])('rejects pinned as %s', (_, value) => {
    expect(isValidTabMasterContainer(withTab({ pinned: value }))).toBe(false);
  });

  test('accepts a window whose activeTabId names one of its tabs', () => {
    expect(isValidTabMasterContainer(container({ activeTabId: 't1' }))).toBe(
      true
    );
  });

  test('accepts an activeTabId that names no tab: restore falls back', () => {
    expect(isValidTabMasterContainer(container({ activeTabId: 'gone' }))).toBe(
      true
    );
  });

  test('rejects an activeTabId that is not a string', () => {
    expect(isValidTabMasterContainer(container({ activeTabId: 7 }))).toBe(
      false
    );
  });
});

// KAN-460 D6. A group's `collapsed` is true or absent, never false.
describe("a saved group's collapsed field (KAN-460)", () => {
  const withGroup = (group: Record<string, unknown>) => ({
    lastModified: 1,
    selectedTabGroupId: null,
    tabGroups: [
      {
        tabGroupId: 's',
        title: 'S',
        createdTime: '2026-10-08 10:00:00',
        windowCount: 1,
        tabCount: 1,
        isAutoSave: false,
        isSelected: false,
        windows: [
          {
            windowId: 'w',
            windowHeight: 800,
            windowWidth: 1200,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 1,
            title: '',
            tabs: [
              {
                tabId: 't',
                favicon: '',
                title: 't',
                url: 'https://t.test/',
                chromeGroupId: 'g',
              },
            ],
            chromeTabGroups: [
              { groupId: 'g', title: 'G', color: 'blue', ...group },
            ],
          },
        ],
      },
    ],
  });

  test('absent and true are valid', () => {
    expect(isValidTabMasterContainer(withGroup({}))).toBe(true);
    expect(isValidTabMasterContainer(withGroup({ collapsed: true }))).toBe(
      true
    );
  });

  test('false and a non-boolean are not', () => {
    expect(isValidTabMasterContainer(withGroup({ collapsed: false }))).toBe(
      false
    );
    expect(isValidTabMasterContainer(withGroup({ collapsed: 'yes' }))).toBe(
      false
    );
  });
});

// KAN-460 D2/D6. A window's state is maximized, fullscreen or absent.
describe("a saved window's state field (KAN-460)", () => {
  const withWindow = (extra: Record<string, unknown>) => ({
    lastModified: 1,
    selectedTabGroupId: null,
    tabGroups: [
      {
        tabGroupId: 's',
        title: 'S',
        createdTime: '2026-10-08 10:00:00',
        windowCount: 1,
        tabCount: 1,
        isAutoSave: false,
        isSelected: false,
        windows: [
          {
            windowId: 'w',
            windowHeight: 800,
            windowWidth: 1200,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 1,
            title: '',
            tabs: [
              { tabId: 't', favicon: '', title: 't', url: 'https://t.test/' },
            ],
            ...extra,
          },
        ],
      },
    ],
  });

  test('absent, maximized and fullscreen are valid', () => {
    expect(isValidTabMasterContainer(withWindow({}))).toBe(true);
    expect(isValidTabMasterContainer(withWindow({ state: 'maximized' }))).toBe(
      true
    );
    expect(isValidTabMasterContainer(withWindow({ state: 'fullscreen' }))).toBe(
      true
    );
  });

  test('minimized, normal and a non-string are not', () => {
    expect(isValidTabMasterContainer(withWindow({ state: 'minimized' }))).toBe(
      false
    );
    expect(isValidTabMasterContainer(withWindow({ state: 'normal' }))).toBe(
      false
    );
    expect(isValidTabMasterContainer(withWindow({ state: 1 }))).toBe(false);
  });
});
