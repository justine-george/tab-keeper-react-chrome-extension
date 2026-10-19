import { describe, expect, it, vi } from 'vitest';

// Inlined, not imported: common.ts reads window.screen at load (see toastCoverage.test.ts).
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import {
  TOAST_MESSAGES,
  GROUP_CLOSED_FRAME,
  WINDOW_CLOSED_FRAME,
} from '../../utils/constants/common';
import {
  IMPORT_INVALID_STRUCTURE,
  IMPORT_NOT_JSON,
  IMPORT_SIZE_REFUSAL,
} from '../../utils/functions/local';

// KAN-604: every toast ends with a full stop, in each locale's own (。 in ja/zh, । in hi).
// KAN-618: "!" no longer counts. ImportErrorFrame ends with its {{detail}}, so every refusal it carries ends one.
const files = import.meta.glob<Record<string, string>>(
  '/public/locales/*/translation.json',
  { import: 'default', eager: true }
);

const FULL_STOP = /[.。।]$/;

// Every form of each key (plural _one/_other...) that does not end with a full stop.
const unstopped = (keys: string[]): string[] => {
  const missing: string[] = [];
  for (const [file, json] of Object.entries(files)) {
    for (const key of keys) {
      const forms = Object.keys(json).filter(
        (k) => k === key || k.startsWith(`${key}_`)
      );
      if (forms.length === 0) missing.push(`${file}: no "${key}"`);
      for (const form of forms)
        if (!FULL_STOP.test(json[form]))
          missing.push(`${file}: "${form}" => "${json[form]}"`);
    }
  }
  return missing;
};

describe('toast full stops (KAN-604, KAN-618)', () => {
  // CONTROL: all 13 locales loaded, so an empty loop cannot pass.
  it('reads all 13 locales', () => {
    expect(Object.keys(files)).toHaveLength(13);
  });

  it('every toast, in every locale and plural form, ends with a full stop', () => {
    expect(
      unstopped([
        ...Object.values(TOAST_MESSAGES),
        WINDOW_CLOSED_FRAME,
        GROUP_CLOSED_FRAME,
      ])
    ).toEqual([]);
  });

  it('every import refusal, which ends the error frame, ends with a full stop', () => {
    expect(
      unstopped([
        IMPORT_INVALID_STRUCTURE,
        IMPORT_SIZE_REFUSAL,
        IMPORT_NOT_JSON,
      ])
    ).toEqual([]);
  });
});
