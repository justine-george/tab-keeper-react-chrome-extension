import { describe, expect, test } from 'vitest';

// PRIVACY.md: "Tab Keeper does not use analytics, advertising, or behavioral
// tracking." The policy is a claim about the code, and this is the code's side
// of it (KAN-260).
//
// The Firebase console hands out a config block that includes measurementId
// -- the Google Analytics property id -- and it sat in firebaseConfig from the
// first commit, never read: nothing imported firebase/analytics, so no event
// ever left the extension. Inert, but a GA id in the shipped bundle is a
// contradiction anyone reading dist/ can see and only we can explain away.
// The two checks below are the two ways analytics could come back: the id,
// which is the address, and the import, which is the sender.
//
// import.meta.glob, not node:fs, for the reason keyCoverage.test.ts gives:
// tsconfig.json omits "node" on purpose, and the raw glob needs no change.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Tests may name the things they forbid; the shipped source may not.
const shipped = Object.entries(sources).filter(
  ([path]) => !path.startsWith('/src/tests/')
);

describe('no analytics (PRIVACY.md)', () => {
  test('reads the source tree, not an empty glob', () => {
    expect(shipped.length).toBeGreaterThan(50);
  });

  test('no source file carries a Google Analytics measurement id', () => {
    const offenders = shipped
      .filter(([, text]) => /measurementId|MEASUREMENT_ID/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  test('no source file imports firebase/analytics', () => {
    const offenders = shipped
      .filter(([, text]) => /['"]firebase\/analytics['"]/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
