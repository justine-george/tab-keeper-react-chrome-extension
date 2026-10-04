import { describe, expect, test } from 'vitest';

import {
  hasUsedFullView,
  shouldOfferFullView,
} from '../../../utils/functions/onboarding';

// KAN-7 §§3, 6. Pure predicates over settingsData.

const NEVER_USED = {
  hasOpenedFullView: false,
  openNowWidth: null,
  foldSavedSessionInTabView: true,
};

describe('hasUsedFullView', () => {
  test('a machine that never opened it', () => {
    expect(hasUsedFullView(NEVER_USED)).toBe(false);
  });

  // Only the full view writes the other two, so either is use before KAN-7.
  test.each([
    ['opened since KAN-7', { hasOpenedFullView: true }],
    ['dragged Open now', { openNowWidth: 500 }],
    ['unfolded the saved session', { foldSavedSessionInTabView: false }],
  ])('%s', (_name, change) => {
    expect(hasUsedFullView({ ...NEVER_USED, ...change })).toBe(true);
  });
});

describe('shouldOfferFullView', () => {
  const PENDING = {
    ...NEVER_USED,
    setupState: 'pending' as const,
    isFullViewOfferAnswered: false,
  };

  test('a new install that has not answered', () => {
    expect(shouldOfferFullView(PENDING)).toBe(true);
  });

  test.each([
    ['an existing user (setup never started)', { setupState: 'none' as const }],
    ['answered', { isFullViewOfferAnswered: true }],
    ['the full view already opened', { hasOpenedFullView: true }],
    [
      'setup already done, full view used',
      { setupState: 'done' as const, hasOpenedFullView: true },
    ],
  ])('not for %s', (_name, change) => {
    expect(shouldOfferFullView({ ...PENDING, ...change })).toBe(false);
  });
});
