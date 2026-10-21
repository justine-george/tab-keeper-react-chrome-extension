import { describe, expect, test } from 'vitest';

import {
  BB_PINK_THEME,
  BLUE_THEME,
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../hooks/useThemeColors';

// KAN-588. Every dialog dimmed the page 80% black on every theme: copied from
// the first modal (2023), never chosen, and heavy enough that setup's live
// theme change was hidden behind it. Now one theme token, Justine's pick D2:
// 40% on the light grounds, 55% on the dark, and always heavier than the
// tour's dim, which only points where a dialog blocks.

const THEMES: [string, string, ThemeColors][] = [
  ['Paper', 'rgba(0, 0, 0, 0.4)', LIGHT_THEME],
  ['Chalk', 'rgba(0, 0, 0, 0.4)', CHALK_THEME],
  ['Parchment', 'rgba(0, 0, 0, 0.4)', WARM_LIGHT_THEME],
  ['Petal', 'rgba(0, 0, 0, 0.4)', BB_PINK_THEME],
  ['Graphite', 'rgba(0, 0, 0, 0.55)', DARKENHEIMER_THEME],
  ['Ink', 'rgba(0, 0, 0, 0.55)', BLUE_THEME],
  ['Charcoal', 'rgba(0, 0, 0, 0.55)', CHARCOAL_THEME],
];

const alpha = (rgba: string): number => {
  const match = /^rgba\(0, 0, 0, ([\d.]+)\)$/.exec(rgba);
  if (match === null) throw new Error(`not a black rgba: ${rgba}`);
  return Number(match[1]);
};

// Read through import.meta.glob, not node:fs (see keyCoverage.test.ts).
const sources = import.meta.glob('/src/components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Each `::backdrop { ... }` block in the components, by file.
const backdrops = Object.entries(sources).flatMap(([path, text]) =>
  [...text.matchAll(/::backdrop\s*\{([^}]*)\}/g)].map(
    (m) => [path, m[1]] as const
  )
);

describe('the dialog backdrop (KAN-588)', () => {
  test.each(THEMES)('%s dims the page %s', (_name, value, theme) => {
    expect(theme.MODAL_BACKDROP).toBe(value);
  });

  test.each(THEMES)(
    '%s: the tour’s dim is lighter than a dialog’s',
    (_name, _value, theme) => {
      expect(alpha(theme.TOUR_SCRIM)).toBeLessThan(alpha(theme.MODAL_BACKDROP));
    }
  );

  test('every dialog takes its backdrop from the theme, none hard-codes one', () => {
    // PREMISE: the scan finds all 9 dialogs.
    expect(backdrops.length).toBeGreaterThanOrEqual(9);
    for (const [path, body] of backdrops) {
      expect(body, path).toMatch(/COLORS\.MODAL_BACKDROP/);
      expect(body, path).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
    }
  });
});
