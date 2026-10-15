import { describe, expect, it, vi } from 'vitest';

// Inlined, not imported: common.ts reads window.screen at load (see toastCoverage.test.ts).
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import {
  TOAST_MESSAGES,
  WINDOW_CLOSED_FRAME,
} from '../../utils/constants/common';

// KAN-604: every toast ends with a full stop, in each locale's own (。 in ja/zh, । in hi).
// "!" also ends a sentence: IMPORT_SUCCESS keeps it. ImportErrorFrame is not here: its {{detail}} ends it.
const files = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

const SENTENCE_END = /[.。।!！]$/;
const KEYS = [...Object.values(TOAST_MESSAGES), WINDOW_CLOSED_FRAME];

describe('toast full stops (KAN-604)', () => {
  it('every toast, in every locale and plural form, ends a sentence', () => {
    // CONTROL: all 13 locales loaded, so an empty loop cannot pass.
    expect(Object.keys(files)).toHaveLength(13);
    const missing: string[] = [];
    for (const [file, json] of Object.entries(files)) {
      for (const key of KEYS) {
        const forms = Object.keys(json).filter(
          (k) => k === key || k.startsWith(`${key}_`)
        );
        if (forms.length === 0) missing.push(`${file}: no "${key}"`);
        for (const form of forms)
          if (!SENTENCE_END.test(json[form]))
            missing.push(`${file}: "${form}" => "${json[form]}"`);
      }
    }
    expect(missing).toEqual([]);
  });
});
