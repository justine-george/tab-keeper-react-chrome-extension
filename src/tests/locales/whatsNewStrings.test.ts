import { describe, expect, test } from 'vitest';

import { WHATS_NEW } from '../../utils/constants/whatsNew';

// KAN-861. What's new's words in every locale; each body names the labels on screen.

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

  test('the Replace body names Replace with current window as shown', () => {
    expect(dict.WhatsNewReplaceWindowBody).toContain(
      dict['Replace with current window']
    );
  });

  test('the duplicates body names the Currently open pane as shown', () => {
    expect(dict.WhatsNewOpenDuplicatesBody).toContain(dict['Open now']);
  });

  test('the open-in-this-window body names This window, Open saved windows and Settings › Sessions as shown', () => {
    const body = dict.WhatsNewOpenInThisWindowBody;
    expect(body).toContain(dict['This window']);
    expect(body).toContain(dict['Open saved windows']);
    expect(body).toContain(`${dict.Settings} › ${dict.Sessions}`);
  });

  test('the skip body names both Skip settings and Settings › Sessions as shown', () => {
    const body = dict.WhatsNewSkipTabsBody;
    expect(body).toContain(dict['Skip duplicate tabs']);
    expect(body).toContain(dict['Skip tabs already open']);
    expect(body).toContain(`${dict.Settings} › ${dict.Sessions}`);
  });

  test('the switch body names the Ctrl key as shown', () => {
    expect(dict.WhatsNewSwitchToOpenTabBody).toContain(dict.Ctrl);
  });

  test('the toolbar body names Color, Monochrome and Settings › Display as shown', () => {
    const body = dict.WhatsNewToolbarIconBody;
    expect(body).toContain(dict.ToolbarIconColour);
    expect(body).toContain(dict.ToolbarIconMonochrome);
    expect(body).toContain(`${dict.Settings} › ${dict.Display}`);
  });

  test('the group color body names Currently open as shown', () => {
    expect(dict.WhatsNewGroupColorBody).toContain(dict['Open now']);
  });

  test('the new window body names Open in new window as shown', () => {
    expect(dict.WhatsNewOpenNewWindowBody).toContain(
      dict['Open in new window']
    );
  });
});
