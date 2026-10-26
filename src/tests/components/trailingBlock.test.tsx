import { describe, expect, test } from 'vitest';

import { isTrailingBlock } from '../../components/home/rightpane/rowDrag/dropRules';
import {
  OPEN_NOW_FIRST_TARGET,
  OPEN_NOW_LAST_TARGET,
} from '../../components/home/rightpane/newWindowTarget';

// KAN-366 B, KAN-815. The block below a list's last window, where a carried
// tab's or group's phantom rests: the saved pane's, and Open now's.
const block = (target?: string) => {
  const el = document.createElement('div');
  if (target !== undefined) el.dataset.newWindowTarget = target;
  return el;
};

describe('isTrailingBlock', () => {
  test("the saved pane's and Open now's blocks below the last window", () => {
    expect(isTrailingBlock(block('last'))).toBe(true);
    expect(isTrailingBlock(block(OPEN_NOW_LAST_TARGET))).toBe(true);
  });

  test('never a header box or a window', () => {
    expect(isTrailingBlock(block('first'))).toBe(false);
    expect(isTrailingBlock(block(OPEN_NOW_FIRST_TARGET))).toBe(false);
    expect(isTrailingBlock(block())).toBe(false);
  });
});
