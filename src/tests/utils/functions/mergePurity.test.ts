// mergeTabData.ts must not pull in the Redux slice, which transitively reads
// window.screen.height at module load (src/utils/constants/common.ts:19). This
// file deliberately installs NO DOM stub - if the import below starts
// requiring one, this test fails and that is the signal.
import { describe, it, expect } from 'vitest';

import { mergeTabContainers } from '../../../utils/functions/mergeTabData';
// Vite's ?raw suffix, typed by the vite/client reference in src/vite-env.d.ts.
// Preferred over node:fs, which does not resolve here: @types/node is present
// transitively but is not in tsconfig's `types` array, so `node:fs` fails
// tsc even though it runs fine under vitest.
import mergeSource from '../../../utils/functions/mergeTabData.ts?raw';

describe('mergeTabData purity', () => {
  it('imports with no DOM present', () => {
    expect(typeof mergeTabContainers).toBe('function');
  });

  // A source-level check, and it needs to be, because the runtime check above
  // cannot see this on its own: esbuild elides an import whose bindings are
  // used only in type positions, so rewriting `import type` as a plain
  // `import` emits identical JS and breaks nothing at runtime. Measured, not
  // assumed - the swap was made and all tests still passed.
  //
  // It still matters. `import type` makes it a compile error to use any of
  // these bindings as a value, and a used value import is exactly the change
  // that survives elision, drags in common.ts and throws
  // `ReferenceError: window is not defined`. This test keeps that compile-time
  // guarantee from being removed silently.
  it('imports slice types with `import type`, not a value import', () => {
    const sliceImportLines = mergeSource
      .split('\n')
      .filter((line: string) => line.includes('tabContainerDataStateSlice'));

    expect(sliceImportLines.length).toBeGreaterThan(0);
    expect(mergeSource).not.toMatch(
      /^import \{[^}]*\} from '.*tabContainerDataStateSlice'/m
    );
    expect(mergeSource).toMatch(/^import type \{/m);
  });
});
