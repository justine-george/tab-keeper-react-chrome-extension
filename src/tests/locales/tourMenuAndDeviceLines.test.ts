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

// KAN-789. Two tour lines: the Currently open card says the pane is this
// device's, and the menu card's small print teaches right-click everywhere.

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

const PANE_CARD =
  'Open now shows every window and tab in Chrome, kept up to date as you browse.';
const SYNC_OFF =
  'Your sessions stay on this device. Turn on Auto Sync, or press the cloud button on the home screen, to start syncing.';
const RIGHT_CLICK =
  'Right-click a session, window, group or tab to open its menu.';
const OLD_RIGHT_CLICK =
  "Right-clicking the session's title opens this menu too.";

// How each locale already says "on this device" in its sync strings.
const THIS_DEVICE: Record<string, string> = {
  de: 'auf diesem Gerät',
  en: 'on this device',
  es: 'en este dispositivo',
  fr: 'sur cet appareil',
  hi: 'डिवाइस पर',
  it: 'su questo dispositivo',
  ja: 'このデバイス',
  ko: '이 기기',
  pt: 'neste dispositivo',
  ru: 'на этом устройстве',
  sv: 'på den här enheten',
  zh: '此设备',
  'zh-TW': '這部裝置',
};

describe('the Currently open card says "on this device" (KAN-789)', () => {
  test('en reads the agreed line', () => {
    expect(en[PANE_CARD as keyof typeof en]).toBe(
      'Currently open shows every Chrome window and tab on this device, and stays up to date as you browse.'
    );
  });

  test.each(Object.keys(LOCALES))(
    "%s says it with its own sync strings' phrase",
    (lang) => {
      const phrase = THIS_DEVICE[lang];
      // The phrase is the locale's own: its sync-off line already uses it.
      expect(LOCALES[lang][SYNC_OFF]).toContain(phrase);
      expect(LOCALES[lang][PANE_CARD]).toContain(phrase);
    }
  );
});

describe("the menu card's small print teaches right-click everywhere (KAN-789)", () => {
  test.each(Object.keys(LOCALES))('%s has the line, translated', (lang) => {
    const value = LOCALES[lang][RIGHT_CLICK];
    expect(value).toEqual(expect.any(String));
    if (lang === 'en') expect(value).toBe(RIGHT_CLICK);
    else expect(value).not.toBe(RIGHT_CLICK);
  });

  test.each(Object.keys(LOCALES))(
    '%s no longer keeps the session-only line',
    (lang) => {
      expect(LOCALES[lang][OLD_RIGHT_CLICK]).toBeUndefined();
    }
  );
});
