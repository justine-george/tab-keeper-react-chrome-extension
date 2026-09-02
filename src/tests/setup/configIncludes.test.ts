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
  test('both projects are configured, plus the scripts glob', () => {
    expect(includePatterns).toHaveLength(3);
  });

  // The original property, still asserted for the two project globs: narrowing
  // either back to src/tests/** reopens the hole that let a colocated test be
  // collected by nobody.
  test('the src globs cover all of src, not just src/tests', () => {
    const srcPatterns = includePatterns.filter((p) => p.startsWith('src/'));
    expect(srcPatterns).toHaveLength(2);
    for (const pattern of srcPatterns) {
      expect(pattern.startsWith('src/**/')).toBe(true);
    }
  });

  // scripts/ is outside tsconfig and outside `eslint src`, so its tests are
  // plain .mjs. Without this glob prune_remote_code.test.mjs is collected by
  // no project and passes by not running -- which is the failure mode this
  // whole file exists to prevent.
  test('the scripts glob collects the build-script tests', () => {
    expect(includePatterns).toContain('scripts/**/*.{test,spec}.mjs');
  });

  test('cover .spec as well as .test', () => {
    for (const pattern of includePatterns) {
      expect(pattern).toContain('{test,spec}');
    }
  });
});
