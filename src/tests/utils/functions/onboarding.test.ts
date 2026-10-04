import { describe, expect, test } from 'vitest';

import {
  hasUsedFullView,
  shouldOfferFullView,
  shouldShowFullViewCallout,
  shouldShowPinGuide,
  shouldShowSetup,
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

describe('shouldShowPinGuide', () => {
  test('unpinned, not dismissed', () => {
    expect(shouldShowPinGuide({ isPinGuideDismissed: false }, 'unpinned')).toBe(
      true
    );
  });

  test.each([
    ['pinned', false, 'pinned'],
    ['unknown (API missing or throwing)', false, 'unknown'],
    ['dismissed here', true, 'unpinned'],
  ] as const)('not when %s', (_name, isPinGuideDismissed, pin) => {
    expect(shouldShowPinGuide({ isPinGuideDismissed }, pin)).toBe(false);
  });
});

describe('shouldShowSetup', () => {
  test.each([
    ['pending', true],
    ['none', false],
    ['done', false],
  ] as const)('%s → %s', (setupState, expected) => {
    expect(shouldShowSetup({ setupState })).toBe(expected);
  });
});

describe('shouldShowFullViewCallout', () => {
  const HOLDER = {
    isFullViewCalloutSeen: false,
    hasOpenedFullView: false,
    openNowWidth: null,
    foldSavedSessionInTabView: true,
  };

  test('a session holder who never used the full view here', () => {
    expect(shouldShowFullViewCallout(HOLDER, 1)).toBe(true);
  });

  test.each([
    ['no sessions', {}, 0],
    ['seen', { isFullViewCalloutSeen: true }, 1],
    ['opened since KAN-7', { hasOpenedFullView: true }, 1],
    ['Open now dragged before KAN-7', { openNowWidth: 480 }, 1],
    ['unfolded before KAN-7', { foldSavedSessionInTabView: false }, 1],
  ])('not with %s', (_name, change, sessions) => {
    expect(shouldShowFullViewCallout({ ...HOLDER, ...change }, sessions)).toBe(
      false
    );
  });
});
