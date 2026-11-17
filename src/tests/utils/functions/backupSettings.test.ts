import { describe, expect, test } from 'vitest';

import {
  BACKUP_SETTING_KEYS,
  PER_DEVICE_SETTING_KEYS,
  backupSettingsFrom,
  readBackupSettings,
} from '../../../utils/functions/backupSettings';
import {
  defaultSettings,
  Language,
  type SettingsData,
} from '../../../redux/slices/settingsDataStateSlice';
import { Theme } from '../../../utils/constants/theme';

// KAN-961. A new install on an English Chrome.
const defaults: SettingsData = {
  ...defaultSettings,
  language: Language.EN,
  timeFormat: 'h12',
};

describe('backupSettingsFrom', () => {
  test('every SettingsData key is either in a backup or per device', () => {
    const all = Object.keys(defaultSettings).sort();
    expect([...BACKUP_SETTING_KEYS, ...PER_DEVICE_SETTING_KEYS].sort()).toEqual(
      all
    );
    const perDevice = new Set<string>(PER_DEVICE_SETTING_KEYS);
    expect(BACKUP_SETTING_KEYS.filter((k) => perDevice.has(k))).toEqual([]);
  });

  test('writes only what differs from a new install', () => {
    expect(
      backupSettingsFrom(
        { ...defaults, theme: Theme.CHARCOAL, skipDuplicateTabs: true },
        'en-US'
      )
    ).toEqual({ theme: 'Charcoal', skipDuplicateTabs: true });
    expect(backupSettingsFrom(defaults, 'en-US')).toBeUndefined();
  });

  test('per-device settings never go in', () => {
    expect(
      backupSettingsFrom(
        {
          ...defaults,
          isAutoSync: false,
          openNowWidth: 400,
          cloudConsent: 'granted',
        },
        'en-US'
      )
    ).toBeUndefined();
  });

  test('language is compared with what this Chrome would start in', () => {
    expect(
      backupSettingsFrom(
        { ...defaults, language: Language.DE, timeFormat: 'h23' },
        'de-DE'
      )
    ).toBeUndefined();
    expect(
      backupSettingsFrom(
        { ...defaults, language: Language.DE, timeFormat: 'h23' },
        'en-US'
      )
    ).toEqual({ language: 'de', timeFormat: 'h23' });
  });

  test('clock is written when it differs from the usual clock of the language', () => {
    expect(
      backupSettingsFrom({ ...defaults, timeFormat: 'h23' }, 'en-US')
    ).toEqual({ timeFormat: 'h23' });
    expect(
      backupSettingsFrom(
        { ...defaults, language: Language.DE, timeFormat: 'h12' },
        'de-DE'
      )
    ).toEqual({ timeFormat: 'h12' });
  });

  test('no UI language reads as English', () => {
    expect(
      backupSettingsFrom(
        { ...defaults, language: Language.FR, timeFormat: 'h23' },
        undefined
      )
    ).toEqual({ language: 'fr', timeFormat: 'h23' });
  });

  test('the two folds travel together', () => {
    expect(
      backupSettingsFrom(
        {
          ...defaults,
          foldSavedSessionInTabView: false,
          foldOpenNowInTabView: true,
        },
        'en-US'
      )
    ).toEqual({ foldSavedSessionInTabView: false, foldOpenNowInTabView: true });
    expect(
      backupSettingsFrom(
        { ...defaults, foldSavedSessionInTabView: false },
        'en-US'
      )
    ).toEqual({
      foldSavedSessionInTabView: false,
      foldOpenNowInTabView: false,
    });
  });
});

describe('readBackupSettings', () => {
  test('keeps every valid allow-listed value', () => {
    const all = {
      theme: 'Charcoal',
      language: 'ja',
      timeFormat: 'h12',
      sessionDateBasis: 'created',
      exportLayout: 'comfortable',
      defaultView: 'full',
      toolbarIcon: 'monochrome',
      pinTabKeeperInNewWindows: true,
      defaultSaveScope: 'current-window',
      copyLinksLayout: 'with-headings',
      openSavedWindowsIn: 'this-window',
      skipDuplicateTabs: true,
      skipTabsAlreadyOpen: true,
      foldSavedSessionInTabView: false,
      foldOpenNowInTabView: true,
    };
    expect(readBackupSettings(all)).toEqual(all);
  });

  test('drops unknown keys and invalid values', () => {
    expect(
      readBackupSettings({
        theme: 'Neon',
        language: 'xx',
        skipDuplicateTabs: 'yes',
        isAutoSync: false,
        foldSavedSessionInTabView: 1,
        exportLayout: 'huge',
        sessionDateBasis: 'created',
        toolbarIcon: 'monochrome',
      })
    ).toEqual({ sessionDateBasis: 'created', toolbarIcon: 'monochrome' });
    expect(readBackupSettings('x')).toBeNull();
    expect(readBackupSettings([])).toBeNull();
    expect(readBackupSettings(null)).toBeNull();
    expect(readBackupSettings(undefined)).toBeNull();
    expect(readBackupSettings({ theme: 'Neon' })).toBeNull();
  });

  test('a bad value is dropped, never turned into the default', () => {
    for (const [key, bad] of [
      ['timeFormat', 'h24'],
      ['defaultView', 'huge'],
      ['toolbarIcon', 'Colour'],
      ['defaultSaveScope', 'one-window'],
      ['copyLinksLayout', ''],
      ['openSavedWindowsIn', 'tab'],
      ['pinTabKeeperInNewWindows', 'true'],
      ['skipTabsAlreadyOpen', 0],
      ['foldOpenNowInTabView', null],
      ['language', '"de"'],
    ] as const) {
      expect(readBackupSettings({ [key]: bad })).toBeNull();
    }
  });

  test('a language with no clock brings its usual clock', () => {
    expect(readBackupSettings({ language: 'de' })).toEqual({
      language: 'de',
      timeFormat: 'h23',
    });
    expect(readBackupSettings({ language: 'de', timeFormat: 'h12' })).toEqual({
      language: 'de',
      timeFormat: 'h12',
    });
    expect(readBackupSettings({ language: 'de', timeFormat: 'h24' })).toEqual({
      language: 'de',
      timeFormat: 'h23',
    });
  });

  test('two folds both on keep only the saved-session fold', () => {
    expect(
      readBackupSettings({
        foldSavedSessionInTabView: true,
        foldOpenNowInTabView: true,
      })
    ).toEqual({ foldSavedSessionInTabView: true, foldOpenNowInTabView: false });
  });

  test('a fold on alone turns the other off', () => {
    expect(readBackupSettings({ foldOpenNowInTabView: true })).toEqual({
      foldSavedSessionInTabView: false,
      foldOpenNowInTabView: true,
    });
    expect(readBackupSettings({ foldSavedSessionInTabView: true })).toEqual({
      foldSavedSessionInTabView: true,
      foldOpenNowInTabView: false,
    });
  });
});
