import { describe, expect, it } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-280 Part F (P B), KAN-608. The copy toast: in every locale, with its title, ending with a full stop.
// The skip toasts are gone with the duplicate check, from every locale.
const FULL_STOP = /[.。।]$/;

describe('the copy toast (KAN-280 Part F, KAN-608)', () => {
  it('exists in all 13 locales with its title, ending with a full stop', () => {
    for (const [file, json] of localeDicts) {
      expect(json.CopiedToSession, file).toMatch(/\{\{title\}\}/);
      expect(json.CopiedToSession, file).toMatch(FULL_STOP);
    }
  });

  // A window or group: "Copied N tabs to …", in every plural form the locale's LinksCopied_* has.
  it('the tab-count copy toast exists in every plural form, count before the title', () => {
    for (const [file, json] of localeDicts) {
      const forms = Object.keys(json)
        .filter((k) => k.startsWith('LinksCopied_'))
        .map((k) => k.slice('LinksCopied'.length));
      expect(forms.length, file).toBeGreaterThan(0);
      for (const form of forms) {
        const text = json[`CopiedTabsToSession${form}`];
        expect(text, `${file} ${form}`).toMatch(/\{\{count\}\}.*\{\{title\}\}/);
        expect(text, `${file} ${form}`).toMatch(FULL_STOP);
      }
      const extra = Object.keys(json).filter(
        (k) =>
          k.startsWith('CopiedTabsToSession') &&
          !forms.includes(k.slice('CopiedTabsToSession'.length))
      );
      expect(extra, file).toEqual([]);
    }
  });

  // KAN-906. A copy that leaves out every tab: the title quoted as the copy toast quotes it.
  it('the "already has" toasts exist in every locale, quoting the title as "Copied to" does', () => {
    const QUOTED = /([“”„«»「」]\s?)\{\{title\}\}(\s?[“”„«»「」])/;
    for (const [file, json] of localeDicts) {
      const marks = QUOTED.exec(json.CopiedToSession)?.slice(1);
      expect(marks, file).toHaveLength(2);
      for (const key of [
        'SessionAlreadyHasThisTab',
        'SessionAlreadyHasTheseTabs',
      ]) {
        expect(QUOTED.exec(json[key])?.slice(1), `${file} ${key}`).toEqual(
          marks
        );
        expect(json[key], `${file} ${key}`).toMatch(FULL_STOP);
      }
    }
  });

  it('no locale keeps the retired skip toasts', () => {
    for (const [file, json] of localeDicts) {
      const retired = Object.keys(json).filter(
        (k) =>
          k === 'AlreadyInSession' || k.startsWith('CopiedToSessionSkipped')
      );
      expect(retired, file).toEqual([]);
    }
  });
});
