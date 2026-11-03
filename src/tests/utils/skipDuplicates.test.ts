import { describe, expect, test } from 'vitest';

import {
  leaveOutDuplicates,
  urlsIn,
  withoutRepeats,
} from '../../utils/functions/skipDuplicates';
import { buildSession } from '../fixtures/sessionFixture';
import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

const addr = (name: string) => (name === '' ? '' : `https://${name}.test/`);

let nextId = 0;
const tab = (name: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: `t${nextId++}`,
  favicon: '',
  title: name,
  url: addr(name),
  ...extra,
});

const win = (
  id: string,
  tabs: tabData[],
  extra: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: '',
  tabs,
  ...extra,
});

const names = (w: windowGroupData) => w.tabs.map((t) => t.title);
const none = new Set<string>();

describe('leaveOutDuplicates (KAN-906)', () => {
  test('keeps the first copy in reading order and counts the rest', () => {
    const out = leaveOutDuplicates(
      [
        win('w1', [tab('a'), tab('b'), tab('a')]),
        win('w2', [tab('b'), tab('c')]),
      ],
      none
    );
    expect(out.windows.map(names)).toEqual([['a', 'b'], ['c']]);
    expect(out.leftOut).toBe(2);
  });

  test('leaves out what the session already has', () => {
    const out = leaveOutDuplicates(
      [win('w1', [tab('a'), tab('b')])],
      new Set([addr('a')])
    );
    expect(out.windows.map(names)).toEqual([['b']]);
    expect(out.leftOut).toBe(1);
  });

  test('a tab with no address is never a duplicate', () => {
    const out = leaveOutDuplicates([win('w1', [tab(''), tab('')])], none);
    expect(out.windows[0].tabs).toHaveLength(2);
    expect(out.leftOut).toBe(0);
  });

  test('a window left empty is not added; a group left empty is dropped', () => {
    const groups = [
      { groupId: 'g1', title: 'one', color: 'blue' },
      { groupId: 'g2', title: 'two', color: 'red' },
    ];
    const out = leaveOutDuplicates(
      [
        win(
          'w1',
          [
            tab('a', { chromeGroupId: 'g1' }),
            tab('b', { chromeGroupId: 'g2' }),
          ],
          {
            chromeTabGroups: groups,
          }
        ),
        win('w2', [tab('a')]),
      ],
      new Set([addr('a')])
    );
    expect(out.windows.map((w) => w.windowId)).toEqual(['w1']);
    expect(out.windows[0].chromeTabGroups).toEqual([groups[1]]);
  });

  test('tabCount follows the tabs kept', () => {
    const out = leaveOutDuplicates(
      [win('w1', [tab('a'), tab('a'), tab('b')])],
      none
    );
    expect(out.windows[0].tabCount).toBe(2);
    expect(out.windows[0].tabCount).toBe(out.windows[0].tabs.length);
  });

  test('a split pair stays whole unless both halves are there', () => {
    const pair = () =>
      win('w1', [
        tab('a', { splitId: 's' }),
        tab('x', { splitId: 's' }),
        tab('y'),
      ]);
    const half = leaveOutDuplicates([pair()], new Set([addr('a')]));
    expect(half.windows.map(names)).toEqual([['a', 'x', 'y']]);
    expect(half.leftOut).toBe(0);

    const both = leaveOutDuplicates([pair()], new Set([addr('a'), addr('x')]));
    expect(both.windows.map(names)).toEqual([['y']]);
    expect(both.leftOut).toBe(2);
  });

  test('a split pair whose halves are not next to each other is still one unit', () => {
    const out = leaveOutDuplicates(
      [
        win('w1', [
          tab('a', { splitId: 's' }),
          tab('y'),
          tab('x', { splitId: 's' }),
        ]),
      ],
      new Set([addr('a'), addr('x')])
    );
    expect(out.windows.map(names)).toEqual([['y']]);
    expect(out.leftOut).toBe(2);
  });

  test('the inputs are not changed', () => {
    const windows = [
      win('w1', [tab('a', { chromeGroupId: 'g' }), tab('a')], {
        chromeTabGroups: [{ groupId: 'g', title: 't', color: 'blue' }],
      }),
    ];
    const already = new Set([addr('a')]);
    const before = structuredClone(windows);
    leaveOutDuplicates(windows, already);
    expect(windows).toEqual(before);
    expect([...already]).toEqual([addr('a')]);
  });
});

describe('urlsIn (KAN-906)', () => {
  test('lists every non-empty address in the session', () => {
    const session = buildSession({
      windows: [
        win('w1', [tab('a'), tab('')]),
        win('w2', [tab('b'), tab('a')]),
      ],
    });
    expect(urlsIn(session)).toEqual(new Set([addr('a'), addr('b')]));
  });
});

describe('withoutRepeats (KAN-906)', () => {
  test('recounts the container', () => {
    const session = buildSession({
      windowCount: 2,
      tabCount: 3,
      windows: [win('w1', [tab('a'), tab('a')]), win('w2', [tab('a')])],
    });
    const out = withoutRepeats(session);
    expect(out.leftOut).toBe(2);
    expect(out.container.windowCount).toBe(1);
    expect(out.container.tabCount).toBe(1);
    expect(session.windows).toHaveLength(2);
  });
});
