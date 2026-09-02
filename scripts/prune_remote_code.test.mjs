import { describe, expect, test } from 'vitest';

import { pruneRemoteCode, REMOTE_CODE_PATTERNS } from './prune_remote_code.mjs';

// Manifest V3 forbids remotely hosted code. Firebase Auth ships script URLs for
// sign-in flows this extension never uses, so the release build blanks them.
// These cases mirror the sed this replaced, including the trailing negated
// character class that absorbs whatever query string the SDK appends.
describe('pruneRemoteCode', () => {
  test('removes the apis.google.com loader URL', () => {
    const source = 'const u = "https://apis.google.com/js/api.js";';
    expect(pruneRemoteCode(source)).toBe('const u = "";');
  });

  test('removes the recaptcha URL', () => {
    const source = 'const u = "https://www.google.com/recaptcha/api.js";';
    expect(pruneRemoteCode(source)).toBe('const u = "";');
  });

  // The case the negated character class exists for. A pattern that stopped at
  // the bare URL would leave the query string behind as a syntax-valid but
  // still-remote reference.
  test('absorbs a trailing query string', () => {
    const source =
      'x("https://apis.google.com/js/api.js?onload=cb&render=explicit")';
    expect(pruneRemoteCode(source)).toBe('x("")');
  });

  test('stops at a backtick so it cannot eat a whole template literal', () => {
    const source = '`https://apis.google.com/js/api.js` + rest';
    expect(pruneRemoteCode(source)).toBe('`` + rest');
  });

  test('leaves unrelated source untouched', () => {
    const source = 'const a = "https://firestore.googleapis.com/v1/projects";';
    expect(pruneRemoteCode(source)).toBe(source);
  });

  test('is idempotent', () => {
    const once = pruneRemoteCode('u = "https://apis.google.com/js/api.js";');
    expect(pruneRemoteCode(once)).toBe(once);
  });

  // Regexes with /g carry lastIndex. Reusing a shared array across files must
  // not make the second file skip a match.
  test('does not leak regex state between calls', () => {
    const source = 'a("https://apis.google.com/js/api.js")';
    const first = pruneRemoteCode(source);
    expect(pruneRemoteCode(source)).toBe(first);
  });

  test('exports the patterns it uses', () => {
    expect(REMOTE_CODE_PATTERNS.length).toBe(2);
  });
});
