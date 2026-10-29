import { describe, expect, test } from 'vitest';

import {
  countLiveDuplicates,
  liveDuplicatesToClose,
} from '../../../utils/functions/liveDuplicates';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';

// KAN-867. Within one window, one copy of each address stays: the active tab,
// else a pinned one, else one in a group, else the first. The rest close.

let nextId = 0;
const tab = (url: string, extra: Partial<OpenTab> = {}): OpenTab => {
  nextId += 1;
  return {
    id: nextId,
    windowId: 1,
    title: url,
    url,
    favIconUrl: '',
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    groupId: null,
    index: nextId,
    ...extra,
  };
};
const win = (id: number, tabs: OpenTab[]): OpenWindow => ({
  id,
  isThisWindow: false,
  tabs: tabs.map((t, index) => ({ ...t, windowId: id, index })),
  groups: [],
  bounds: null,
  state: 'normal',
  incognito: false,
});
const urls = (tabs: OpenTab[]) => tabs.map((t) => `${t.url}#${t.index}`);

const A = 'https://a.test/';
const B = 'https://b.test/';

describe('liveDuplicatesToClose', () => {
  test('the first copy stays when none is active, pinned or grouped', () => {
    const w = win(1, [tab(A), tab(B), tab(A), tab(A)]);
    expect(urls(liveDuplicatesToClose(w))).toEqual([`${A}#2`, `${A}#3`]);
  });

  test('the active copy stays over an earlier one', () => {
    const w = win(1, [tab(A), tab(B), tab(A, { active: true })]);
    expect(urls(liveDuplicatesToClose(w))).toEqual([`${A}#0`]);
  });

  test('pinned beats grouped, grouped beats first', () => {
    const w = win(1, [
      tab(A),
      tab(A, { groupId: 7 }),
      tab(A, { pinned: true }),
      tab(B),
      tab(B, { groupId: 7 }),
    ]);
    expect(urls(liveDuplicatesToClose(w))).toEqual([
      `${A}#0`,
      `${A}#1`,
      `${B}#3`,
    ]);
  });

  test('active beats pinned', () => {
    const w = win(1, [tab(A, { pinned: true }), tab(A, { active: true })]);
    expect(urls(liveDuplicatesToClose(w))).toEqual([`${A}#0`]);
  });

  test('a tab with no address is never a copy', () => {
    const w = win(1, [tab(''), tab(''), tab(A)]);
    expect(liveDuplicatesToClose(w)).toEqual([]);
  });

  test('the closed copies come in strip order', () => {
    const w = win(1, [tab(B), tab(A), tab(B), tab(A), tab(B, { active: true })]);
    expect(urls(liveDuplicatesToClose(w))).toEqual([
      `${B}#0`,
      `${B}#2`,
      `${A}#3`,
    ]);
  });
});

describe('countLiveDuplicates', () => {
  test('the same page in two windows is no copy; each window counts its own', () => {
    const one = win(1, [tab(A), tab(A), tab(B)]);
    const two = win(2, [tab(A), tab(B), tab(B), tab(B)]);
    expect(countLiveDuplicates([one])).toBe(1);
    expect(countLiveDuplicates([one, two])).toBe(3);
    expect(countLiveDuplicates([win(3, [tab(A)]), win(4, [tab(A)])])).toBe(0);
  });
});
