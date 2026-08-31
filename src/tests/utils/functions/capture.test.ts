import { describe, expect, test } from 'vitest';

import { isAlreadySaved } from '../../../utils/functions/capture';
import type {
  tabContainerData,
  windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';

function windowOf(...urls: string[]): windowGroupData {
  return {
    windowId: 'w',
    windowHeight: 700,
    windowWidth: 900,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: urls.length,
    title: 'a window',
    tabs: urls.map((url, index) => ({
      tabId: `t${index}`,
      favicon: '',
      title: url,
      url,
    })),
  };
}

function sessionOf(...windows: windowGroupData[]): tabContainerData {
  return {
    tabGroupId: 'g',
    title: 'a session',
    createdTime: '2026-08-31 12:00:00',
    windowCount: windows.length,
    tabCount: windows.reduce((total, w) => total + w.tabs.length, 0),
    isAutoSave: false,
    isSelected: false,
    windows,
  };
}

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

describe('isAlreadySaved', () => {
  test('recognises the session the windows were restored from', () => {
    const captured = sessionOf(windowOf(A, B), windowOf(C));
    const saved = sessionOf(windowOf(A, B), windowOf(C));

    expect(isAlreadySaved(captured, [saved])).toBe(true);
  });

  test('ignores window order, which chrome.windows.getAll does not promise', () => {
    const captured = sessionOf(windowOf(C), windowOf(A, B));
    const saved = sessionOf(windowOf(A, B), windowOf(C));

    expect(isAlreadySaved(captured, [saved])).toBe(true);
  });

  test('finds the match among several saved sessions', () => {
    const captured = sessionOf(windowOf(C));

    expect(
      isAlreadySaved(captured, [sessionOf(windowOf(A)), sessionOf(windowOf(C))])
    ).toBe(true);
  });

  test('treats an extra tab as unsaved work', () => {
    const captured = sessionOf(windowOf(A, B, C));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats an extra window as unsaved work', () => {
    const captured = sessionOf(windowOf(A), windowOf(B));
    const saved = sessionOf(windowOf(A));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats a navigated tab as unsaved work', () => {
    const captured = sessionOf(windowOf(A, C));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('treats reordered tabs within a window as unsaved work', () => {
    const captured = sessionOf(windowOf(B, A));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  // The dangerous near-miss: one window is stored and the other is not, so
  // treating the pair as saved would close unsaved work. Every window has to
  // match, not just one of them.
  test('treats a partial match as unsaved work', () => {
    const captured = sessionOf(windowOf(A, B), windowOf(C));
    const saved = sessionOf(
      windowOf(A, B),
      windowOf('https://elsewhere.example')
    );

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('does not let two windows add up to one saved window', () => {
    const captured = sessionOf(windowOf(A), windowOf(B));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('does not treat a separator inside a URL as a window boundary', () => {
    const captured = sessionOf(windowOf(`${A}\n${B}`));
    const saved = sessionOf(windowOf(A, B));

    expect(isAlreadySaved(captured, [saved])).toBe(false);
  });

  test('is false when nothing has been saved yet', () => {
    expect(isAlreadySaved(sessionOf(windowOf(A)), [])).toBe(false);
  });
});
