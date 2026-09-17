import { describe, expect, test } from 'vitest';

// KAN-226. The session menu's export item opens a preview; nothing is saved
// until a button there is pressed. Its label ends in an ellipsis in every
// language, because that is the one word-free way to say "a further step
// follows" -- and without it "Export" reads as though the click did it.
//
// U+2026, not three full stops: screen readers read "..." as "dot dot dot" in
// several voices, and three dots do not break as one character.
const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

// KAN-208 adds the second such item: the save row's "Export open windows…"
// opens the same preview from the popup's other pane.
describe('the export menu items promise a further step (KAN-226, KAN-208)', () => {
  test.each(['Export session', 'Export open windows'])(
    'every locale ends "%s" with a single ellipsis character',
    (key) => {
      const entries = Object.entries(localeFiles);
      // CONTROL: the glob found the ten locales, so an empty loop cannot pass.
      expect(entries).toHaveLength(10);

      for (const [file, strings] of entries) {
        const value = strings[key];
        expect(value, file).toMatch(/…$/);
        expect(value, file).not.toMatch(/\.\.\.$/);
      }
    }
  );
});
