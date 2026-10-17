import { describe, expect, test } from 'vitest';

import it from '../../../public/locales/it/translation.json';

// KAN-665. Italian elides with an apostrophe (l’ordine, un’altra), and the
// file wrote it two ways: eight strings with a straight ' and six with ’,
// sometimes on one screen. ’ is the one French settled on in KAN-648. The
// lookalikes a keyboard or an autocorrect can produce are refused with it.
// Only the values are checked: the keys are English source text, which keeps
// its straight apostrophe.
const dict: Record<string, string> = it;
const notTheItalianApostrophe = /['‘`´ʼ]/;

describe('Italian writes its apostrophe as ’ (KAN-665)', () => {
  test('no string uses a straight apostrophe or a lookalike', () => {
    // CONTROL: the file is loaded and does use ’, so an empty or unrelated
    // dictionary cannot pass.
    expect(dict['Get the extension']).toBe('Ottieni l’estensione');

    const wrong = Object.entries(dict).filter(([, text]) =>
      notTheItalianApostrophe.test(text)
    );
    expect(wrong).toEqual([]);
  });
});
