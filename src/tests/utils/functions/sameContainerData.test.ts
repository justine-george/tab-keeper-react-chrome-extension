import { describe, it, expect } from 'vitest';

import { sameContainerData } from '../../../utils/functions/sameContainerData';
import { mergeTabContainers } from '../../../utils/functions/mergeTabData';
import { buildContainer, buildSession } from '../../fixtures/sessionFixture';
import type { TabMasterContainer } from '../../../redux/slices/tabContainerDataStateSlice';

// KAN-279 D9. Each row pairs two containers with a literal true/false: does
// sameContainerData see them as the same DATA? Selection (selectedTabGroupId,
// isSelected) is view state and must be ignored; everything else is data.
describe('sameContainerData', () => {
  it('is true for identical containers', () => {
    expect(sameContainerData(buildContainer(), buildContainer())).toBe(true);
  });

  it('is true when object keys are reordered', () => {
    // Two structurally-equal TabMasterContainers, written with every object's
    // keys in the opposite order at every level (container, session, window,
    // tab). No cast is needed: TS object literals check structurally
    // regardless of key order, so this only proves the fixture is right if the
    // two literals below really do differ in key order, which they do.
    const a: TabMasterContainer = {
      lastModified: 1000,
      selectedTabGroupId: null,
      tabGroups: [
        {
          tabGroupId: 'session-1',
          title: 'Research',
          createdTime: '2026-09-01 09:00:00',
          createdAt: 1000,
          windowCount: 1,
          tabCount: 1,
          isAutoSave: false,
          isSelected: false,
          windows: [
            {
              windowId: 'window-1',
              windowHeight: 1080,
              windowWidth: 1920,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 1,
              title: 'Morning reading',
              tabs: [
                {
                  tabId: 'tab-1',
                  favicon: '',
                  title: 'Example Domain',
                  url: 'https://example.com/',
                },
              ],
            },
          ],
        },
      ],
    };
    const b: TabMasterContainer = {
      selectedTabGroupId: null,
      lastModified: 1000,
      tabGroups: [
        {
          windows: [
            {
              tabs: [
                {
                  url: 'https://example.com/',
                  title: 'Example Domain',
                  favicon: '',
                  tabId: 'tab-1',
                },
              ],
              title: 'Morning reading',
              tabCount: 1,
              windowOffsetLeft: 0,
              windowOffsetTop: 0,
              windowWidth: 1920,
              windowHeight: 1080,
              windowId: 'window-1',
            },
          ],
          isSelected: false,
          isAutoSave: false,
          tabCount: 1,
          windowCount: 1,
          createdAt: 1000,
          createdTime: '2026-09-01 09:00:00',
          title: 'Research',
          tabGroupId: 'session-1',
        },
      ],
    };
    expect(sameContainerData(a, b)).toBe(true);
  });

  it('is true when deletedTabGroups is absent on one side and [] on the other', () => {
    const a = buildContainer();
    const b: TabMasterContainer = { ...buildContainer(), deletedTabGroups: [] };
    expect(sameContainerData(a, b)).toBe(true);
  });

  it('is true when selectedTabGroupId differs', () => {
    const a = buildContainer();
    const b: TabMasterContainer = {
      ...buildContainer(),
      selectedTabGroupId: 'session-1',
    };
    expect(sameContainerData(a, b)).toBe(true);
  });

  it('is true when isSelected differs', () => {
    const a = buildContainer();
    const b = buildContainer([buildSession({ isSelected: true })]);
    expect(sameContainerData(a, b)).toBe(true);
  });

  it('is false when a title differs', () => {
    const a = buildContainer();
    const b = buildContainer([buildSession({ title: 'Different' })]);
    expect(sameContainerData(a, b)).toBe(false);
  });

  it('is false when a tab url differs', () => {
    const a = buildContainer();
    const session = buildSession();
    const b = buildContainer([
      {
        ...session,
        windows: [
          {
            ...session.windows[0],
            tabs: [
              {
                ...session.windows[0].tabs[0],
                url: 'https://different.example/',
              },
            ],
          },
        ],
      },
    ]);
    expect(sameContainerData(a, b)).toBe(false);
  });

  it('is false when a tombstone is added', () => {
    const a = buildContainer();
    const b: TabMasterContainer = {
      ...buildContainer(),
      deletedTabGroups: [{ tabGroupId: 'gone', deletedAt: 2000 }],
    };
    expect(sameContainerData(a, b)).toBe(false);
  });

  it('is false when container lastModified differs', () => {
    const a = buildContainer();
    const b: TabMasterContainer = { ...buildContainer(), lastModified: 2000 };
    expect(sameContainerData(a, b)).toBe(false);
  });

  it('is false when session order differs', () => {
    const s1 = buildSession({ tabGroupId: 's1' });
    const s2 = buildSession({ tabGroupId: 's2' });
    const a = buildContainer([s1, s2]);
    const b = buildContainer([s2, s1]);
    expect(sameContainerData(a, b)).toBe(false);
  });

  it('is true for a session without lastModified vs the same session stamped with the container lastModified', () => {
    const a = buildContainer([buildSession()]);
    const b = buildContainer([buildSession({ lastModified: a.lastModified })]);
    expect(sameContainerData(a, b)).toBe(true);
  });

  it('is false for a session without lastModified vs the same session stamped with a different lastModified', () => {
    const a = buildContainer([buildSession()]);
    const b = buildContainer([
      buildSession({ lastModified: a.lastModified + 1 }),
    ]);
    expect(sameContainerData(a, b)).toBe(false);
  });

  // Step 6: the spec asks for a measurement, not just a table row. Controller
  // measured on 2026-09-23: with the plan's original compare (no `?? c.lastModified`
  // fallback in dataOf), (a) was equal (byte-identical, even) and (b) was
  // unequal once. Justine ruled the fallback so both are equal -- if either of
  // these fails, STOP: it means the no-change rule would wipe undo on every
  // popup open, which is a design question, not a test to adjust.
  describe('measurement: an in-sync self-merge must read as no change', () => {
    const NOW = 2_000_000;

    it('(a) real stored shape -- every session already carries lastModified', () => {
      const seed = buildContainer([buildSession()]);
      // One merge stamps every session's lastModified (see mergeTabData.ts),
      // producing the shape actually written to Firestore and localStorage.
      const { merged: x } = mergeTabContainers(seed, seed, NOW);
      const { merged } = mergeTabContainers(x, structuredClone(x), NOW);
      expect(sameContainerData(merged, x)).toBe(true);
    });

    it('(b) legacy shape -- sessions lack lastModified', () => {
      const x = buildContainer([buildSession()]);
      const { merged } = mergeTabContainers(x, structuredClone(x), NOW);
      expect(sameContainerData(merged, x)).toBe(true);
    });
  });
});
