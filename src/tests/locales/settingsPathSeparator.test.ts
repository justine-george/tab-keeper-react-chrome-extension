import { describe, expect, test } from 'vitest';

import { localeDicts } from '../setup/localeT';

// KAN-921. A Settings path reads the same everywhere: Settings › Sync & backup.
describe('Settings paths', () => {
  test.each(localeDicts)('%s has no arrow', (_, strings) => {
    expect(Object.entries(strings).flat().join('\n')).not.toContain('→');
  });
});
