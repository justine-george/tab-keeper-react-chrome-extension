import { describe, expect, test } from 'vitest';

import zh from '../../../public/locales/zh/translation.json';
import zhTW from '../../../public/locales/zh-TW/translation.json';

// KAN-519. Each Chinese locale addresses the user one way: zh with the polite
// 您, zh-TW with 你, as Chrome's Taiwan UI does. New zh strings slipped into
// 你 three times. Chinese has no word boundaries, but the pronoun is a single
// character, so a plain search cannot misfire.
const ADDRESS = [
  { locale: 'zh', dict: zh, never: '你' },
  { locale: 'zh-TW', dict: zhTW, never: '您' },
];

describe.each(ADDRESS)('$locale addresses the user one way', (a) => {
  const entries = Object.entries(a.dict as Record<string, string>);

  test(`no value says ${a.never}`, () => {
    const offenders = entries
      .filter(([, value]) => value.includes(a.never))
      .map(([key, value]) => `${key} -> ${value}`);
    expect(offenders).toEqual([]);
  });
});
