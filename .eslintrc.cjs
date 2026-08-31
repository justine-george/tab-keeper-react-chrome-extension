module.exports = {
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:prettier/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh', 'prettier'],
  rules: {
    'react-refresh/only-export-components': 'warn',
    'prettier/prettier': 'error',
    // @typescript-eslint/recommended sets this to 'error'. Nothing in the
    // project ever opted into that, and combined with --max-warnings 0 and no
    // lint step in CI it produced a script that could not pass and that nobody
    // ran. Downgraded deliberately so real errors gate CI while the remaining
    // `any`s stay visible. They are mostly boundary code where `unknown` plus a
    // type guard is the right answer - see isValidTabMasterContainer in
    // utils/functions/local.ts for the pattern to follow when clearing them.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
