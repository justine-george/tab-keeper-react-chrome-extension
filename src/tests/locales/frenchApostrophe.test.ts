import { describe, expect, test } from 'vitest';

import fr from '../../../public/locales/fr/translation.json';

// KAN-648. French writes its apostrophe as ’ (l’onglet), and every French
// string here does. A new one typed with a straight ' would read fine and pass
// every other locale test, so nothing caught it. The lookalikes a keyboard or
// an autocorrect can produce are refused with it. Only the values are checked:
// the keys are English source text, which keeps its straight apostrophe.
const dict: Record<string, string> = fr;
const notTheFrenchApostrophe = /['‘`´ʼ]/;

describe('French writes its apostrophe as ’ (KAN-648)', () => {
  test('no string uses a straight apostrophe or a lookalike', () => {
    // CONTROL: the file is loaded and does use ’, so an empty or unrelated
    // dictionary cannot pass.
    expect(dict['Close tab']).toBe('Fermer l’onglet');

    const wrong = Object.entries(dict).filter(([, text]) =>
      notTheFrenchApostrophe.test(text)
    );
    expect(wrong).toEqual([]);
  });
});
