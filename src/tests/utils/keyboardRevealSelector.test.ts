import { describe, expect, test } from 'vitest';

// KAN-636, after KAN-94. A row reveals its actions for keyboard focus only:
// :focus-within also matches the focus a click leaves, so a row stayed
// engaged after the pointer left (a ⋮ closed by clicking it). The reveal is
// written :has(:focus-visible), in its own rule beside :hover. The real
// behaviour is e2e/mouse-focus-reveal.spec.ts; jsdom has no :focus-visible.
const SOURCES = import.meta.glob('../../components/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('keyboard reveals', () => {
  test('no component styles on :focus-within', () => {
    const files = Object.entries(SOURCES);
    // CONTROL: the glob read the components, so an empty scan cannot pass.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap(([name, code]) =>
      code
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => /&:focus-within/.test(line))
        .map(([, n]) => `${name}:${n}`)
    );
    expect(offenders).toEqual([]);
  });
});
