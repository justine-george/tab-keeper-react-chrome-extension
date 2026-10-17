import { describe, expect, test } from 'vitest';

import zh from '../../../public/locales/zh/translation.json';
import zhTW from '../../../public/locales/zh-TW/translation.json';

// KAN-667. "Your sessions are here" can show beside the sync toast, which says
// 已同步 in both Chinese files. zh-TW's title said 已送達, parcel delivery,
// so the two disagreed about what had just happened.
const LOCALES: Record<string, Record<string, string>> = { zh, 'zh-TW': zhTW };

const SYNC_TOAST = 'Synced changes from another device.';

describe('the Chinese "sessions are here" title says synced, as the toast does (KAN-667)', () => {
  test.each(Object.keys(LOCALES))('%s', (locale) => {
    const strings = LOCALES[locale];
    // The control: if the toast stops saying 同步, this test means nothing.
    expect(strings[SYNC_TOAST]).toContain('同步');
    expect(strings['Your sessions are here']).toContain('同步');
    expect(strings['Your sessions are here']).not.toContain('送達');
  });
});
