// Downloads the extension's fonts into src/assets/fonts/ (KAN-215).
//
// Both fonts used to be linked from fonts.googleapis.com, so offline the popup
// printed its icon names as text. They now ship inside the extension, and the
// build never touches the network: this script is run BY HAND and its output
// is committed.
//
// Run it whenever LIGATURE_ICON_NAMES changes:
//
//   npm run fonts:fetch
//
// Material Symbols is fetched as a subset holding only the ligatures in
// src/components/common/iconNames.ts (~5 KB rather than 344 KB), using the
// Google Fonts `icon_names` parameter. Forgetting to rerun this after adding a
// name fails e2e/icon-font-subset.spec.ts.
//
// Requires Node 23.6+ to import the TypeScript list directly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LIGATURE_ICON_NAMES } from '../src/components/common/iconNames.ts';

const OUT = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));

// Google serves WOFF2 only to a browser it recognises; anything else gets TTF.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

/** Each @font-face in a Google Fonts stylesheet: its comment label and URL. */
async function faces(cssUrl) {
  const css = await (await get(cssUrl)).text();
  return [
    ...css.matchAll(
      /(?:\/\* ([\w-]+) \*\/\s*)?@font-face \{[^}]*?src: url\(([^)]+)\)/g
    ),
  ].map(([, label, url]) => ({ label, url }));
}

async function save(url, name) {
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  writeFileSync(`${OUT}${name}`, bytes);
  console.log(`${String(bytes.length).padStart(7)}  ${name}`);
}

mkdirSync(OUT, { recursive: true });

// The API requires the names sorted, and silently ignores the parameter when
// they are not.
const names = [...LIGATURE_ICON_NAMES].sort();
const symbols = await faces(
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:' +
    `opsz,wght,FILL,GRAD@48,400,0,0&icon_names=${names.join(',')}`
);
if (symbols.length !== 1) {
  throw new Error(`expected one Material Symbols face, got ${symbols.length}`);
}
await save(symbols[0].url, 'material-symbols-outlined-subset.woff2');

// Libre Franklin is a variable font: one file per script subset covers both
// weights, so the 400 and 500 faces name the same URLs.
const franklin = await faces(
  'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500'
);
const subsets = new Map(franklin.map(({ label, url }) => [label, url]));
for (const [label, url] of subsets) {
  await save(url, `libre-franklin-${label}.woff2`);
}

await save(
  'https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE',
  'LICENSE-material-symbols.txt'
);
await save(
  'https://raw.githubusercontent.com/google/fonts/main/ofl/librefranklin/OFL.txt',
  'OFL-libre-franklin.txt'
);
