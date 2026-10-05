import { describe, expect, test } from 'vitest';

import pt from '../../../public/locales/pt/translation.json';

// pt calls a tab "aba"; "guia" stays only in Chrome's own feature name, "grupo de guias".
const STRAY_GUIA = /\bguias?\b/i;
const FEATURE_NAME = /grupos? de guias/gi;

function strayGuia(value: string): boolean {
  return STRAY_GUIA.test(value.replace(FEATURE_NAME, ''));
}

describe('the Portuguese strings use one word for a tab', () => {
  test('no value says "guia" outside "grupo de guias"', () => {
    const offenders = Object.entries(pt as Record<string, string>)
      .filter(([, value]) => strayGuia(value))
      .map(([key, value]) => `${key} -> ${value}`);

    expect(offenders).toEqual([]);
  });

  test('CONTROL: the check catches a stray "guia" and spares the feature name', () => {
    expect(strayGuia('de qualquer guia.')).toBe(true);
    expect(strayGuia('Salvar grupos de guias')).toBe(false);
    expect(strayGuia('de qualquer aba.')).toBe(false);
  });
});
