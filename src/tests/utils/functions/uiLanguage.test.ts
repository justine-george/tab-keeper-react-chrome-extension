import { afterEach, describe, expect, it } from 'vitest';

import {
  matchUiLanguage,
  readUiLanguage,
} from '../../../utils/functions/uiLanguage';
import {
  Language,
  startupLanguage,
} from '../../../redux/slices/settingsDataStateSlice';

// KAN-282. The app never read Chrome's language, so every fresh install opened
// in English. The rule that matters most is the one #42 (2023) learned the hard
// way: never hand i18next a raw Chrome tag. The browser detector it removed
// passed `en-US` through, i18next asked for /locales/en-US/translation.json,
// which does not exist, and the popup lost every string. So a tag is always
// mapped onto a language this build ships, or it is no answer at all.

const SUPPORTED = Object.values(Language);

describe('matchUiLanguage maps a Chrome tag onto a shipped language', () => {
  it.each([
    ['de', Language.DE],
    ['de-DE', Language.DE],
    ['de-AT', Language.DE],
    ['pt-BR', Language.PT],
    ['pt-PT', Language.PT],
    ['es-419', Language.ES],
    ['en-GB', Language.EN],
    ['ja', Language.JA],
    ['ko-KR', Language.KO],
    ['sv-SE', Language.SV],
    ['ru', Language.RU],
    ['hi-IN', Language.HI],
  ])('%s → %s', (tag, expected) => {
    expect(matchUiLanguage(tag, SUPPORTED)).toBe(expected);
  });

  // zh is Simplified; Taiwan, Hong Kong and Macau write Traditional (KAN-283
  // settled the mapping). A script subtag says it outright, whatever region
  // follows it -- zh-Hant-CN is Traditional, zh-Hans-HK is Simplified.
  it.each([
    ['zh', Language.ZH],
    ['zh-CN', Language.ZH],
    ['zh-SG', Language.ZH],
    ['zh-Hans', Language.ZH],
    ['zh-Hans-HK', Language.ZH],
    ['zh-TW', Language.ZH_TW],
    ['zh-HK', Language.ZH_TW],
    ['zh-MO', Language.ZH_TW],
    ['zh-Hant', Language.ZH_TW],
    ['zh-Hant-CN', Language.ZH_TW],
  ])('%s → %s', (tag, expected) => {
    expect(matchUiLanguage(tag, SUPPORTED)).toBe(expected);
  });

  // Chrome reports hyphens, but the manifest world spells zh_TW; case varies
  // by platform. Neither may change the answer.
  it('ignores case and accepts an underscore separator', () => {
    expect(matchUiLanguage('ZH_tw', SUPPORTED)).toBe(Language.ZH_TW);
    expect(matchUiLanguage('DE_de', SUPPORTED)).toBe(Language.DE);
  });

  it('has no answer for a language this build does not ship', () => {
    expect(matchUiLanguage('nl-NL', SUPPORTED)).toBeUndefined();
    expect(matchUiLanguage('fil', SUPPORTED)).toBeUndefined();
  });

  // A prefix is not a primary subtag: "eng" must not become "en", nor "german"
  // "ge"-anything. Only the first subtag, whole, is compared.
  it('compares the whole primary subtag, not a prefix of it', () => {
    expect(matchUiLanguage('eng', SUPPORTED)).toBeUndefined();
    expect(matchUiLanguage('dex-DE', SUPPORTED)).toBeUndefined();
  });

  it.each([[''], ['   '], ['-'], [undefined], [null], [42], [{}], [['de']]])(
    'has no answer for %j',
    (junk) => {
      expect(matchUiLanguage(junk, SUPPORTED)).toBeUndefined();
    }
  );
});

describe('startupLanguage: a saved choice wins, then Chrome, then English', () => {
  // The discriminating test for "existing users are unaffected": everyone who
  // has ever written a setting has `language` saved, and it must never be
  // re-detected over.
  it('a saved language wins over whatever Chrome says', () => {
    expect(startupLanguage('en', 'de-DE')).toBe(Language.EN);
    expect(startupLanguage('ja', 'zh-TW')).toBe(Language.JA);
  });

  it('with nothing saved, follows Chrome', () => {
    expect(startupLanguage(undefined, 'de-DE')).toBe(Language.DE);
    expect(startupLanguage('', 'zh-HK')).toBe(Language.ZH_TW);
  });

  it('with nothing saved and an unshipped Chrome language, is English', () => {
    expect(startupLanguage(undefined, 'nl-NL')).toBe(Language.EN);
  });

  it('with nothing saved and no Chrome answer, is English', () => {
    expect(startupLanguage(undefined, undefined)).toBe(Language.EN);
  });

  // localStorage is user-writable and outlives builds. A saved value this
  // build does not ship must not reach i18next (the #42 failure), so it counts
  // as nothing saved, and Chrome gets a say.
  it('a saved value this build does not ship counts as nothing saved', () => {
    expect(startupLanguage('xx', 'de-DE')).toBe(Language.DE);
    expect(startupLanguage(7, undefined)).toBe(Language.EN);
  });

  // #42's i18nextLng key was JSON-quoted, and i18n.tsx has stripped quotes
  // from the saved language ever since. Kept, because it costs nothing.
  it('a JSON-quoted saved language still counts', () => {
    expect(startupLanguage('"de"', 'ja')).toBe(Language.DE);
  });
});

describe('readUiLanguage', () => {
  const g = globalThis as { chrome?: unknown };
  const original = g.chrome;
  afterEach(() => {
    g.chrome = original;
  });

  it("returns Chrome's tag", () => {
    g.chrome = { i18n: { getUILanguage: () => 'de-DE' } };
    expect(readUiLanguage()).toBe('de-DE');
  });

  // i18n.tsx and the settings slice both run this at module load, before React
  // renders. A throw there is a blank popup, so every failure is "no answer".
  it('has no answer when chrome, chrome.i18n or the call is missing', () => {
    g.chrome = undefined;
    expect(readUiLanguage()).toBeUndefined();
    g.chrome = {};
    expect(readUiLanguage()).toBeUndefined();
    g.chrome = { i18n: {} };
    expect(readUiLanguage()).toBeUndefined();
  });

  it('has no answer when the call throws', () => {
    g.chrome = {
      i18n: {
        getUILanguage: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    };
    expect(readUiLanguage()).toBeUndefined();
  });
});
