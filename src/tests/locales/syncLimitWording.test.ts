import { describe, expect, test } from 'vitest';

import {
  bytesToMB,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  syncLimitInMB,
} from '../../utils/functions/local';
import { formatSyncLimit } from '../../utils/functions/syncSpace';

// KAN-634. A refusal toast and the Sync Status bar under it named one limit
// two ways: "1.1 MB of a 1.0 MB limit" against "of the 1 MB sync limit". The
// bar formats the whole quantity with Intl; each refusal key types its own
// unit after a bare number. So the check is on the rendered text, per locale.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);

// Intl puts a no-break space (narrow in French) between number and unit; the
// keys type a plain one. Invisible on screen, so not a difference here.
const spaces = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

// 1.4 MB, so the used figure cannot itself end in "1 MB" and pass for the limit.
const USED = 1.4 * FIRESTORE_MAX_DOCUMENT_BYTES;

describe.each(['SyncSizeRefusal', 'ImportSizeRefusal'])(
  '%s names the limit as the bar does',
  (key) => {
    test('in every locale', () => {
      const offenders = locales
        .map(([lang, dict]) => {
          const text = dict[key]
            .replace('{{used}}', bytesToMB(USED, lang))
            .replace('{{limit}}', syncLimitInMB(lang));
          return [lang, spaces(text), spaces(formatSyncLimit(lang))] as const;
        })
        .filter(([, text, limit]) => !text.includes(limit))
        .map(([lang, text, limit]) => `${lang}: "${limit}" not in ${text}`);
      expect(offenders).toEqual([]);
    });
  }
);

// CONTROL: the premise. Every locale was found, and the old one-decimal limit
// is what the check exists to catch.
test('control: the old "1.0" limit fails the same check', () => {
  expect(locales.length).toBe(13);
  const en = localeFiles['/public/locales/en/translation.json'];
  const old = en.SyncSizeRefusal.replace(
    '{{used}}',
    bytesToMB(USED, 'en')
  ).replace('{{limit}}', bytesToMB(FIRESTORE_MAX_DOCUMENT_BYTES, 'en'));
  expect(old).not.toContain(formatSyncLimit('en'));
});
