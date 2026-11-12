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
    version: '2.4.0',
    entries: [
      {
        titleKey: 'WhatsNewSplitViewTitle',
        bodyKey: 'WhatsNewSplitViewBody',
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewLiveNewWindowTitle',
        bodyKey: 'WhatsNewLiveNewWindowBody',
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewUndoDropTitle',
        bodyKey: 'WhatsNewUndoDropBody',
        changesDefault: false,
      },
    ],
  },
  {
    version: '2.3.0',
    entries: [
      {
        titleKey: 'WhatsNewToolbarIconTitle',
        bodyKey: 'WhatsNewToolbarIconBody',
        settingsPage: SettingsCategory.DISPLAY,
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewGroupColorTitle',
        bodyKey: 'WhatsNewGroupColorBody',
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewOpenNewWindowTitle',
        bodyKey: 'WhatsNewOpenNewWindowBody',
        changesDefault: false,
      },
    ],
  },
  {
    version: '2.2.0',
    entries: [
      {
        titleKey: 'WhatsNewOpenInThisWindowTitle',
        bodyKey: 'WhatsNewOpenInThisWindowBody',
        settingsPage: SettingsCategory.SESSIONS,
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewSkipTabsTitle',
        bodyKey: 'WhatsNewSkipTabsBody',
        settingsPage: SettingsCategory.SESSIONS,
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewSwitchToOpenTabTitle',
        bodyKey: 'WhatsNewSwitchToOpenTabBody',
        changesDefault: true,
      },
    ],
  },
  {
    version: '2.1.0',
    entries: [
      {
        titleKey: 'WhatsNewCopyLinksTitle',
        bodyKey: 'WhatsNewCopyLinksBody',
        settingsPage: SettingsCategory.SESSIONS,
        changesDefault: true,
      },
      {
        titleKey: 'WhatsNewReplaceWindowTitle',
        bodyKey: 'WhatsNewReplaceWindowBody',
        changesDefault: false,
      },
      {
        titleKey: 'WhatsNewOpenDuplicatesTitle',
        bodyKey: 'WhatsNewOpenDuplicatesBody',
        changesDefault: false,
      },
    ],
  },
];
