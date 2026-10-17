import { describe, expect, test } from 'vitest';
import { waitFor } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  initialState,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import en from '../../../public/locales/en/translation.json';

// KAN-651. Settings labels are sentence case: "Time format", "Recently
// deleted". Five were Title Case ("Sync & Backup", "Auto Sync", "Sync
// Status", "Save Tab Groups", "Choose Language") and read as a different
// voice beside the rest.

// Names keep their capitals wherever they sit in a label.
const PROPER_NOUNS = ['Tab Keeper', 'Chrome'];

// The words after the first that start with a capital, names removed.
function capitalisedAfterFirst(label: string): string[] {
  const plain = PROPER_NOUNS.reduce(
    (s, name) => s.split(name).join('name'),
    label
  );
  return plain
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((word) => /^\p{Lu}/u.test(word));
}

// A section's label is its first text: NormalLabel, the nameplate, a heading.
function firstText(section: Element): string {
  const walk = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.nodeValue?.trim() ?? '';
    if (text !== '') return text;
  }
  return '';
}

describe('Settings labels are sentence case (KAN-651)', () => {
  test('the rail', () => {
    const rail = initialState.map(({ name }) => en[name as keyof typeof en]);
    expect(rail).toHaveLength(initialState.length);
    expect(
      rail.filter((label) => capitalisedAfterFirst(String(label)).length > 0)
    ).toEqual([]);
  });

  test.each(initialState.map(({ name }) => name))(
    'the section labels on %s',
    async (category) => {
      const { container } = await renderWithProviders(
        <SettingsDetailsContainer />,
        { seedStore: (store) => store.dispatch(selectCategory(category)) }
      );
      // Help draws nothing until Chrome answers whether the toolbar pin is on.
      const sections = () => [
        ...container.querySelectorAll('[data-settings-section]'),
      ];
      await waitFor(() => expect(sections().length).toBeGreaterThan(0));
      const labels = sections().map(firstText);
      expect(labels).not.toContain('');
      expect(
        labels.filter((label) => capitalisedAfterFirst(label).length > 0)
      ).toEqual([]);
    }
  );

  test('CONTROL: the check finds a Title Case label and passes a name', () => {
    expect(capitalisedAfterFirst('Sync & Backup')).toEqual(['Backup']);
    expect(capitalisedAfterFirst('Save Tab Groups')).toEqual(['Tab', 'Groups']);
    expect(capitalisedAfterFirst('Pin Tab Keeper in new windows')).toEqual([]);
    expect(capitalisedAfterFirst('Tab Keeper')).toEqual([]);
    expect(capitalisedAfterFirst('Time format')).toEqual([]);
  });
});
