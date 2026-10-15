import { describe, expect, test } from 'vitest';

import en from '../../../public/locales/en/translation.json';
import es from '../../../public/locales/es/translation.json';
import fr from '../../../public/locales/fr/translation.json';
import hi from '../../../public/locales/hi/translation.json';
import it from '../../../public/locales/it/translation.json';
import pt from '../../../public/locales/pt/translation.json';
import ru from '../../../public/locales/ru/translation.json';

type Dict = Record<string, string>;

// KAN-601. A row's date line is Created, Edited or Deleted, all about the
// session, which is feminine here. They disagreed: es Editado beside it
// Eliminata, ru Изменено. The word before the date agrees with the session.
const FEMININE = [
  { locale: 'es', dict: es, ending: 'a' },
  { locale: 'it', dict: it, ending: 'a' },
  { locale: 'pt', dict: pt, ending: 'a' },
  { locale: 'fr', dict: fr, ending: 'ée' },
  { locale: 'ru', dict: ru, ending: 'а' },
];
const DATE_LINES = ['CreatedOn', 'EditedOn', 'DeletedOn'];

describe.each(FEMININE)('$locale date lines agree with the session', (l) => {
  test.each(DATE_LINES)('%s', (key) => {
    const value = (l.dict as Dict)[key];
    // CONTROL: the key is the date line, not a missing key read as "".
    expect(value).toMatch(/\{\{(date|when)\}\}/);
    const word = value
      .replace(/\{\{\w+\}\}/, '')
      .replace(/[\s:]+/g, ' ')
      .trim();
    expect(word.endsWith(l.ending), `${key} -> ${value}`).toBe(true);
  });
});

// KAN-601. One verb for delete per locale: the Delete button said fr Effacer,
// pt Deletar, hi मिटाना while the newer strings said supprimer, excluir,
// हटाएँ. Read against the en VALUE, since en re-maps its own keys. fr effacer
// stays where it means clear ("Effacer la recherche"), which en never calls
// delete.
const DELETE_VERB = [
  { locale: 'fr', dict: fr, uses: 'upprim', never: /effac/i },
  { locale: 'pt', dict: pt, uses: 'xclu', never: /delet/i },
  { locale: 'hi', dict: hi, uses: 'हट', never: /मिटा/ },
];
const deleteKeys = Object.entries(en as Dict)
  .filter(([, value]) => /delet/i.test(value))
  .map(([key]) => key);

describe.each(DELETE_VERB)('$locale says delete with one verb', (l) => {
  const dict = l.dict as Dict;

  test(`no delete string uses ${l.never}`, () => {
    const offenders = deleteKeys
      .filter((key) => l.never.test(dict[key] ?? ''))
      .map((key) => `${key} -> ${dict[key]}`);
    expect(offenders).toEqual([]);
  });

  // CONTROL: without it, the test above passes on a dict that failed to load.
  test(`CONTROL: delete strings do use ${l.uses}`, () => {
    expect(
      deleteKeys.filter((key) => (dict[key] ?? '').includes(l.uses)).length
    ).toBeGreaterThan(5);
  });
});
