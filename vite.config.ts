import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The popup is still the app; the service worker is a second entry point
      // because the manifest names it by a fixed path, so it cannot carry the
      // content hash the popup's chunks get.
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background'
            ? 'background.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    // Split by file EXTENSION, not directory. src/tests/components/
    // ErrorBoundary.test.ts is a .ts node test that lives in the components
    // directory and must keep running under node -- it tests a static pure
    // function, not a render.
    //
    // The globs span all of src/, not just src/tests/, and match .spec as well
    // as .test. Scoping them to src/tests/**/*.test.* meant a colocated test
    // (src/components/Foo.test.tsx) or any *.spec file was collected by no
    // project at all: vitest reported success having silently run none of it,
    // so a failing test could not turn CI red. configIncludes.test.ts guards
    // both dimensions.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          setupFiles: ['vitest-localstorage-mock'],
          mockReset: false,
          // The second glob is why scripts/prune_remote_code.test.mjs runs at
          // all. It is deliberately narrow: scripts/ sits outside tsconfig's
          // `include` and outside `npm run lint` (which is `eslint src`), so
          // only plain .mjs belongs there -- same as the existing *.cjs.
          include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.mjs'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          globals: true,
          setupFiles: [
            'vitest-localstorage-mock',
            './src/tests/setup/componentSetup.ts',
          ],
          mockReset: false,
          include: ['src/**/*.{test,spec}.tsx'],
        },
      },
    ],
  },
});
