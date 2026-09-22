import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-286. A session row's counts are one phrase per locale, with i18next
// picking the plural form from Chrome's own Intl.PluralRules. The unit tests
// resolve that against inlined files; this is the built popup, fetching the
// locale over its HTTP backend, which is the path a user is on.
//
// Russian is the case: "5 Вкладки" shipped, where five takes the genitive
// plural. Chinese is the other shape the old code could not produce, a
// counter word before the noun.
for (const [language, expected] of [
  ['ru', '1 окно · 5 вкладок'],
  ['zh', '1 个窗口 · 5 个标签页'],
  ['en', '1 Window · 5 Tabs'],
] as const) {
  test(`a session row counts in ${language}`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(
      context,
      buildContainer([buildSession({ windowCount: 1, tabCount: 5 })])
    );
    await seedSettings(context, { language });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await expect(page.getByText(expected, { exact: true })).toBeVisible();
  });
}
