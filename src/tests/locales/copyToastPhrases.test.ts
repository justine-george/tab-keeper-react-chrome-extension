import { describe, expect, it } from 'vitest';

// KAN-280 Part F (P B). The three copy toasts: in every locale, every plural form, ending with a full stop.
const files = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

const FULL_STOP = /[.。।]$/;
const formsOf = (json: Record<string, string>) =>
  Object.keys(json)
    .filter((k) => k.startsWith('LinksCopied_'))
    .map((k) => k.slice('LinksCopied'.length));

describe('the copy toasts (KAN-280 Part F, P B)', () => {
  it('exist in all 13 locales, in every plural form, with their params, each ending with a full stop', () => {
    // CONTROL: the glob found all 13 locales, so an empty loop cannot pass.
    expect(Object.keys(files)).toHaveLength(13);
    for (const [file, json] of Object.entries(files)) {
      for (const key of ['CopiedToSession', 'AlreadyInSession']) {
        expect(json[key], `${file} ${key}`).toMatch(/\{\{title\}\}/);
        expect(json[key], `${file} ${key}`).toMatch(FULL_STOP);
      }
      const forms = formsOf(json);
      expect(forms.length, file).toBeGreaterThan(0);
      for (const form of forms) {
        const text = json[`CopiedToSessionSkipped${form}`];
        expect(text, `${file} ${form}`).toMatch(
          /\{\{title\}\}.*\{\{count\}\}|\{\{count\}\}.*\{\{title\}\}/
        );
        expect(text, `${file} ${form}`).toMatch(FULL_STOP);
      }
      // No form the locale lacks.
      const extra = Object.keys(json).filter(
        (k) =>
          k.startsWith('CopiedToSessionSkipped') &&
          !forms.includes(k.slice('CopiedToSessionSkipped'.length))
      );
      expect(extra, file).toEqual([]);
    }
  });
});
