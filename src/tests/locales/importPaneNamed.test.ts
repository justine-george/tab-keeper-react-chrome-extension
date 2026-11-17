import { describe, expect, test } from 'vitest';

import { SettingsCategory } from '../../redux/slices/settingsCategoryStateSlice';

// KAN-862. Setup's import step sends the user to Settings › Import by name. The rail's label and the sentence are
// separate strings, so each locale must name the pane as its rail does.
const localeFiles = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

const SMALL_PRINT = 'You can also import from Settings › Import.';

describe('setup’s small print names the Import pane (KAN-862)', () => {
  test.each(Object.entries(localeFiles))('%s', (_path, strings) => {
    const label = strings[SettingsCategory.IMPORT];
    expect(label).toBeTruthy();
    expect(strings[SMALL_PRINT]).toContain(`› ${label}`);
    expect(strings[SMALL_PRINT]).not.toContain(strings['Sync & Backup']);
  });
});
