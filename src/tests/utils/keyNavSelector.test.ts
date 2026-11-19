import { describe, expect, test } from 'vitest';

// KAN-689. Every :focus-visible rule draws only while the user navigates by
// keyboard: written whileKeyNav('…'), or passed as a focusRing.ts helper's
// `on`, which wraps it. One left bare draws after a click and Delete again.
// jsdom has no :focus-visible; the behaviour is e2e/key-nav-ring.spec.ts.
const SOURCES = import.meta.glob(
  ['../../components/**/*.{ts,tsx}', '../../styles/**/*.ts'],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

// focusRing.ts is where the wrapping happens.
const GATE = '../../components/common/focusRing.ts';

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
// whileKeyNav('…') or a helper's (COLORS, '…'), quoted with ' or `.
const GATED =
  /(?:whileKeyNav\(|focusRing\w*\(\s*COLORS\s*,)\s*(['`])[\s\S]*?\1\s*\)/g;
const strip = (code: string) => code.replace(COMMENTS, '').replace(GATED, '');

describe('keyboard-only focus rules', () => {
  test('no component writes :focus-visible outside whileKeyNav', () => {
    const files = Object.entries(SOURCES).filter(([name]) => name !== GATE);
    // CONTROL: the glob read the components, so an empty scan cannot pass.
    expect(files.length).toBeGreaterThan(100);
    // CONTROL: the gate itself is in the glob, so the exclusion names a real file.
    expect(Object.keys(SOURCES)).toContain(GATE);
    // The strip leaves a bare rule, so an over-eager GATED cannot pass blind.
    expect(strip('css`\n  &:has(:focus-visible) {\n  }\n`')).toContain(
      ':focus-visible'
    );

    const offenders = files.flatMap(([name, code]) =>
      strip(code)
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => line.includes(':focus-visible'))
        .map(([line]) => `${name}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });
});
