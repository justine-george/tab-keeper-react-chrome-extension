import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A locale's strings, read from the file the extension ships.
 *
 * Specs locate controls by their RENDERED names, and `en` re-maps some of its
 * own keys -- "Export open windows" renders as "Export open windows…" -- so a
 * locator written from a key matches nothing and fails as "element not found",
 * which reads like a broken control rather than a broken locator.
 *
 * Reading the file also keeps a spec from going red when the copy is reworded:
 * the component tests pin the wording, this pins the LAYOUT and the wiring.
 */
export function localeStrings(lang: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../public/locales/${lang}/translation.json`,
          import.meta.url
        )
      ),
      'utf8'
    )
  );
}
