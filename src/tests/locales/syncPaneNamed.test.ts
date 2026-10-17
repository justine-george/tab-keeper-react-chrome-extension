import { describe, expect, test } from 'vitest';

import de from '../../../public/locales/de/translation.json';
import en from '../../../public/locales/en/translation.json';
import es from '../../../public/locales/es/translation.json';
import fr from '../../../public/locales/fr/translation.json';
import hi from '../../../public/locales/hi/translation.json';
import it from '../../../public/locales/it/translation.json';
import ja from '../../../public/locales/ja/translation.json';
import ko from '../../../public/locales/ko/translation.json';
import pt from '../../../public/locales/pt/translation.json';
import ru from '../../../public/locales/ru/translation.json';
import sv from '../../../public/locales/sv/translation.json';
import zh from '../../../public/locales/zh/translation.json';
import zhTW from '../../../public/locales/zh-TW/translation.json';

// KAN-651. Three sentences send the user to Settings → Sync & backup by name.
// The rail's label and the sentences are separate strings, so a label renamed
// alone leaves the sentences pointing at a pane that no longer reads that way.
const LOCALES: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  pt,
  ru,
  sv,
  zh,
  'zh-TW': zhTW,
};

const PANE = 'Sync & Backup';
const SENTENCES = ['ExistingSyncOff', 'EnableSyncFine', 'EnableSyncOnceFine'];

describe('sentences that send the user to Sync & backup use its label (KAN-651)', () => {
  test.each(Object.keys(LOCALES))('%s', (locale) => {
    const strings = LOCALES[locale];
    const label = strings[PANE];
    expect(label).toBeTruthy();
    for (const key of SENTENCES) expect(strings[key]).toContain(label);
  });
});
