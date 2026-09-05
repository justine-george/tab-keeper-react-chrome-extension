import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import de from '../../../public/locales/de/translation.json';
import en from '../../../public/locales/en/translation.json';
import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { initTestI18n, testI18n } from '../setup/i18nForTests';
import { showToast } from '../../redux/slices/globalStateSlice';
import { IMPORT_ERROR_FRAME } from '../../utils/constants/common';
import {
  IMPORT_INVALID_STRUCTURE,
  SYNC_SIZE_REFUSAL,
} from '../../utils/functions/local';

// KAN-86. Error toasts used to be built by string concatenation, so the
// composed result matched no i18n key, t() handed it straight back, and every
// locale saw English. They now travel as a key plus its interpolation values.
//
// This has to be asserted in a NON-ENGLISH locale. In `en` the key IS the
// value, so "found the translation" and "fell back to the key" render
// identically and a test proves nothing. See i18n-keys-are-not-display-strings.
//
// The expected strings are computed from the raw locale JSON with a plain
// string replace, never by calling t() -- resolving the expectation through
// the machinery under test would pass no matter what that machinery did.
const interpolate = (
  template: string,
  params: Record<string, string>
): string =>
  Object.entries(params).reduce(
    (out, [key, value]) => out.split(`{{${key}}}`).join(value),
    template
  );

beforeEach(async () => {
  await initTestI18n();
});

afterEach(async () => {
  // The instance is shared, so a leaked locale would run every later test in
  // the wrong language.
  await testI18n.changeLanguage('en');
});

// changeLanguage AFTER the render: initTestI18n() calls init({ lng: 'en' }),
// which RESETS the language, so switching first silently runs English.
const renderToastIn = async (locale: 'de') => {
  const rendered = await renderWithProviders(<Toast />);
  testI18n.addResourceBundle(locale, 'translation', de, true, true);
  await act(async () => {
    await testI18n.changeLanguage(locale);
  });
  // CONTROL: without this, every assertion below could be passing in English.
  expect(testI18n.language).toBe(locale);
  return rendered;
};

describe('error toasts are translated (KAN-86)', () => {
  test('an import refusal renders in German, reason and all', async () => {
    const { store, container } = await renderToastIn('de');

    await act(async () => {
      await store.dispatch(
        showToast({
          toastText: IMPORT_ERROR_FRAME,
          toastParams: { detail: testI18n.t(IMPORT_INVALID_STRUCTURE) },
          duration: 10_000,
        })
      );
    });

    const expected = interpolate(de.ImportErrorFrame, {
      detail: de['Invalid JSON structure.'],
    });
    expect(container.textContent).toBe(expected);

    // Both halves have to be German. Translating the frame while leaving the
    // reason in English is the exact half-fix worth catching, and it would
    // satisfy any assertion that only looked at the opening words.
    expect(container.textContent).toContain(de['Invalid JSON structure.']);

    // CONTROL: the English forms must be absent, which is what proves no
    // fallback-to-key occurred.
    expect(container.textContent).not.toContain('Error restoring tabs');
    expect(container.textContent).not.toContain(en['Invalid JSON structure.']);
  });

  test('the sync size refusal renders in German with its numbers', async () => {
    const { store, container } = await renderToastIn('de');

    await act(async () => {
      await store.dispatch(
        showToast({
          toastText: SYNC_SIZE_REFUSAL,
          toastParams: { used: '1.4', limit: '1.0' },
          duration: 10_000,
        })
      );
    });

    expect(container.textContent).toBe(
      interpolate(de.SyncSizeRefusal, { used: '1.4', limit: '1.0' })
    );
    // The numbers are the entire point of the message: a key that translated
    // but dropped its params would still read as a fluent German sentence.
    expect(container.textContent).toContain('1.4');
    expect(container.textContent).toContain('1.0');
    expect(container.textContent).not.toContain('{{');
    expect(container.textContent).not.toContain('too large to sync');
  });

  // A JSON SyntaxError has no key and never will -- it names the offending
  // token. It must survive as raw technical detail inside a translated frame,
  // rather than being dropped or mangled.
  test('a platform error survives untranslated inside a German frame', async () => {
    const { store, container } = await renderToastIn('de');
    const raw = 'Unexpected token n in JSON at position 1';

    await act(async () => {
      await store.dispatch(
        showToast({
          toastText: IMPORT_ERROR_FRAME,
          toastParams: { detail: raw },
          duration: 10_000,
        })
      );
    });

    expect(container.textContent).toBe(
      interpolate(de.ImportErrorFrame, { detail: raw })
    );
    // The frame is German...
    expect(container.textContent).not.toContain('Error restoring tabs');
    // ...and the untranslatable part is intact, not swallowed.
    expect(container.textContent).toContain(raw);
  });
});
