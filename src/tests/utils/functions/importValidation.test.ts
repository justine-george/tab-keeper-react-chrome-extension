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
