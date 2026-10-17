import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { isDocsOnly } from './docs_only.mjs';

// KAN-664. A PR that changes only Markdown docs skips lint, unit and e2e in
// build_before_merge.yaml. Anything this cannot vouch for runs everything.
describe('isDocsOnly', () => {
  test('a README change alone is docs-only', () => {
    expect(isDocsOnly(['README.md'])).toBe(true);
  });

  test('the privacy policy and README together are docs-only', () => {
    expect(isDocsOnly(['PRIVACY.md', 'README.md'])).toBe(true);
  });

  test('a doc in a folder outside src/ and public/ is docs-only', () => {
    expect(isDocsOnly(['e2e/README.md'])).toBe(true);
  });

  test('a doc beside a code change is not', () => {
    expect(isDocsOnly(['README.md', 'src/App.tsx'])).toBe(false);
  });

  // public/ is copied into the extension as it is.
  test('a Markdown file in public/ is not', () => {
    expect(isDocsOnly(['public/notes.md'])).toBe(false);
  });

  test('a Markdown file in src/ is not', () => {
    expect(isDocsOnly(['src/components/notes.md'])).toBe(false);
  });

  test('the workflow itself is not', () => {
    expect(isDocsOnly(['.github/workflows/build_before_merge.yaml'])).toBe(
      false
    );
  });

  test('names that only look like Markdown are not', () => {
    expect(isDocsOnly(['README.md.ts'])).toBe(false);
    expect(isDocsOnly(['notes.mdx'])).toBe(false);
    expect(isDocsOnly(['NOTES.MD'])).toBe(false);
  });

  // An empty list means the diff found nothing, or failed: run everything.
  test('no files is not', () => {
    expect(isDocsOnly([])).toBe(false);
  });
});

describe('the command line', () => {
  const script = fileURLToPath(new URL('./docs_only.mjs', import.meta.url));
  const run = (input) => execFileSync('node', [script], { input }).toString();

  test('reads one name per line and prints true', () => {
    expect(run('README.md\nPRIVACY.md\n')).toBe('true\n');
  });

  test('prints false for a code change, and ignores blank lines', () => {
    expect(run('README.md\n\nsrc/App.tsx\n')).toBe('false\n');
  });

  test('prints false for no input', () => {
    expect(run('')).toBe('false\n');
  });
});
