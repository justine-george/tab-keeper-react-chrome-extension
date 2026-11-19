import { describe, expect, test } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-617. A group's ⋮ menu holds Ungroup (tabs stay) beside Delete tab group
// (tabs go). hi said Ungroup with its delete verb, समूह हटाएँ "remove group",
// so the two differed only by टैब. Ungroup must not use the delete verb.

// Each locale's delete verb, as it appears in "Delete tab group". Whole words,
// not characters: ja 解除 (ungroup) and 削除 (delete) share 除.
const DELETE_VERB: Record<string, string> = {
  de: 'lösch',
  en: 'Delete',
  es: 'Elimin',
  fr: 'Supprim',
  hi: 'हट',
  it: 'Elimin',
  ja: '削除',
  ko: '삭제',
  pt: 'Exclu',
  ru: 'Удал',
  sv: 'Radera',
  zh: '删除',
  'zh-TW': '刪除',
};

describe('Ungroup does not read as delete (KAN-617)', () => {
  test.each(localeDicts)('%s', (locale, dict) => {
    const verb = DELETE_VERB[locale];
    if (verb === undefined)
      throw new Error(`no delete verb listed for ${locale}`);
    // CONTROL: the verb is really this locale's delete, not a typo that
    // matches nothing.
    expect(dict['Delete tab group']).toContain(verb);
    expect(dict['Ungroup']).toBeTruthy();
    expect(dict['Ungroup']).not.toBe(dict['Delete tab group']);
    expect(dict['Ungroup']).not.toContain(verb);
  });
});
