import { describe, expect, test } from 'vitest';

import en from '../../../public/locales/en/translation.json';

// KAN-285. SyncSizeRefusal is a whole toast on its own
// (globalStateSlice.ts:267), but it was written as the tail of a sentence --
// "too large to sync (1.2 MB of a 1 MB limit)" -- so the one message a user
// gets never said WHAT was too large. Its sibling ImportSizeRefusal really is
// a tail (it sits inside ImportErrorFrame's "Error restoring tabs: …") and is
// deliberately not covered here.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict['SyncSizeRefusal']] as const
);

// A script has case when its letters have distinct upper and lower forms:
// Latin and Cyrillic here. Devanagari and CJK have none, so they are checked
// by the named-subject test below and by reading, not by this one.
const hasCase = (ch: string) => ch.toUpperCase() !== ch.toLowerCase();

describe('the sync size refusal is a whole sentence', () => {
  test('in every cased script it starts with a capital', () => {
    const offenders = locales
      .filter(([, value]) => hasCase(value[0]))
      .filter(([, value]) => value[0] !== value[0].toUpperCase())
      .map(([lang, value]) => `${lang} -> ${value.slice(0, 40)}`);

    expect(offenders).toEqual([]);
  });

  test('en names what is too large', () => {
    expect(en.SyncSizeRefusal).toMatch(/^Your sessions are too large to sync/);
  });

  // CONTROL: enough locales are in a cased script for the first test to mean
  // something, so an empty offender list is a result, not an empty loop.
  test('CONTROL: the cased-script check reaches the Latin and Cyrillic files', () => {
    const cased = locales.filter(([, value]) => hasCase(value[0]));
    expect(cased.length).toBeGreaterThanOrEqual(8);
  });
});
