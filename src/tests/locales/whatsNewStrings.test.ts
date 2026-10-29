import { describe, expect, test } from 'vitest';

import { WHATS_NEW } from '../../utils/constants/whatsNew';

// KAN-861. What's new's words in every locale; the Copy links body names the labels on screen.

const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);

const VERSION_TITLE = "What's new in Tab Keeper {{version}}";
const KEYS = [
  VERSION_TITLE,
  "What's new in Tab Keeper",
  'Open Settings',
  ...WHATS_NEW.flatMap((r) =>
    r.entries.flatMap((e) => [e.titleKey, e.bodyKey])
  ),
];

test('13 locales are read', () => {
  expect(locales).toHaveLength(13);
});

describe.each(locales)('%s', (_, dict) => {
  test.each(KEYS)('has %s, non-empty', (key) => {
    expect(dict[key]?.trim()).toBeTruthy();
    expect(key.endsWith(':')).toBe(false);
  });

  test('the version title keeps {{version}}', () => {
    expect(dict[VERSION_TITLE]).toContain('{{version}}');
  });

  test('the Copy links body names With headings and Settings › Sessions as shown', () => {
    const body = dict.WhatsNewCopyLinksBody;
    expect(body).toContain(dict['With headings']);
    expect(body).toContain(`${dict.Settings} › ${dict.Sessions}`);
  });
});
