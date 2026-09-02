// Manifest V3 forbids remotely hosted code. Firebase Auth carries script URLs
// for sign-in flows this extension never uses (Google popup, phone/reCAPTCHA),
// so the release build blanks them out.
//
// This was inline `sed` in build_and_release_artifact.yaml. It moved here for
// two reasons: the E2E harness has to produce the same artifact CI ships, and
// the sed was not portable -- CI's GNU `sed -i` needs `sed -i ''` on macOS.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The trailing [^`"]* absorbs any query string the SDK appends, which differs
// between Firebase versions. It stops at a quote or backtick so the match
// cannot run past the end of the string literal it lives in.
export const REMOTE_CODE_PATTERNS = [
  /https:\/\/apis\.google\.com\/js\/api\.js[^`"]*/g,
  /https:\/\/www\.google\.com\/recaptcha\/[^`"]*/g,
];

export function pruneRemoteCode(source) {
  return REMOTE_CODE_PATTERNS.reduce(
    // A fresh regex per call: the shared literals carry /g, and reusing them
    // across files would let lastIndex skip a match in the next one.
    (acc, pattern) => acc.replace(new RegExp(pattern.source, 'g'), ''),
    source
  );
}

function jsFilesIn(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? jsFilesIn(path) : [path];
    })
    .filter((path) => path.endsWith('.js'));
}

// Every emitted chunk is scanned, not just the popup entry: the build is
// code-split and which chunk Firebase lands in is Rollup's choice.
export function pruneDirectory(dir) {
  let filesChanged = 0;
  let bytesRemoved = 0;

  for (const file of jsFilesIn(dir)) {
    const before = readFileSync(file, 'utf8');
    const after = pruneRemoteCode(before);
    if (after !== before) {
      filesChanged += 1;
      bytesRemoved += before.length - after.length;
      writeFileSync(file, after);
    }
  }

  return { filesChanged, bytesRemoved };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist';
  const summary = pruneDirectory(dir);
  console.log(
    `Pruned remotely hosted code from ${dir}: ` +
      `${summary.filesChanged} file(s), ${summary.bytesRemoved} bytes removed.`
  );
}
