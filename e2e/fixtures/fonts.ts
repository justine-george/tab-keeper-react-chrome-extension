import type { Page } from '@playwright/test';

// KAN-215. Waits until the page's fonts have ACTUALLY loaded.
//
// Not `document.fonts.check(...)`, which the add-window spec used to wait on.
// check() answers "is anything for this font still waiting to load?", so it
// returns true when NO matching @font-face exists at all. Measured offline
// against the Google-hosted fonts: the stylesheet failed, no face was ever
// declared, check() read true, and every icon drew its ligature name as text.
// A barrier that passes in exactly the state it exists to rule out.
//
// This requires a FontFace of each family to exist and to have reached
// `loaded`, so a page with no such face times out instead of passing.
export async function waitForFontsLoaded(
  page: Page,
  families: string[] = ['Material Symbols Outlined', 'Libre Franklin']
): Promise<void> {
  await page.waitForFunction(
    (wanted) => {
      const loaded = new Set(
        [...document.fonts]
          .filter((face) => face.status === 'loaded')
          // A face declared in CSS may report its family quoted.
          .map((face) => face.family.replace(/^["']|["']$/g, ''))
      );
      return wanted.every((family) => loaded.has(family));
    },
    families,
    { timeout: 5000 }
  );
}
