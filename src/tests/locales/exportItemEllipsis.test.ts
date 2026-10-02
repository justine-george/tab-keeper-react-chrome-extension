import { describe, expect, test } from 'vitest';

// The item opens a preview, so the ellipsis says a further step follows.
// U+2026, not "...": some voices read three dots as "dot dot dot".
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

describe('the export menu items promise a further step (KAN-226, KAN-208)', () => {
  test.each(['Export session', 'Export open windows'])(
    'every locale ends "%s" with a single ellipsis character',
    (key) => {
      const entries = Object.entries(localeFiles);
      // CONTROL: the glob found all 13 locales, so an empty loop cannot pass.
      expect(entries).toHaveLength(13);

      for (const [file, strings] of entries) {
        const value = strings[key];
        expect(value, file).toMatch(/…$/);
        expect(value, file).not.toMatch(/\.\.\.$/);
      }
    }
  );
});
