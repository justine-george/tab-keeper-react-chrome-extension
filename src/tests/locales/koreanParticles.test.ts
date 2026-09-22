import { describe, expect, test } from 'vitest';

import ko from '../../../public/locales/ko/translation.json';

// KAN-283. A Korean particle depends on the sound before it: 로 or 으로, 를 or
// 을. After an interpolated value the translator cannot know that sound, and
// the fallback is to print both -- "(으)로", "을(를)". It is legible, but it
// reads as an unfinished form letter. Every string here is rewritten so the
// particle follows a fixed word instead ("세션으로", "키를"), or, where the
// value is always "Tab Keeper", the particle that word takes.
const FALLBACK_PARTICLE = /\((?:으|을|를|이|가|은|는|과|와)\)/;

describe('the Korean strings print no fallback particle', () => {
  test('no value carries a parenthesised particle', () => {
    const offenders = Object.entries(ko as Record<string, string>)
      .filter(([, value]) => FALLBACK_PARTICLE.test(value))
      .map(([key, value]) => `${key} -> ${value}`);

    expect(offenders).toEqual([]);
  });

  // CONTROL: the pattern matches both shapes the drafts used, so an empty
  // result above means the file is clean, not that the pattern is blind.
  test('the pattern catches both fallback shapes', () => {
    expect(FALLBACK_PARTICLE.test('"{{title}}"(으)로 전환할까요?')).toBe(true);
    expect(FALLBACK_PARTICLE.test('{{keys}}을(를) 누르면')).toBe(true);
    expect(FALLBACK_PARTICLE.test('"{{title}}" 세션으로 전환할까요?')).toBe(
      false
    );
  });
});
