import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';

export type Version = `${number}.${number}.${number}`;

export interface WhatsNewEntry {
  titleKey: string;
  bodyKey: string;
  settingsPage?: SettingsCategory;
  changesDefault: boolean;
}

interface ReleaseBody {
  fixesOnly?: true;
  entries: readonly [WhatsNewEntry, ...WhatsNewEntry[]];
}

// 'next' reads as the installed version, never later than `ships`: a cut that forgets the rename shows it once.
export type WhatsNewRelease =
  | (ReleaseBody & { version: 'next'; ships: Version })
  | (ReleaseBody & { version: Version });

/** KAN-861: the main changes per release, newest first. The release PR renames 'next' to the manifest's version. */
export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    version: 'next',
    ships: '2.1.0',
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
