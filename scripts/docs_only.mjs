import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// KAN-664. Whether a PR's changed files are all Markdown docs, so
// build_before_merge.yaml can skip lint, unit and e2e for it. A `.md` under
// public/ ships in the extension (public/ is copied into dist), and one under
// src/ sits beside code, so neither counts. No test reads a doc's text:
// noAnalytics.test.ts checks src/ against PRIVACY.md's claim, not the file.
//
// An empty list is not docs-only: it means the diff found nothing or failed,
// and then everything runs.
export function isDocsOnly(files) {
  return (
    files.length > 0 &&
    files.every(
      (file) =>
        file.endsWith('.md') &&
        !file.startsWith('public/') &&
        !file.startsWith('src/')
    )
  );
}

// `git diff --name-only ... | node scripts/docs_only.mjs` prints true or false.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  process.stdout.write(`${isDocsOnly(files)}\n`);
}
