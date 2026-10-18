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

describe('keyboard-only focus rules', () => {
  test('no component writes :focus-visible outside whileKeyNav', () => {
    const files = Object.entries(SOURCES).filter(([name]) => name !== GATE);
    // CONTROL: the glob read the components, so an empty scan cannot pass.
    expect(files.length).toBeGreaterThan(100);
    // CONTROL: the gate itself is in the glob, so the exclusion names a real file.
    expect(Object.keys(SOURCES)).toContain(GATE);

    const offenders = files.flatMap(([name, code]) =>
      code
        .replace(COMMENTS, '')
        .replace(GATED, '')
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => line.includes(':focus-visible'))
        .map(([line]) => `${name}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });

  test('the scan finds a bare rule', () => {
    const bare = 'css`\n  &:has(:focus-visible) {\n    opacity: 1;\n  }\n`';
    const gated = "css`\n  ${whileKeyNav('&:has(:focus-visible)')} {\n`";
    const helper =
      "${focusRingCss(\n  COLORS,\n  '&:has(> input:focus-visible)'\n)}";
    const strip = (code: string) =>
      code.replace(COMMENTS, '').replace(GATED, '').includes(':focus-visible');

    expect(strip(bare)).toBe(true);
    expect(strip(gated)).toBe(false);
    expect(strip(helper)).toBe(false);
  });
});
