import { describe, expect, test } from 'vitest';

// KAN-803. A <dialog> taller than the window must scroll inside it, not run off both edges.
const MODALS = import.meta.glob('../../components/modals/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DIALOGS = Object.entries(MODALS).filter(([, src]) =>
  src.includes('<dialog')
);
// test.each([]) registers no rows, so an empty scan must fail here.
if (DIALOGS.length < 11) {
  throw new Error(`PREMISE: the scan found ${DIALOGS.length} dialogs, not 11+`);
}

describe('every dialog fits a short window', () => {
  test.each(DIALOGS)('%s sets a max height', (_path, src) => {
    expect(src).not.toMatch(/max-height:\s*none/);
    expect(src).toMatch(/dialogFitsWindow\(|max-height: calc\(/);
  });
});
