import { describe, expect, test } from 'vitest';

import {
  leaveOutOpenSpecs,
  leaveOutOpenTabs,
  openCopyOf,
  openPagesOf,
} from '../../utils/functions/skipOpen';
import { placeholderUrl, type WindowSpec } from '../../utils/functions/windows';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

const addr = (name: string) => (name === '' ? '' : `https://${name}.test/`);

let nextId = 0;
const tab = (name: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: `t${nextId++}`,
  favicon: '',
  title: name,
  url: addr(name),
  ...extra,
});

const live = (
  id: number | undefined,
  name: string,
  extra: { pendingUrl?: string } = {}
) => ({ id, index: id ?? 0, url: addr(name), ...extra });

const spec = (
  tabs: tabData[],
  extra: Partial<WindowSpec> = {}
): WindowSpec => ({
  tabs,
  focused: false,
  bounds: null,
  ...extra,
});

const names = (tabs: tabData[]) => tabs.map((t) => t.title);

describe('skipOpen', () => {
  test('leaves out a page the window has', () => {
    const open = openPagesOf([live(7, 'a'), live(8, 'b')]);
    const r = leaveOutOpenTabs([tab('a'), tab('c')], open);
    expect(names(r.tabs)).toEqual(['c']);
    expect(r.leftOut).toBe(1);
  });

  test('a page repeated inside the item opens once', () => {
    const first = tab('a');
    const r = leaveOutOpenTabs([first, tab('a'), tab('b')], openPagesOf([]));
    expect(r.tabs[0]).toBe(first);
    expect(names(r.tabs)).toEqual(['a', 'b']);
    expect(r.leftOut).toBe(1);
  });

  test('a page in two saved windows opens once', () => {
    const r = leaveOutOpenSpecs(
      [spec([tab('a'), tab('b')]), spec([tab('a'), tab('c')])],
      openPagesOf([])
    );
    expect(r.specs.map((s) => names(s.tabs))).toEqual([['a', 'b'], ['c']]);
    expect(r.leftOut).toBe(1);
  });

  test('empty address is never a duplicate', () => {
    const open = openPagesOf([live(1, ''), live(2, 'a')]);
    const r = leaveOutOpenTabs([tab(''), tab('')], open);
    expect(r.tabs).toHaveLength(2);
    expect(r.leftOut).toBe(0);
  });

  test('pendingUrl wins over url', () => {
    const open = openPagesOf([
      live(5, 'old', { pendingUrl: addr('new') }),
      live(6, 'blank', { pendingUrl: '' }),
    ]);
    expect(open.get(addr('new'))).toBe(5);
    expect(open.has(addr('old'))).toBe(false);
    expect(open.get(addr('blank'))).toBe(6);
  });

  test('a live tab without an id is not an open copy', () => {
    expect(openPagesOf([live(undefined, 'a')]).size).toBe(0);
  });

  test('first tab in window order holds the page', () => {
    const open = openPagesOf([
      { id: 9, index: 3, url: addr('a') },
      { id: 4, index: 1, url: addr('a') },
    ]);
    expect(open.get(addr('a'))).toBe(4);
  });

  test('placeholder counts as its page', () => {
    const saved = tab('a');
    const open = openPagesOf([
      {
        id: 3,
        index: 0,
        url: placeholderUrl(saved, '', 'Go to page'),
      },
    ]);
    const r = leaveOutOpenTabs([saved, tab('b')], open);
    expect(names(r.tabs)).toEqual(['b']);
    expect(r.alreadyOpen).toEqual([3]);
    expect(openCopyOf(saved, open)).toBe(3);
  });

  test('a saved placeholder matches a live page', () => {
    const saved = tab('a');
    const wrapped = { ...saved, url: placeholderUrl(saved, '', 'Go') };
    const r = leaveOutOpenTabs([wrapped], openPagesOf([live(2, 'a')]));
    expect(r.tabs).toEqual([]);
    expect(r.alreadyOpen).toEqual([2]);
  });

  test('split pair kept whole unless both halves are open', () => {
    const pair = () => [tab('a', { splitId: 's' }), tab('b', { splitId: 's' })];
    const one = leaveOutOpenTabs(pair(), openPagesOf([live(1, 'a')]));
    expect(names(one.tabs)).toEqual(['a', 'b']);
    expect(one.leftOut).toBe(0);
    const both = leaveOutOpenTabs(
      pair(),
      openPagesOf([live(1, 'a'), live(2, 'b')])
    );
    expect(both.tabs).toEqual([]);
    expect(both.leftOut).toBe(2);
  });

  test('group with every tab left out is pruned, one with some kept', () => {
    const tabs = [
      tab('a', { chromeGroupId: 'g1' }),
      tab('b', { chromeGroupId: 'g2' }),
      tab('c', { chromeGroupId: 'g2' }),
    ];
    const groups = [
      { groupId: 'g1', title: 'one', color: 'blue' },
      { groupId: 'g2', title: 'two', color: 'red' },
    ];
    const r = leaveOutOpenSpecs(
      [spec(tabs, { groups })],
      openPagesOf([live(1, 'a'), live(2, 'b')])
    );
    expect(r.specs[0]?.groups).toEqual([groups[1]]);
    expect(names(r.specs[0]?.tabs ?? [])).toEqual(['c']);
  });

  test('spec with no tabs left is dropped', () => {
    const r = leaveOutOpenSpecs(
      [spec([tab('a')]), spec([tab('b')])],
      openPagesOf([live(1, 'a')])
    );
    expect(r.specs).toHaveLength(1);
    expect(names(r.specs[0]?.tabs ?? [])).toEqual(['b']);
  });

  test('activeTabId dropped when its tab is left out', () => {
    const a = tab('a');
    const b = tab('b');
    const open = openPagesOf([live(1, 'a')]);
    const gone = leaveOutOpenSpecs(
      [spec([a, b], { activeTabId: a.tabId })],
      open
    );
    expect(gone.specs[0]).not.toHaveProperty('activeTabId');
    const stays = leaveOutOpenSpecs(
      [spec([a, b], { activeTabId: b.tabId })],
      open
    );
    expect(stays.specs[0]?.activeTabId).toBe(b.tabId);
  });

  test('other spec fields stay as they were', () => {
    const bounds = { left: 1, top: 2, width: 3, height: 4 };
    const r = leaveOutOpenSpecs(
      [
        spec([tab('a'), tab('b')], {
          focused: true,
          bounds,
          state: 'maximized',
          incognito: true,
        }),
      ],
      openPagesOf([live(1, 'a')])
    );
    expect(r.specs[0]).toMatchObject({
      focused: true,
      bounds,
      state: 'maximized',
      incognito: true,
    });
  });

  test('alreadyOpen lists the open copies in saved order', () => {
    const open = openPagesOf([live(30, 'a'), live(10, 'b'), live(20, 'c')]);
    const r = leaveOutOpenTabs(
      [tab('c'), tab('x'), tab('a'), tab('c'), tab('b')],
      open
    );
    expect(r.alreadyOpen).toEqual([20, 30, 10]);
    expect(r.leftOut).toBe(4);
  });

  test('a repeat of an earlier saved tab adds no open copy', () => {
    const r = leaveOutOpenTabs(
      [tab('x'), tab('x')],
      openPagesOf([live(1, 'a')])
    );
    expect(r.leftOut).toBe(1);
    expect(r.alreadyOpen).toEqual([]);
  });

  test('nothing open → specs unchanged, leftOut 0', () => {
    const specs = [spec([tab('a'), tab('b')]), spec([tab('c')])];
    const r = leaveOutOpenSpecs(specs, openPagesOf([]));
    expect(r.specs).toEqual(specs);
    expect(r.specs[0]).toBe(specs[0]);
    expect(r.leftOut).toBe(0);
    expect(r.alreadyOpen).toEqual([]);
  });
});
