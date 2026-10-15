import { describe, expect, test } from 'vitest';

import it from '../../../public/locales/it/translation.json';

// KAN-620. Chrome's Italian calls a tab "scheda" everywhere, its counts
// included ("1 scheda", "# schede"), and so did most of this file. Thirteen
// strings said "Tab" instead. The product name keeps its English word.
const dict: Record<string, string> = it;
const withoutName = (text: string) => text.replaceAll('Tab Keeper', '');

describe('Italian calls a tab "scheda" (KAN-620)', () => {
  test('no string says "tab" outside the product name', () => {
    // CONTROL: the file is loaded and does use scheda, so an empty or
    // unrelated dictionary cannot pass.
    expect(dict['Tab closed.']).toBe('Scheda chiusa.');

    const saysTab = Object.entries(dict).filter(([, text]) =>
      /\btab\b/i.test(withoutName(text))
    );
    expect(saysTab).toEqual([]);
  });

  test('a count of one says scheda, any other count schede', () => {
    const counts = Object.entries(dict).filter(
      ([key, text]) => /_(one|many|other)$/.test(key) && /\bsched/.test(text)
    );
    // CONTROL: the tab counts are among them.
    expect(counts.map(([key]) => key)).toEqual(
      expect.arrayContaining(['TabCount_one', 'TabCount_other'])
    );
    for (const [key, text] of counts) {
      const form = key.endsWith('_one') ? /\bscheda\b/ : /\bschede\b/;
      expect(text, key).toMatch(form);
    }
  });
});
