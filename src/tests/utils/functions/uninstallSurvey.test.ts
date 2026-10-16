import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  Language,
  SHIPPED_LANGUAGES,
} from '../../../utils/functions/languages';
import {
  UNINSTALL_SURVEY_LANGUAGE_KEY,
  applyUninstallSurvey,
  type UninstallSurveyForm,
  mirrorUninstallSurveyLanguage,
  uninstallSurveyInOrder,
  uninstallSurveyUrl,
  type UninstallSurveyApi,
  type UninstallSurveyArea,
  type UninstallSurveyStore,
} from '../../../utils/functions/uninstallSurvey';

// KAN-642. What Chrome opens after an uninstall, against recording fakes.
// KAN-643. Each install opens one of two forms, kept for its life.

const FORM_A =
  'https://docs.google.com/forms/d/e/1FAIpQLSfkdlOu5hLRrU9Xa-bRRq-bIVDZHwybbqDaHYfHWdwqOLz9NQ/viewform';
const FORM_B =
  'https://docs.google.com/forms/d/e/1FAIpQLSfoquF4VOaq-HITFlVMgNLdoq_V1w3UQcrrNuFIB4bzx5mEmg/viewform';

afterEach(() => vi.restoreAllMocks());

const api = (
  opts: { uiTag?: string; rejects?: boolean; random?: number } = {}
) => {
  const urls: string[] = [];
  const value: UninstallSurveyApi = {
    setUninstallURL: async (url) => {
      if (opts.rejects) throw new Error('refused');
      urls.push(url);
    },
    version: () => '1.10.0',
    uiLanguage: () => opts.uiTag,
    random: () => opts.random ?? 0,
  };
  return { api: value, urls };
};

// A stored language and form (none: the next apply draws); records every form written.
const stored = (language: unknown, form?: unknown) => {
  const writes: unknown[] = [];
  let current = form;
  const store: UninstallSurveyStore = {
    readLanguage: async () => language,
    readForm: async () => current,
    writeForm: async (next) => {
      writes.push(next);
      current = next;
    },
  };
  return Object.assign(store, { writes });
};

describe('uninstallSurveyUrl', () => {
  test('the form, prefilled with version and language', () => {
    expect(uninstallSurveyUrl('a', '1.10.0', Language.FR)).toBe(
      `${FORM_A}?usp=pp_url&entry.289476948=1.10.0&entry.19370289=fr`
    );
  });

  test('form B shares the entry ids, so only the form id differs', () => {
    expect(uninstallSurveyUrl('b', '1.10.0', Language.FR)).toBe(
      `${FORM_B}?usp=pp_url&entry.289476948=1.10.0&entry.19370289=fr`
    );
  });

  test('zh-TW keeps its casing', () => {
    expect(uninstallSurveyUrl('a', '1.10.0', Language.ZH_TW)).toContain(
      'entry.19370289=zh-TW'
    );
  });

  test("every shipped language fits under Chrome's 1023-character limit", () => {
    for (const form of ['a', 'b'] as const) {
      for (const language of SHIPPED_LANGUAGES) {
        expect(
          uninstallSurveyUrl(form, '9999.9999.9999.9999', language).length
        ).toBeLessThanOrEqual(1023);
      }
    }
  });
});

describe('applyUninstallSurvey', () => {
  test("the page's language wins over the browser's", async () => {
    const { api: a, urls } = api({ uiTag: 'de-DE' });
    await applyUninstallSurvey(a, stored('fr'));
    expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.FR)]);
  });

  test('nothing mirrored yet: the language the popup would open in', async () => {
    const { api: a, urls } = api({ uiTag: 'zh-HK' });
    await applyUninstallSurvey(a, stored(undefined));
    expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.ZH_TW)]);
  });

  test.each([['en-US'], [42], [{}], [null]])(
    'junk %j falls back like the popup does',
    async (junk) => {
      const { api: a, urls } = api({ uiTag: 'ja' });
      await applyUninstallSurvey(a, stored(junk));
      expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.JA)]);
    }
  );

  test('no UI tag either: English', async () => {
    const { api: a, urls } = api();
    await applyUninstallSurvey(a, stored(undefined));
    expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.EN)]);
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
    const store = stored(undefined);
    store.readLanguage = async () => {
      throw new Error('gone');
    };
    await applyUninstallSurvey(a, store);
    expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.KO)]);
  });
});

describe('applyUninstallSurvey: which form', () => {
  test('a stored form is kept, whatever the draw would say', async () => {
    const { api: a, urls } = api({ random: 0 });
    const store = stored('fr', 'b');
    await applyUninstallSurvey(a, store);
    expect(urls).toEqual([uninstallSurveyUrl('b', '1.10.0', Language.FR)]);
    expect(store.writes).toEqual([]);
  });

  test.each([
    [0, 'a'],
    [0.4999, 'a'],
    [0.5, 'b'],
    [0.9999, 'b'],
  ] as const)(
    'no form yet: a draw of %d picks %s and stores it',
    async (random, form: UninstallSurveyForm) => {
      const { api: a, urls } = api({ random });
      const store = stored('fr', undefined);
      await applyUninstallSurvey(a, store);
      expect(urls).toEqual([uninstallSurveyUrl(form, '1.10.0', Language.FR)]);
      expect(store.writes).toEqual([form]);
    }
  );

  test('the stored draw holds on the next apply', async () => {
    const first = api({ random: 0.7 });
    const store = stored('fr', undefined);
    await applyUninstallSurvey(first.api, store);
    const second = api({ random: 0.1 });
    await applyUninstallSurvey(second.api, store);
    expect(second.urls).toEqual([
      uninstallSurveyUrl('b', '1.10.0', Language.FR),
    ]);
    expect(store.writes).toEqual(['b']);
  });

  test.each([['c'], ['A'], [42], [{}], [null]])(
    'junk form %j is redrawn and overwritten',
    async (junk) => {
      const { api: a, urls } = api({ random: 0.9 });
      const store = stored('fr', junk);
      await applyUninstallSurvey(a, store);
      expect(urls).toEqual([uninstallSurveyUrl('b', '1.10.0', Language.FR)]);
      expect(store.writes).toEqual(['b']);
    }
  );

  test('a form read that throws: drawn, stored, set, and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api: a, urls } = api({ random: 0.9 });
    const store = stored('fr');
    store.readForm = async () => {
      throw new Error('gone');
    };
    await applyUninstallSurvey(a, store);
    expect(urls).toEqual([uninstallSurveyUrl('b', '1.10.0', Language.FR)]);
    expect(store.writes).toEqual(['b']);
    expect(warn).toHaveBeenCalled();
  });

  test('a refused form write still sets the drawn form, and is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api: a, urls } = api({ random: 0.9 });
    const store = stored('fr', undefined);
    store.writeForm = async () => {
      throw new Error('quota');
    };
    await applyUninstallSurvey(a, store);
    expect(urls).toEqual([uninstallSurveyUrl('b', '1.10.0', Language.FR)]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('uninstallSurveyInOrder', () => {
  test('a slow older read never lands after a newer one', async () => {
    const { api: a, urls } = api();
    let current: unknown = 'en';
    const releases: (() => void)[] = [];
    let reads = 0;
    // The first read stalls until released; later reads answer at once.
    const store = stored(undefined);
    store.readLanguage = () =>
      reads++ === 0
        ? new Promise<unknown>((resolve) => {
            const seen = current;
            releases.push(() => resolve(seen));
          })
        : Promise.resolve(current);
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
      uninstallSurveyUrl('a', '1.10.0', Language.EN),
      uninstallSurveyUrl('a', '1.10.0', Language.FR),
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
      random: () => 0,
    };
    const apply = uninstallSurveyInOrder(a, stored('sv'));
    await apply();
    await apply();
    expect(urls).toEqual([uninstallSurveyUrl('a', '1.10.0', Language.SV)]);
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
