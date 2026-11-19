import { describe, expect, test } from 'vitest';

import {
  bytesToMB,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  syncLimitInMB,
} from '../../utils/functions/local';
import { formatSyncLimit } from '../../utils/functions/syncSpace';
import { dictFor, localeDicts } from '../setup/localeT';

// KAN-634. A refusal toast and the Sync Status bar under it named one limit
// two ways: "1.1 MB of a 1.0 MB limit" against "of the 1 MB sync limit". The
// bar formats the whole quantity with Intl; each refusal key types its own
// unit after a bare number. So the check is on the rendered text, per locale.

// Intl puts a no-break space (narrow in French) between number and unit; the
// keys type a plain one. Invisible on screen, so not a difference here.
const spaces = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

// 1.4 MB, so the used figure cannot itself end in "1 MB" and pass for the limit.
const USED = 1.4 * FIRESTORE_MAX_DOCUMENT_BYTES;

describe.each(['SyncSizeRefusal', 'ImportSizeRefusal', 'ImportTooLarge'])(
  '%s names the limit as the bar does',
  (key) => {
    test('in every locale', () => {
      // PREMISE: the old one-decimal limit ("1.0 MB") fails this check.
      const old = dictFor('en')
        [key].replace('{{used}}', bytesToMB(USED, 'en'))
        .replace('{{limit}}', bytesToMB(FIRESTORE_MAX_DOCUMENT_BYTES, 'en'));
      expect(spaces(old)).not.toContain(spaces(formatSyncLimit('en')));

      const offenders = localeDicts
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
