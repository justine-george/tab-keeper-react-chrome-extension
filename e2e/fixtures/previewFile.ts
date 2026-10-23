import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * KAN-734, KAN-742. The export page's preview, written to a temp file: the
 * document Save as PDF prints, read from here as the file.
 */
export async function previewFile(
  page: Page,
  prefix: string
): Promise<{ path: string; html: string }> {
  const frame = page.locator('iframe');
  // KAN-603. The file as written, with its icons in place.
  await expect(frame).toHaveAttribute('srcdoc', /data-icons="ready"/);
  await expect(frame).toHaveAttribute('srcdoc', /<\/html>/);
  const html = await frame.getAttribute('srcdoc');
  if (html === null) throw new Error('the export page shows no preview');
  const path = join(mkdtempSync(join(tmpdir(), prefix)), 'export.html');
  writeFileSync(path, html);
  return { path, html };
}
