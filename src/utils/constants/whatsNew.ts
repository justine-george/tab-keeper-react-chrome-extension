import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';

export type ReleaseVersion = 'next' | `${number}.${number}.${number}`;

export interface WhatsNewEntry {
  titleKey: string;
  bodyKey: string;
  settingsPage?: SettingsCategory;
  changesDefault: boolean;
}

export interface WhatsNewRelease {
  version: ReleaseVersion;
  fixesOnly?: true;
  entries: readonly [WhatsNewEntry, ...WhatsNewEntry[]];
}

/** KAN-861: the main changes per release, newest first. The release PR renames 'next' to the manifest's version. */
export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    version: 'next',
    entries: [
      {
        titleKey: 'WhatsNewCopyLinksTitle',
        bodyKey: 'WhatsNewCopyLinksBody',
        settingsPage: SettingsCategory.SESSIONS,
        changesDefault: true,
      },
    ],
  },
];
