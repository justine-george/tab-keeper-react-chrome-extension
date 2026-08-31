import { describe, it, expect } from 'vitest';

import { mergeTabContainers } from '../../../utils/functions/mergeTabData';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';

// No DOM stub anywhere in this file, and that absence IS an assertion: the
// merge module must stay importable under vitest's node environment.
//
// Note what this does and does not catch. Merely rewriting mergeTabData's
// `import type` as a plain `import` is invisible here, because esbuild elides
// imports whose bindings are only used as types. What it does catch is the
// change that actually matters - a slice export used as a runtime value -
// which drags in common.ts and fails every test below with
// `ReferenceError: window is not defined`. Confirmed by doing exactly that.
// Do not add stubDomGlobals() to this file to "fix" such a failure; it is the
// warning working.

const NOW = 1_000_000;

function group(id: string, lastModified?: number): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

function container(
  lastModified: number,
  tabGroups: tabContainerData[],
  selectedTabGroupId: string | null = null
): TabMasterContainer {
  return { lastModified, selectedTabGroupId, tabGroups };
}

const ids = (c: TabMasterContainer) => c.tabGroups.map((g) => g.tabGroupId);

describe('mergeTabContainers - union and per-session LWW', () => {
  it('keeps a session that exists only on the local side', () => {
    const local = container(10, [group('a', 10)]);
    const cloud = container(20, [group('b', 20)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps a session that exists only on the cloud side', () => {
    const local = container(20, [group('b', 20)]);
    const cloud = container(10, [group('a', 10)]);
    expect(ids(mergeTabContainers(local, cloud, NOW).merged).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('takes the newer version when both sides edited the same session', () => {
    const localA = { ...group('a', 50), title: 'LOCAL' };
    const cloudA = { ...group('a', 99), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(50, [localA]),
      container(99, [cloudA]),
      NOW
    );
    expect(merged.tabGroups).toHaveLength(1);
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('takes local when local is newer', () => {
    const localA = { ...group('a', 99), title: 'LOCAL' };
    const cloudA = { ...group('a', 50), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(99, [localA]),
      container(50, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('gives an exact tie to cloud, so two devices converge', () => {
    const localA = { ...group('a', 77), title: 'LOCAL' };
    const cloudA = { ...group('a', 77), title: 'CLOUD' };
    const { merged } = mergeTabContainers(
      container(77, [localA]),
      container(77, [cloudA]),
      NOW
    );
    expect(merged.tabGroups[0].title).toBe('CLOUD');
  });

  it('falls back to the container timestamp for pre-migration sessions', () => {
    // neither side has per-session timestamps
    const local = container(10, [group('a'), group('shared')]);
    const cloud = container(20, [
      { ...group('shared'), title: 'CLOUD' },
      group('b'),
    ]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    expect(ids(merged).sort()).toEqual(['a', 'b', 'shared']);
    // cloud container is newer (20 > 10), so its version of `shared` wins
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'shared')!.title).toBe(
      'CLOUD'
    );
  });

  it('handles one migrated side and one not', () => {
    const local = container(10, [{ ...group('a', 999), title: 'LOCAL' }]);
    const cloud = container(20, [{ ...group('a'), title: 'CLOUD' }]);
    const { merged } = mergeTabContainers(local, cloud, NOW);
    // local's explicit 999 beats cloud's inherited 20
    expect(merged.tabGroups[0].title).toBe('LOCAL');
  });

  it('survives an empty local side', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, [group('a', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('survives an empty cloud side', () => {
    const { merged } = mergeTabContainers(
      container(20, [group('a', 20)]),
      container(10, []),
      NOW
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('normalizes every surviving session to carry a lastModified', () => {
    const { merged } = mergeTabContainers(
      container(10, [group('a')]),
      container(20, [group('b')]),
      NOW
    );
    expect(
      merged.tabGroups.every((g) => typeof g.lastModified === 'number')
    ).toBe(true);
  });

  it('takes the max container timestamp, never `now`', () => {
    const { merged } = mergeTabContainers(
      container(10, []),
      container(20, []),
      NOW
    );
    expect(merged.lastModified).toBe(20);
  });

  it('sorts newest first', () => {
    const { merged } = mergeTabContainers(
      container(30, [group('old', 1), group('new', 30)]),
      container(20, [group('mid', 20)]),
      NOW
    );
    expect(ids(merged)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps the local selection when its session survives', () => {
    const { merged } = mergeTabContainers(
      container(30, [group('a', 30)], 'a'),
      container(20, [group('b', 20)], 'b'),
      NOW
    );
    expect(merged.selectedTabGroupId).toBe('a');
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'a')!.isSelected).toBe(
      true
    );
    expect(merged.tabGroups.find((g) => g.tabGroupId === 'b')!.isSelected).toBe(
      false
    );
  });

  it('reports both sides unchanged when they already agree', () => {
    const same = () => container(30, [group('a', 30)], 'a');
    const r = mergeTabContainers(same(), same(), NOW);
    expect(r.changedFromLocal).toBe(false);
    expect(r.changedFromCloud).toBe(false);
  });

  it('reports changedFromCloud when local contributes a session', () => {
    const r = mergeTabContainers(
      container(30, [group('a', 30)]),
      container(20, []),
      NOW
    );
    expect(r.changedFromCloud).toBe(true);
    expect(r.changedFromLocal).toBe(false);
  });

  it('reports changedFromLocal when cloud contributes a session', () => {
    const r = mergeTabContainers(
      container(20, []),
      container(30, [group('a', 30)]),
      NOW
    );
    expect(r.changedFromLocal).toBe(true);
    expect(r.changedFromCloud).toBe(false);
  });
});
