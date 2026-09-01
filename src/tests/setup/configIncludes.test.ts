import { describe, expect, test } from 'vitest';

// Read as text rather than imported: vite.config.ts uses __dirname and
// node:path, and tsconfig.json's `types` array deliberately omits "node", so
// importing it here would fail tsc for the same reason keyCoverage.test.ts
// cannot use node:fs. See that file for why adding "node" is not the fix.
const configSource = Object.values(
  import.meta.glob('/vite.config.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)[0];

const includePatterns = [
  ...configSource.matchAll(/include:\s*\[([^\]]*)\]/g),
].flatMap(([, body]) => [...body.matchAll(/'([^']+)'/g)].map(([, p]) => p));

// A test-infrastructure bug is silent by construction: a harness that collects
// nothing reports success. These globs previously read src/tests/**/*.test.ts,
// which meant a colocated src/components/Foo.test.tsx and any *.spec file were
// claimed by no project -- vitest exited 0 having run neither. Both dimensions
// are asserted because narrowing either one reopens the hole.
describe('vitest include globs', () => {
  test('both projects are configured', () => {
    expect(includePatterns).toHaveLength(2);
  });

  test('cover all of src, not just src/tests', () => {
    for (const pattern of includePatterns) {
      expect(pattern.startsWith('src/**/')).toBe(true);
    }
  });

  test('cover .spec as well as .test', () => {
    for (const pattern of includePatterns) {
      expect(pattern).toContain('{test,spec}');
    }
  });
});
