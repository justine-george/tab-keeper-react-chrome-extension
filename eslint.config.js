import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // Flat config has no .eslintignore. `dist` and `coverage` are build output;
  // node_modules is ignored by default.
  { ignores: ['dist/**', 'coverage/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Replaces `env: { browser: true, es2020: true }`, which flat config drops.
      // Changes no finding today - typescript-eslint turns `no-undef` off for
      // TS files because tsc already catches undefined identifiers. Kept because
      // it is a true statement about where this code runs, and it is what any
      // scope-analysis rule added later will read.
      globals: { ...globals.browser, ...globals.es2020 },
    },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': 'warn',

      // @typescript-eslint/recommended sets this to 'error'. Nothing in the
      // project ever opted into that, and combined with --max-warnings 0 and no
      // lint step in CI it produced a script that could not pass and that nobody
      // ran. Downgraded deliberately so real errors gate CI while the remaining
      // `any`s stay visible. They are mostly boundary code where `unknown` plus a
      // type guard is the right answer - see isValidTabMasterContainer in
      // utils/functions/local.ts for the pattern to follow when clearing them.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // react-hooks is on 7 because it is the ONLY release whose peer range accepts
  // ESLint 10; every version from 5.0.0 to 7.0.0 caps at ^9. That forces in its
  // React Compiler machinery (@babel/core, hermes-parser, zod) as a transitive
  // cost we cannot avoid while on ESLint 10 (KAN-46).
  //
  // Since the dependency is paid for either way, the full rule set is on:
  // `recommended-latest` is 17 rules, the two this project has always gated on
  // plus 15 React Compiler ones. Enabling them cost 3 fixes, all
  // `react-hooks/set-state-in-effect` and all the same shape -- state seeded
  // from a prop by an effect, in HeroContainerRight and WindowEntryContainer.
  // Two were rename drafts being overwritten mid-edit by a sync merge; one was
  // a reset a `key` already performed. See KAN-51 and renameDrafts.test.tsx.
  //
  // Spread into a `files`-scoped block rather than listed bare: the upstream
  // object carries no `files`, and every other block here is scoped to ts/tsx.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.flat['recommended-latest'].rules,
  },

  // Must stay last: turns off every core rule that conflicts with prettier.
  prettierRecommended
);
