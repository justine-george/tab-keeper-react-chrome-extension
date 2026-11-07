import { describe, expect, test } from 'vitest';

import { tabCarryOut } from '../../components/home/rightpane/carryOut';
import { tab, win } from '../fixtures/sessionMoveFixture';

// KAN-942. A pair's row carries both halves; a half of a broken pair carries alone.
const half = (tabId: string) => ({ ...tab(tabId), splitId: 's' });

describe('tabCarryOut (KAN-942)', () => {
  test('a pair row carries both halves, head first, card in saved order', () => {
    const pane = {
      tabGroupId: 'S',
      windows: [win('w', [tab('a'), half('h1'), half('h2')])],
    };
    const out = tabCarryOut(pane, 'h1');
    expect(out?.item).toEqual({
      source: 'saved',
      ref: {
        kind: 'pair',
        tabGroupId: 'S',
        windowId: 'w',
        tabId: 'h1',
        partnerTabId: 'h2',
      },
    });
    expect(out?.card).toEqual({
      kind: 'pair',
      first: { title: 'h1', faviconUrl: expect.any(String) },
      second: { title: 'h2', faviconUrl: expect.any(String) },
    });
  });

  test('a broken pair half carries alone', () => {
    const pane = {
      tabGroupId: 'S',
      windows: [win('w', [half('h1'), tab('m'), half('h2')])],
    };
    const out = tabCarryOut(pane, 'h1');
    expect(out?.card.kind).toBe('tab');
  });
});
