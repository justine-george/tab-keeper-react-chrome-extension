import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  Language,
  SHIPPED_LANGUAGES,
} from '../../../utils/functions/languages';
import {
  UNINSTALL_SURVEY_LANGUAGE_KEY,
  applyUninstallSurvey,
  mirrorUninstallSurveyLanguage,
  uninstallSurveyInOrder,
  uninstallSurveyUrl,
  type UninstallSurveyApi,
  type UninstallSurveyArea,
} from '../../../utils/functions/uninstallSurvey';

// KAN-642. What Chrome opens after an uninstall, against recording fakes.

const FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSfkdlOu5hLRrU9Xa-bRRq-bIVDZHwybbqDaHYfHWdwqOLz9NQ/viewform';

afterEach(() => vi.restoreAllMocks());

const api = (opts: { uiTag?: string; rejects?: boolean } = {}) => {
  const urls: string[] = [];
  const value: UninstallSurveyApi = {
    setUninstallURL: async (url) => {
      if (opts.rejects) throw new Error('refused');
      urls.push(url);
    },
    version: () => '1.10.0',
    uiLanguage: () => opts.uiTag,
  };
  return { api: value, urls };
};

const stored = (value: unknown) => ({ read: async () => value });

describe('uninstallSurveyUrl', () => {
  test('the form, prefilled with version and language', () => {
    expect(uninstallSurveyUrl('1.10.0', Language.FR)).toBe(
      `${FORM}?usp=pp_url&entry.289476948=1.10.0&entry.19370289=fr`
    );
  });

  test('zh-TW keeps its casing', () => {
    expect(uninstallSurveyUrl('1.10.0', Language.ZH_TW)).toContain(
      'entry.19370289=zh-TW'
    );
  });

  test("every shipped language fits under Chrome's 1023-character limit", () => {
    for (const language of SHIPPED_LANGUAGES) {
      expect(
        uninstallSurveyUrl('9999.9999.9999.9999', language).length
      ).toBeLessThanOrEqual(1023);
    }
  });
});

describe('applyUninstallSurvey', () => {
  test("the page's language wins over the browser's", async () => {
    const { api: a, urls } = api({ uiTag: 'de-DE' });
    await applyUninstallSurvey(a, stored('fr'));
    expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.FR)]);
  });

  test('nothing mirrored yet: the language the popup would open in', async () => {
    const { api: a, urls } = api({ uiTag: 'zh-HK' });
    await applyUninstallSurvey(a, stored(undefined));
    expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.ZH_TW)]);
  });

  test.each([['en-US'], [42], [{}], [null]])(
    'junk %j falls back like the popup does',
    async (junk) => {
      const { api: a, urls } = api({ uiTag: 'ja' });
      await applyUninstallSurvey(a, stored(junk));
      expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.JA)]);
    }
  );

  test('no UI tag either: English', async () => {
    const { api: a, urls } = api();
    await applyUninstallSurvey(a, stored(undefined));
    expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.EN)]);
  });

  test('a refused set is logged and resolves undefined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api: a } = api({ rejects: true });
    await expect(
      applyUninstallSurvey(a, stored('fr'))
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test('a store that throws still sets a URL, from the UI tag', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api: a, urls } = api({ uiTag: 'ko' });
    await applyUninstallSurvey(a, {
      read: async () => {
        throw new Error('gone');
      },
    });
    expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.KO)]);
  });
});

describe('uninstallSurveyInOrder', () => {
  test('a slow older read never lands after a newer one', async () => {
    const { api: a, urls } = api();
    let current: unknown = 'en';
    const releases: (() => void)[] = [];
    let reads = 0;
    // The first read stalls until released; later reads answer at once.
    const store = {
      read: () =>
        reads++ === 0
          ? new Promise<unknown>((resolve) => {
              const seen = current;
              releases.push(() => resolve(seen));
            })
          : Promise.resolve(current),
    };
    const apply = uninstallSurveyInOrder(a, store);
    const first = apply();
    // The first read is in flight, holding 'en', before the language changes.
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    current = 'fr';
    const second = apply();
    // Unqueued, the second apply would read and set 'fr' here, then lose to the stale first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    releases[0]();
    await Promise.all([first, second]);
    expect(urls).toEqual([
      uninstallSurveyUrl('1.10.0', Language.EN),
      uninstallSurveyUrl('1.10.0', Language.FR),
    ]);
  });

  test('a refusal does not jam the queue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let refuse = true;
    const urls: string[] = [];
    const a: UninstallSurveyApi = {
      setUninstallURL: async (url) => {
        if (refuse) {
          refuse = false;
          throw new Error('refused');
        }
        urls.push(url);
      },
      version: () => '1.10.0',
      uiLanguage: () => undefined,
    };
    const apply = uninstallSurveyInOrder(a, stored('sv'));
    await apply();
    await apply();
    expect(urls).toEqual([uninstallSurveyUrl('1.10.0', Language.SV)]);
  });
});

describe('mirrorUninstallSurveyLanguage', () => {
  const area = (initial: Record<string, unknown> = {}) => {
    const items = { ...initial };
    const writes: Record<string, unknown>[] = [];
    const value: UninstallSurveyArea = {
      get: async (key) => (key in items ? { [key]: items[key] } : {}),
      set: async (next) => {
        writes.push(next);
        Object.assign(items, next);
      },
    };
    return { area: value, writes };
  };

  test('writes the language the page resolved', async () => {
    const { area: a, writes } = area();
    await expect(mirrorUninstallSurveyLanguage(a, Language.FR)).resolves.toBe(
      true
    );
    expect(writes).toEqual([{ [UNINSTALL_SURVEY_LANGUAGE_KEY]: 'fr' }]);
  });

  test('an unchanged language writes nothing', async () => {
    const { area: a, writes } = area({ [UNINSTALL_SURVEY_LANGUAGE_KEY]: 'fr' });
    await expect(mirrorUninstallSurveyLanguage(a, Language.FR)).resolves.toBe(
      false
    );
    expect(writes).toEqual([]);
  });

  test('a refused write is logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a: UninstallSurveyArea = {
      get: async () => ({}),
      set: async () => {
        throw new Error('quota');
      },
    };
    await expect(mirrorUninstallSurveyLanguage(a, Language.FR)).resolves.toBe(
      false
    );
    expect(warn).toHaveBeenCalled();
  });
});
