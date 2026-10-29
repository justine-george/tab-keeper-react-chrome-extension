import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';
import {
  WHATS_NEW,
  WhatsNewEntry,
  WhatsNewRelease,
} from '../constants/whatsNew';

/** A release resolved for display: `version` is never 'next'. Plain data, so it can live in the store. */
export interface ShownRelease {
  version: string;
  fixesOnly: boolean;
  entries: readonly WhatsNewEntry[];
}

const MAX_PART = 65535;

/** Chrome's version format: 1 to 4 dot-separated integers of 0–65535. Anything else is null. */
export function parseVersion(value: unknown): readonly number[] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const numbers = parts.map(Number);
  return numbers.every((n) => n <= MAX_PART) ? numbers : null;
}

/** A missing part compares as 0, so '1.9' equals '1.9.0'. */
function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Releases newer than `since` and no newer than `installed`; fixes-only ones show only beside a main one. */
export function releasesToShow(
  since: unknown,
  installed: string,
  list: readonly WhatsNewRelease[] = WHATS_NEW
): ShownRelease[] {
  const from = parseVersion(since);
  const to = parseVersion(installed);
  if (from === null || to === null) return [];
  const inRange = list
    .map((release) => ({
      version: release.version === 'next' ? installed : release.version,
      fixesOnly: release.fixesOnly === true,
      entries: release.entries,
    }))
    .filter((release) => {
      const v = parseVersion(release.version);
      return v !== null && compare(v, from) > 0 && compare(v, to) <= 0;
    });
  return inRange.some((release) => !release.fixesOnly) ? inRange : [];
}

export function showsDefaultChange(shown: readonly ShownRelease[]): boolean {
  return shown.some((release) => release.entries.some((e) => e.changesDefault));
}

/** The first entry's settings page in list order: newest release first, then entry order. */
export function settingsPageOf(shown: readonly ShownRelease[]): SettingsCategory | null {
  for (const release of shown) {
    for (const entry of release.entries) {
      if (entry.settingsPage !== undefined) return entry.settingsPage;
    }
  }
  return null;
}
