import { describe, it, expect } from 'vitest';

import real from '../../fixtures/realTabContainerData.json';
import { isValidTabMasterContainer } from '../../../utils/functions/local';

// isValidTabMasterContainer requires createdTime, windowCount, tabCount,
// isAutoSave and isSelected on every group. Nothing guaranteed that a session
// saved by a real profile carries all five - if any predated a field, wiring
// the validator into the sync path would reject valid data and fall back to
// the cloud copy, trading a corruption bug for a data-loss bug.
//
// The fixture is a verbatim capture of localStorage.tabContainerData from a
// profile running the built extension (three sessions saved through the real
// UI, one of them spanning two windows).
describe('validator against real saved data', () => {
  it('accepts a container captured from a real profile', () => {
    // The premise: a populated capture, not a minimal stand-in that would pass
    // while proving nothing about real saved sessions.
    expect(real.tabGroups.length).toBeGreaterThanOrEqual(3);
    expect(real.tabGroups.some((g) => g.windows.length > 1)).toBe(true);
    expect(
      real.tabGroups.every((g) => g.windows.every((w) => w.tabs.length > 0))
    ).toBe(true);

    expect(isValidTabMasterContainer(real)).toBe(true);
  });
});
